import { Context, Logger } from 'koishi';
import { type ResolvedConfig } from './core';
interface CommandDeps {
    ctx: Context;
    config: ResolvedConfig;
    logger: Logger;
}
export declare function registerCommands({ ctx, config, logger }: CommandDeps): void;
export {};
