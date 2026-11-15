import { Context, Logger, Schema } from 'koishi'
import {} from 'koishi-plugin-monetary'
import {
  defaultConfig,
  resultMessageVariables,
  type LotteryPrize,
  type LotteryRecord,
  type LotteryState,
  type ResolvedConfig,
  type SeedPrize,
} from './core'
import { registerCommands } from './commands'

// 银行表结构（与 monetary-bank 保持一致，用于联动扣款）
export interface MonetaryBankInterest {
  id: number
  uid: number
  currency: string
  amount: number
  type: 'demand' | 'fixed'
  rate: number
  cycle: 'day' | 'week' | 'month'
  settlementDate: Date
  extendRequested: boolean
  nextRate?: number
  nextCycle?: 'day' | 'week' | 'month'
}

declare module 'koishi' {
  interface Tables {
    monetary_bank_int: MonetaryBankInterest
  }
}

export const name = 'monetary-lottery'

export const inject = {
  required: ['database', 'monetary'],
  optional: ['monetaryBank'],
}

const logger = new Logger('monetary-lottery')

declare module 'koishi' {
  interface Tables {
    lottery_prize: LotteryPrize
    lottery_record: LotteryRecord
    lottery_state: LotteryState
  }
}

export interface Config extends ResolvedConfig {}

const SeedPrizeSchema = Schema.object({
  name: Schema.string().required().description('奖项名称'),
  amount: Schema.number().min(0).description('奖励数额'),
  probability: Schema.number().min(0).max(100).description('概率（百分比，总和应为 100）'),
})

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    currency: Schema.string().default(defaultConfig.currency).description('货币单位'),
    cost: Schema.number().min(0).default(defaultConfig.cost).description('单次抽奖消耗（0 表示免费）'),
    dailyLimit: Schema.number().min(0).step(1).default(defaultConfig.dailyLimit)
      .description('每人每日抽奖次数上限（0 表示不限）'),
    cooldownSeconds: Schema.number().min(0).step(1).default(defaultConfig.cooldownSeconds)
      .description('两次抽奖的最小间隔秒数（0 表示不冷却）'),
    enableBankSync: Schema.boolean().default(defaultConfig.enableBankSync)
      .description('现金不足时是否联动银行活期扣款'),
  }).description('基础设置'),
  Schema.object({
    probabilityStrict: Schema.boolean().default(defaultConfig.probabilityStrict)
      .description('奖项概率总和不为 100 时：开启则拒绝抽奖，关闭则按权重归一化'),
    pityEnabled: Schema.boolean().default(defaultConfig.pityEnabled)
      .description('是否启用保底（连续未中最高档奖项后必中）'),
    pityThreshold: Schema.number().min(2).step(1).default(defaultConfig.pityThreshold)
      .description('连续多少次未中最高档奖项后触发保底'),
    seedPrizes: Schema.array(SeedPrizeSchema).role('table').default(defaultConfig.seedPrizes)
      .description('首次启动时导入的默认奖项（之后请在机器人内用 roll.prize 指令管理）'),
  }).description('奖项与保底'),
  Schema.object({
    resultMessage: Schema.string().role('textarea').default(defaultConfig.resultMessage)
      .description(
        `中奖反馈文本。可用变量：<ul>${resultMessageVariables.map((v) => `<li><code>${v}</code></li>`).join('')}</ul>`,
      ),
    limitMessage: Schema.string().role('textarea').default(defaultConfig.limitMessage)
      .description('次数上限拒绝文本。可用变量：<code>{limit} 每日次数上限</code>'),
    cooldownMessage: Schema.string().role('textarea').default(defaultConfig.cooldownMessage)
      .description('冷却拒绝文本。可用变量：<code>{seconds} 剩余冷却秒数</code>'),
  }).description('自定义反馈文本'),
])

export function apply(ctx: Context, config: Config) {
  ctx.model.extend('lottery_prize', {
    id: 'unsigned',
    name: 'string',
    amount: 'double',
    probability: 'double',
    enabled: 'boolean',
  }, { autoInc: true, primary: 'id' })

  ctx.model.extend('lottery_record', {
    id: 'unsigned',
    uid: 'unsigned',
    userId: 'string',
    platform: 'string',
    channelId: 'string',
    prizeId: 'unsigned',
    prizeName: 'string',
    amount: 'double',
    cost: 'double',
    createdAt: 'timestamp',
  }, { autoInc: true, primary: 'id' })

  ctx.model.extend('lottery_state', {
    uid: 'unsigned',
    todayCount: 'unsigned',
    lastDate: 'string',
    lastRollAt: 'unsigned',
    sinceBigWin: 'unsigned',
  }, { primary: 'uid' })

  // 首次启动导入默认奖项
  ctx.on('ready', async () => {
    try {
      const existing = await ctx.database.get('lottery_prize', {}, { limit: 1 })
      if (existing.length === 0 && config.seedPrizes.length > 0) {
        for (const seed of config.seedPrizes) {
          await ctx.database.create('lottery_prize', {
            name: seed.name,
            amount: seed.amount,
            probability: seed.probability,
            enabled: true,
          })
        }
        logger.info(`已导入 ${config.seedPrizes.length} 个默认奖项。`)
      }
    } catch (error) {
      logger.error('导入默认奖项失败：%o', error)
    }
  })

  registerCommands({ ctx, config, logger })
}
