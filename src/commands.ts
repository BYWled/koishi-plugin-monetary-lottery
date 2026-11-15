import { Context, Logger, Session, $ } from 'koishi'
import {
  drawPrize,
  renderTemplate,
  resultMessageVariables,
  toLocalDateKey,
  type LotteryPrize,
  type LotteryState,
  type ResolvedConfig,
} from './core'
import { costWithBank, getCashBalance, type MonetaryLikeContext } from './services'

interface CommandDeps {
  ctx: Context
  config: ResolvedConfig
  logger: Logger
}

function uidOf(session: Session): number | null {
  const uid = Number((session.user as { id?: number } | undefined)?.id)
  return Number.isFinite(uid) && uid > 0 ? uid : null
}

async function getState(ctx: Context, uid: number): Promise<LotteryState> {
  const [existing] = await ctx.database.get('lottery_state', { uid })
  if (existing) return existing
  const created: LotteryState = {
    uid,
    todayCount: 0,
    lastDate: '',
    lastRollAt: 0,
    sinceBigWin: 0,
  }
  await ctx.database.create('lottery_state', created)
  return created
}

async function getEnabledPrizes(ctx: Context): Promise<LotteryPrize[]> {
  const rows = await ctx.database.get('lottery_prize', {})
  return rows.filter((row) => row.enabled)
}

/** 通过 @提及、@用户名文本或纯 ID 解析目标用户的 uid */
async function resolveTargetUid(
  ctx: Context,
  session: Session,
  text: string,
): Promise<{ uid: number; userId: string } | null> {
  let userId = ''
  const atMatch = [...text.matchAll(/<at[^>]*\bid=["']?([^"'\s/>]+)["']?[^>]*\/?>/g)]
  if (atMatch.length) {
    userId = atMatch[0][1]
  } else {
    const stripped = text.replace(/<[^>]+>/g, ' ').trim()
    if (/^\d{3,}$/.test(stripped)) userId = stripped
    else if (/^@(.+)$/.test(stripped)) userId = stripped.slice(1)
  }
  if (!userId) return null
  // binding 以 platform / pid 两列分别存储平台与平台用户 ID
  const [binding] = await ctx.database.get('binding', {
    platform: session.platform,
    pid: userId,
  })
  if (!binding) return null
  return { uid: Number(binding.aid), userId }
}

