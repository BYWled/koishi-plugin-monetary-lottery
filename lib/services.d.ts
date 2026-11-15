import type { Context } from 'koishi';
/** 与 monetary-extra 相同的服务类型：银行活期联动 */
export type MonetaryLikeContext = Context & {
    monetaryBank?: {
        withdraw(uid: number, currency: string, amount: number): Promise<{
            success: boolean;
            error?: string;
        }>;
    };
};
export interface CostResult {
    success: boolean;
    error?: string;
}
export declare function hasTable(ctx: Context, tableName: string): boolean;
export declare function getCashBalance(ctx: MonetaryLikeContext, uid: number, currency: string): Promise<number>;
export declare function getBankDemandBalance(ctx: MonetaryLikeContext, uid: number, currency: string): Promise<number>;
/**
 * 扣款：优先现金，不足时联动银行活期（复用 monetary-extra 的同名模式）。
 * 禁止直接改写 monetary 表的值，统一走 monetary.cost 的原子扣减。
 */
export declare function costWithBank(ctx: MonetaryLikeContext, uid: number, currency: string, amount: number, enableBankSync: boolean): Promise<CostResult>;
