import { Context, Schema } from 'koishi';
import { type LotteryPrize, type LotteryRecord, type LotteryState, type ResolvedConfig } from './core';
export interface MonetaryBankInterest {
    id: number;
    uid: number;
    currency: string;
    amount: number;
    type: 'demand' | 'fixed';
    rate: number;
    cycle: 'day' | 'week' | 'month';
    settlementDate: Date;
    extendRequested: boolean;
    nextRate?: number;
    nextCycle?: 'day' | 'week' | 'month';
}
declare module 'koishi' {
    interface Tables {
        monetary_bank_int: MonetaryBankInterest;
    }
}
export declare const name = "monetary-lottery";
export declare const inject: {
    required: string[];
    optional: string[];
};
declare module 'koishi' {
    interface Tables {
        lottery_prize: LotteryPrize;
        lottery_record: LotteryRecord;
        lottery_state: LotteryState;
    }
}
export interface Config extends ResolvedConfig {
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