export function registerCommands({ ctx, config, logger }: CommandDeps) {
  // ---------- 帮助 ----------
  ctx.command('roll.help', '查看抽奖插件帮助')
    .action(() => [
      '🎲 抽奖插件（monetary-lottery）',
      '',
      '【用户】',
      'roll — 抽奖：消耗货币按概率随机获取奖项',
      'roll.stats — 查看个人抽奖统计（累计/消耗/各奖项分布）',
      '',
      '【管理员（authority 3）】',
      'roll.prize.list — 查看奖项列表（含概率总和校验）',
      'roll.prize.add <名称> <数额> <概率> — 添加奖项',
      'roll.prize.edit <id> [-n 名称] [-a 数额] [-p 概率] [-e 启用] — 修改奖项',
      'roll.prize.remove <id> — 删除奖项',
      'roll.reset <@用户> — 重置指定用户今日抽奖次数',
      '',
      '【提示】',
      '· 中奖反馈/次数上限/冷却文本均可在插件配置中自定义，支持变量占位：',
      `　${resultMessageVariables.join('；')}`,
      '· 次数上限文本可用 {limit}；冷却文本可用 {seconds}',
    ].join('\n'))

  // ---------- 抽奖 ----------
  ctx.command('roll', '抽奖：消耗货币按概率抽取奖项')
    .userFields(['id'])
    .action(async ({ session }) => {
      if (!session?.userId) return '无法获取会话信息。'
      const uid = uidOf(session)
      if (uid == null) return '无法获取用户数字 ID，请先与机器人完成绑定。'

      const prizes = await getEnabledPrizes(ctx)
      if (prizes.length === 0) return '当前未配置任何奖项，请联系管理员使用 roll.prize.add 添加。'

      const totalProbability = prizes.reduce((sum, p) => sum + Math.max(0, p.probability), 0)
      if (totalProbability <= 0) return '奖项概率配置异常（总和为 0），请联系管理员。'
      if (config.probabilityStrict && Math.abs(totalProbability - 100) > 0.001) {
        return `奖项概率总和为 ${totalProbability.toFixed(2)}%（应为 100%），已暂停抽奖，请联系管理员调整。`
      }

      const state = await getState(ctx, uid)
      const today = toLocalDateKey(new Date())
      if (state.lastDate !== today) {
        state.todayCount = 0
        state.lastDate = today
        await ctx.database.set('lottery_state', { uid }, { todayCount: 0, lastDate: today })
      }

      if (config.dailyLimit > 0 && state.todayCount >= config.dailyLimit) {
        return renderTemplate(config.limitMessage, {
          limit: config.dailyLimit,
          currency: config.currency,
        })
      }
      if (config.cooldownSeconds > 0) {
        const elapsed = Date.now() - state.lastRollAt
        const remainMs = config.cooldownSeconds * 1000 - elapsed
        if (state.lastRollAt > 0 && remainMs > 0) {
          const seconds = Math.ceil(remainMs / 1000)
          return renderTemplate(config.cooldownMessage, {
            seconds,
            currency: config.currency,
          })
        }
      }

      // 先扣款（联动银行），失败即中止且不改变任何状态
      if (config.cost > 0) {
        const cost = await costWithBank(ctx as MonetaryLikeContext, uid, config.currency, config.cost, config.enableBankSync)
        if (!cost.success) return cost.error || '扣款失败。'
      }

      // 保底：连续 N 次未中最高档奖项后必中
      const topPrize = [...prizes].sort((a, b) => b.amount - a.amount)[0]
      let draw = drawPrize(prizes)
      if (!draw) {
        // 概率归一化兜底失败：退回扣款
        if (config.cost > 0) await ctx.monetary.gain(uid, config.cost, config.currency)
        return '抽奖配置异常，已退还本次费用。'
      }
      if (config.pityEnabled && topPrize && state.sinceBigWin + 1 >= config.pityThreshold) {
        draw = { prize: topPrize, normalizedProbability: 100 }
      }

      const prize = draw.prize
      const now = new Date()
      try {
        await ctx.database.transact(async (tx) => {
          await tx.create('lottery_record', {
            uid,
            userId: session.userId,
            platform: session.platform,
            channelId: session.channelId,
            prizeId: prize.id,
            prizeName: prize.name,
            amount: prize.amount,
            cost: config.cost,
            createdAt: now,
          })
          await tx.set('lottery_state', { uid }, {
            todayCount: state.todayCount + 1,
            lastDate: today,
            lastRollAt: Date.now(),
            sinceBigWin: topPrize && prize.id === topPrize.id ? 0 : state.sinceBigWin + 1,
          })
          if (prize.amount > 0) {
            // 与 monetary.gain 相同的原子自增写入，纳入同一事务
            await tx.upsert('monetary', (row) => [{
              uid,
              currency: config.currency,
              value: $.add(row.value, prize.amount),
            }])
          }
        })
      } catch (error) {
        logger.error('抽奖结算失败：%o', error)
        if (config.cost > 0) {
          await ctx.monetary.gain(uid, config.cost, config.currency).catch(() => {})
          return '抽奖结算失败，本次费用已退还，请稍后再试。'
        }
        return '抽奖结算失败，请稍后再试。'
      }

      const balance = await getCashBalance(ctx, uid, config.currency)
      const pityForced = config.pityEnabled && topPrize && state.sinceBigWin + 1 >= config.pityThreshold
      let pityText = ''
      if (config.pityEnabled && topPrize) {
        if (pityForced) pityText = '已触发保底！'
        else if (prize.id === topPrize.id) pityText = '恭喜中得最高档奖项！'
        else pityText = `保底进度：${state.sinceBigWin + 1}/${config.pityThreshold}`
      }
      return renderTemplate(config.resultMessage, {
        name: prize.name,
        amount: prize.amount,
        cost: config.cost,
        balance,
        currency: config.currency,
        today: state.todayCount + 1,
        limit: config.dailyLimit > 0 ? config.dailyLimit : '∞',
        pity: pityText,
      })
    })

  ctx.command('roll.stats', '查看个人抽奖统计')
    .userFields(['id'])
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息。'
      const uid = uidOf(session)
      if (uid == null) return '无法获取用户数字 ID。'
      const records = await ctx.database.get('lottery_record', { uid })
      if (records.length === 0) return '你还没有抽过奖，试试 roll 吧！'
      const totalCost = records.reduce((sum, r) => sum + Number(r.cost ?? 0), 0)
      const totalGain = records.reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
      const byPrize = new Map<string, number>()
      for (const record of records) {
        byPrize.set(record.prizeName, (byPrize.get(record.prizeName) ?? 0) + 1)
      }
      const state = await getState(ctx, uid)
      const today = toLocalDateKey(new Date())
      const todayCount = state.lastDate === today ? state.todayCount : 0
      return [
        `抽奖统计：累计 ${records.length} 次（今日 ${todayCount} 次）`,
        `总消耗 ${totalCost} / 总获得 ${totalGain} ${config.currency}（净 ${totalGain - totalCost}）`,
        ...[...byPrize.entries()].map(([name, count]) => `- ${name} × ${count}`),
      ].join('\n')
    })

  // ---------- 奖项管理 ----------
  ctx.command('roll.prize.list', '查看奖项列表（管理员）', { authority: 3 })
    .action(async () => {
      const prizes = await ctx.database.get('lottery_prize', {}, { sort: { id: 'asc' } })
      if (prizes.length === 0) return '尚未配置任何奖项。'
      const total = prizes.reduce((sum, p) => sum + Math.max(0, p.probability), 0)
      const normalized = Math.abs(total - 100) > 0.001
        ? `（总和 ${total.toFixed(2)}%，${config.probabilityStrict ? '严格模式下将拒绝抽奖' : '将按权重归一化'}）`
        : '（总和 100%）'
      return [
        `奖项列表 ${normalized}：`,
        ...prizes.map((p) =>
          `#${p.id} ${p.enabled ? '' : '[停用] '}${p.name}：${p.amount} ${config.currency} @ ${p.probability}%`),
      ].join('\n')
    })

  ctx.command('roll.prize.add <name:string> <amount:number> <probability:number>', '添加奖项（管理员）', { authority: 3 })
    .action(async (_, name, amount, probability) => {
      if (!name?.trim()) return '请提供奖项名称。'
      if (!Number.isFinite(amount) || amount < 0) return '奖励数额不能为负。'
      if (!Number.isFinite(probability) || probability < 0 || probability > 100) return '概率必须在 0-100 之间。'
      const created = await ctx.database.create('lottery_prize', {
        name: name.trim(),
        amount,
        probability,
        enabled: true,
      })
      const total = (await ctx.database.get('lottery_prize', {}))
        .reduce((sum, p) => sum + Math.max(0, Number(p.probability)), 0)
      return `奖项 #${(created as LotteryPrize)?.id ?? '?'}「${name}」已添加。当前概率总和：${total.toFixed(2)}%${Math.abs(total - 100) > 0.001 ? '（不为 100%！' + (config.probabilityStrict ? '严格模式将拒绝抽奖' : '将按权重归一化') + '）' : ''}`
    })

  ctx.command('roll.prize.edit <id:number>', '修改奖项（管理员）', { authority: 3 })
    .option('name', '-n <name:string> 奖项名称')
    .option('amount', '-a <amount:number> 奖励数额')
    .option('probability', '-p <probability:number> 概率（0-100）')
    .option('enable', '-e <enable:string> 是否启用（true/false）')
    .action(async ({ options }, id) => {
      const [prize] = await ctx.database.get('lottery_prize', { id })
      if (!prize) return '未找到该奖项。'
      const patch: Partial<LotteryPrize> = {}
      if (options.name != null) patch.name = options.name.trim()
      if (options.amount != null) {
        if (options.amount < 0) return '奖励数额不能为负。'
        patch.amount = options.amount
      }
      if (options.probability != null) {
        if (options.probability < 0 || options.probability > 100) return '概率必须在 0-100 之间。'
        patch.probability = options.probability
      }
      if (options.enable != null) {
        const flag = String(options.enable).toLowerCase()
        if (flag !== 'true' && flag !== 'false') return '启用状态只接受 true/false。'
        patch.enabled = flag === 'true'
      }
      if (Object.keys(patch).length === 0) return '请至少提供一个要修改的字段。'
      await ctx.database.set('lottery_prize', { id }, patch)
      return `奖项 #${id}「${prize.name}」已更新。`
    })

  ctx.command('roll.prize.remove <id:number>', '删除奖项（管理员）', { authority: 3 })
    .action(async (_, id) => {
      const [prize] = await ctx.database.get('lottery_prize', { id })
      if (!prize) return '未找到该奖项。'
      await ctx.database.remove('lottery_prize', { id })
      return `奖项 #${id}「${prize.name}」已删除。`
    })

  ctx.command('roll.reset <user:text>', '重置指定用户的今日抽奖次数（管理员）', { authority: 3 })
    .action(async ({ session }, user) => {
      if (!user) return '请 @目标用户或提供其平台 ID。'
      const target = await resolveTargetUid(ctx, session, user)
      if (!target) return '未找到该用户的绑定信息。'
      const today = toLocalDateKey(new Date())
      await ctx.database.set('lottery_state', { uid: target.uid }, { todayCount: 0, lastDate: today })
      return `已重置用户 ${target.userId} 的今日抽奖次数。`
    })
}
