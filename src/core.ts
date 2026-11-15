/** 奖项配置（数据库表，可由指令管理） */
export interface LotteryPrize {
  id: number
  name: string
  /** 奖励数额（0 为空奖） */
  amount: number
  /** 中奖概率（百分比 0-100，全部奖项总和应为 100） */
  probability: number
  enabled: boolean
}

/** 抽奖流水（审计 + 信用分参与度数据源） */
export interface LotteryRecord {
  id: number
  uid: number
  userId: string
  platform: string
  channelId: string
  prizeId: number
  prizeName: string
  amount: number
  cost: number
  createdAt: Date
}

/** 用户抽奖状态：每日限额、冷却与保底计数 */
export interface LotteryState {
  uid: number
  todayCount: number
  lastDate: string
  lastRollAt: number
  /** 距离上一次抽中最高档奖项的连续未中次数（保底计数） */
  sinceBigWin: number
}

export interface SeedPrize {
  name: string
  amount: number
  probability: number
}

export interface ResolvedConfig {
  currency: string
  /** 单次抽奖消耗，0 表示免费 */
  cost: number
  /** 每日抽奖次数上限，0 表示不限 */
  dailyLimit: number
  /** 两次抽奖的最小间隔（秒），0 表示不冷却 */
  cooldownSeconds: number
  /** 现金不足时是否联动银行活期 */
  enableBankSync: boolean
  /** 概率总和不为 100 时：true 拒绝抽奖，false 按权重归一化 */
  probabilityStrict: boolean
  /** 是否启用保底 */
  pityEnabled: boolean
  /** 连续 N 次未中最高档奖项后，下一次必中 */
  pityThreshold: number
  /** 首次启动时导入的默认奖项 */
  seedPrizes: SeedPrize[]
  /** 中奖反馈文本（支持变量占位） */
  resultMessage: string
  /** 次数上限拒绝文本 */
  limitMessage: string
  /** 冷却拒绝文本 */
  cooldownMessage: string
}

export const defaultConfig: ResolvedConfig = {
  currency: 'coin',
  cost: 10,
  dailyLimit: 0,
  cooldownSeconds: 0,
  enableBankSync: true,
  probabilityStrict: false,
  pityEnabled: false,
  pityThreshold: 50,
  seedPrizes: [
    { name: '特等奖', amount: 100, probability: 1 },
    { name: '一等奖', amount: 50, probability: 5 },
    { name: '二等奖', amount: 20, probability: 15 },
    { name: '三等奖', amount: 5, probability: 30 },
    { name: '参与奖', amount: 1, probability: 49 },
  ],
  resultMessage:
    '🎲 抽中【{name}】，获得 {amount} {currency}！\n本次消耗 {cost} {currency}，当前余额 {balance} {currency}\n今日已抽 {today}/{limit} 次。{pity}',
  limitMessage: '今日抽奖次数已达上限（{limit} 次），明天再来吧。',
  cooldownMessage: '抽奖冷却中，请 {seconds} 秒后再试。',
}

/** 中奖反馈可用变量说明（用于配置项描述与 help） */
export const resultMessageVariables = [
  '{name} 中奖名称',
  '{amount} 奖励数额',
  '{cost} 本次消耗',
  '{balance} 抽奖后余额',
  '{currency} 货币单位',
  '{today} 今日已抽次数',
  '{limit} 每日次数上限（0 显示 ∞）',
  '{pity} 保底信息（未启用为空；启用时为“保底进度：n/m”或“已触发保底！”）',
]

export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(value))
  }
  return result
}

export function toLocalDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface DrawResult {
  prize: LotteryPrize
  /** 归一化后该奖项的实际命中概率（百分比） */
  normalizedProbability: number
}

/**
 * 加权抽取奖项。
 * - total = 100 时按百分比精确落区间
 * - total ≠ 100 时按权重归一化（等价于 random * total）
 * 返回 null 表示奖项列表为空或总概率为 0。
 */
export function drawPrize(prizes: LotteryPrize[]): DrawResult | null {
  const total = prizes.reduce((sum, p) => sum + Math.max(0, p.probability), 0)
  if (prizes.length === 0 || total <= 0) return null
  let r = Math.random() * total
  for (const prize of prizes) {
    const weight = Math.max(0, prize.probability)
    if (r < weight) return { prize, normalizedProbability: (weight / total) * 100 }
    r -= weight
  }
  // 浮点兜底：落在最后一个非零权重奖项
  const last = [...prizes].reverse().find((p) => p.probability > 0)
  return last
    ? { prize: last, normalizedProbability: (last.probability / total) * 100 }
    : null
}
