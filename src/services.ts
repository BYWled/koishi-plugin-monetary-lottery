import type { Context } from 'koishi'
import {} from 'koishi-plugin-monetary'

/** 与 monetary-extra 相同的服务类型：银行活期联动 */
export type MonetaryLikeContext = Context & {
  monetaryBank?: {
    withdraw(uid: number, currency: string, amount: number): Promise<{ success: boolean; error?: string }>
  }
}

export interface CostResult {
  success: boolean
  error?: string
}

export function hasTable(ctx: Context, tableName: string): boolean {
  return Boolean((ctx.database as any).tables?.[tableName])
}

export async function getCashBalance(ctx: MonetaryLikeContext, uid: number, currency: string): Promise<number> {
  const [record] = await ctx.database.get('monetary', { uid, currency }, ['value'] as any)
  return Number(record?.value ?? 0)
}

export async function getBankDemandBalance(ctx: MonetaryLikeContext, uid: number, currency: string): Promise<number> {
  if (!hasTable(ctx, 'monetary_bank_int')) return 0
  const records = await ctx.database.get('monetary_bank_int' as any, { uid, currency, type: 'demand' } as any)
  return records.reduce((sum: number, record: any) => sum + Number(record.amount ?? 0), 0)
}

/**
 * 扣款：优先现金，不足时联动银行活期（复用 monetary-extra 的同名模式）。
 * 禁止直接改写 monetary 表的值，统一走 monetary.cost 的原子扣减。
 */
export async function costWithBank(
  ctx: MonetaryLikeContext,
  uid: number,
  currency: string,
  amount: number,
  enableBankSync: boolean,
): Promise<CostResult> {
  if (amount <= 0) return { success: true }

  const cash = await getCashBalance(ctx, uid, currency)
  if (cash >= amount) {
    await ctx.monetary.cost(uid, amount, currency)
    return { success: true }
  }

  if (!enableBankSync || !ctx.monetaryBank || !hasTable(ctx, 'monetary_bank_int')) {
    return { success: false, error: `余额不足，需要 ${amount} ${currency}，当前现金 ${cash} ${currency}` }
  }

  const shortage = amount - cash
  const demand = await getBankDemandBalance(ctx, uid, currency)
  if (demand < shortage) {
    return {
      success: false,
      error: `余额不足，需要 ${amount} ${currency}，当前现金 ${cash} ${currency}，银行活期 ${demand} ${currency}`,
    }
  }

  const withdraw = await ctx.monetaryBank.withdraw(uid, currency, shortage)
  if (!withdraw.success) {
    return { success: false, error: withdraw.error || '银行取款失败' }
  }

  try {
    await ctx.monetary.cost(uid, amount, currency)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '扣款失败' }
  }
}
