var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(src_exports);
var import_koishi2 = require("koishi");

// src/core.ts
var defaultConfig = {
  currency: "coin",
  cost: 10,
  dailyLimit: 0,
  cooldownSeconds: 0,
  enableBankSync: true,
  probabilityStrict: false,
  pityEnabled: false,
  pityThreshold: 50,
  seedPrizes: [
    { name: "特等奖", amount: 100, probability: 1 },
    { name: "一等奖", amount: 50, probability: 5 },
    { name: "二等奖", amount: 20, probability: 15 },
    { name: "三等奖", amount: 5, probability: 30 },
    { name: "参与奖", amount: 1, probability: 49 }
  ],
  resultMessage: "🎲 抽中【{name}】，获得 {amount} {currency}！\n本次消耗 {cost} {currency}，当前余额 {balance} {currency}\n今日已抽 {today}/{limit} 次。{pity}",
  limitMessage: "今日抽奖次数已达上限（{limit} 次），明天再来吧。",
  cooldownMessage: "抽奖冷却中，请 {seconds} 秒后再试。"
};
var resultMessageVariables = [
  "{name} 中奖名称",
  "{amount} 奖励数额",
  "{cost} 本次消耗",
  "{balance} 抽奖后余额",
  "{currency} 货币单位",
  "{today} 今日已抽次数",
  "{limit} 每日次数上限（0 显示 ∞）",
  "{pity} 保底信息（未启用为空；启用时为“保底进度：n/m”或“已触发保底！”）"
];
function renderTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(value));
  }
  return result;
}
__name(renderTemplate, "renderTemplate");
function toLocalDateKey(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
__name(toLocalDateKey, "toLocalDateKey");
function drawPrize(prizes) {
  const total = prizes.reduce((sum, p) => sum + Math.max(0, p.probability), 0);
  if (prizes.length === 0 || total <= 0) return null;
  let r = Math.random() * total;
  for (const prize of prizes) {
    const weight = Math.max(0, prize.probability);
    if (r < weight) return { prize, normalizedProbability: weight / total * 100 };
    r -= weight;
  }
  const last = [...prizes].reverse().find((p) => p.probability > 0);
  return last ? { prize: last, normalizedProbability: last.probability / total * 100 } : null;
}
__name(drawPrize, "drawPrize");

// src/commands.ts
var import_koishi = require("koishi");

// src/services.ts
function hasTable(ctx, tableName) {
  return Boolean(ctx.database.tables?.[tableName]);
}
__name(hasTable, "hasTable");
async function getCashBalance(ctx, uid, currency) {
  const [record] = await ctx.database.get("monetary", { uid, currency }, ["value"]);
  return Number(record?.value ?? 0);
}
__name(getCashBalance, "getCashBalance");
async function getBankDemandBalance(ctx, uid, currency) {
  if (!hasTable(ctx, "monetary_bank_int")) return 0;
  const records = await ctx.database.get("monetary_bank_int", { uid, currency, type: "demand" });
  return records.reduce((sum, record) => sum + Number(record.amount ?? 0), 0);
}
__name(getBankDemandBalance, "getBankDemandBalance");
async function costWithBank(ctx, uid, currency, amount, enableBankSync) {
  if (amount <= 0) return { success: true };
  const cash = await getCashBalance(ctx, uid, currency);
  if (cash >= amount) {
    await ctx.monetary.cost(uid, amount, currency);
    return { success: true };
  }
  if (!enableBankSync || !ctx.monetaryBank || !hasTable(ctx, "monetary_bank_int")) {
    return { success: false, error: `余额不足，需要 ${amount} ${currency}，当前现金 ${cash} ${currency}` };
  }
  const shortage = amount - cash;
  const demand = await getBankDemandBalance(ctx, uid, currency);
  if (demand < shortage) {
    return {
      success: false,
      error: `余额不足，需要 ${amount} ${currency}，当前现金 ${cash} ${currency}，银行活期 ${demand} ${currency}`
    };
  }
  const withdraw = await ctx.monetaryBank.withdraw(uid, currency, shortage);
  if (!withdraw.success) {
    return { success: false, error: withdraw.error || "银行取款失败" };
  }
  try {
    await ctx.monetary.cost(uid, amount, currency);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "扣款失败" };
  }
}
__name(costWithBank, "costWithBank");

// src/commands.ts
function uidOf(session) {
  const uid = Number(session.user?.id);
  return Number.isFinite(uid) && uid > 0 ? uid : null;
}
__name(uidOf, "uidOf");
async function getState(ctx, uid) {
  const [existing] = await ctx.database.get("lottery_state", { uid });
  if (existing) return existing;
  const created = {
    uid,
    todayCount: 0,
    lastDate: "",
    lastRollAt: 0,
    sinceBigWin: 0
  };
  await ctx.database.create("lottery_state", created);
  return created;
}
__name(getState, "getState");
async function getEnabledPrizes(ctx) {
  const rows = await ctx.database.get("lottery_prize", {});
  return rows.filter((row) => row.enabled);
}
__name(getEnabledPrizes, "getEnabledPrizes");
async function resolveTargetUid(ctx, session, text) {
  let userId = "";
  const atMatch = [...text.matchAll(/<at[^>]*\bid=["']?([^"'\s/>]+)["']?[^>]*\/?>/g)];
  if (atMatch.length) {
    userId = atMatch[0][1];
  } else {
    const stripped = text.replace(/<[^>]+>/g, " ").trim();
    if (/^\d{3,}$/.test(stripped)) userId = stripped;
    else if (/^@(.+)$/.test(stripped)) userId = stripped.slice(1);
  }
  if (!userId) return null;
  const [binding] = await ctx.database.get("binding", {
    platform: session.platform,
    pid: userId
  });
  if (!binding) return null;
  return { uid: Number(binding.aid), userId };
}
__name(resolveTargetUid, "resolveTargetUid");
function registerCommands({ ctx, config, logger: logger2 }) {
  ctx.command("roll.help", "查看抽奖插件帮助").action(() => [
    "🎲 抽奖插件（monetary-lottery）",
    "",
    "【用户】",
    "roll — 抽奖：消耗货币按概率随机获取奖项",
    "roll.stats — 查看个人抽奖统计（累计/消耗/各奖项分布）",
    "",
    "【管理员（authority 3）】",
    "roll.prize.list — 查看奖项列表（含概率总和校验）",
    "roll.prize.add <名称> <数额> <概率> — 添加奖项",
    "roll.prize.edit <id> [-n 名称] [-a 数额] [-p 概率] [-e 启用] — 修改奖项",
    "roll.prize.remove <id> — 删除奖项",
    "roll.reset <@用户> — 重置指定用户今日抽奖次数",
    "",
    "【提示】",
    "· 中奖反馈/次数上限/冷却文本均可在插件配置中自定义，支持变量占位：",
    `　${resultMessageVariables.join("；")}`,
    "· 次数上限文本可用 {limit}；冷却文本可用 {seconds}"
  ].join("\n"));
  ctx.command("roll", "抽奖：消耗货币按概率抽取奖项").userFields(["id"]).action(async ({ session }) => {
    if (!session?.userId) return "无法获取会话信息。";
    const uid = uidOf(session);
    if (uid == null) return "无法获取用户数字 ID，请先与机器人完成绑定。";
    const prizes = await getEnabledPrizes(ctx);
    if (prizes.length === 0) return "当前未配置任何奖项，请联系管理员使用 roll.prize.add 添加。";
    const totalProbability = prizes.reduce((sum, p) => sum + Math.max(0, p.probability), 0);
    if (totalProbability <= 0) return "奖项概率配置异常（总和为 0），请联系管理员。";
    if (config.probabilityStrict && Math.abs(totalProbability - 100) > 1e-3) {
      return `奖项概率总和为 ${totalProbability.toFixed(2)}%（应为 100%），已暂停抽奖，请联系管理员调整。`;
    }
    const state = await getState(ctx, uid);
    const today = toLocalDateKey(/* @__PURE__ */ new Date());
    if (state.lastDate !== today) {
      state.todayCount = 0;
      state.lastDate = today;
      await ctx.database.set("lottery_state", { uid }, { todayCount: 0, lastDate: today });
    }
    if (config.dailyLimit > 0 && state.todayCount >= config.dailyLimit) {
      return renderTemplate(config.limitMessage, {
        limit: config.dailyLimit,
        currency: config.currency
      });
    }
    if (config.cooldownSeconds > 0) {
      const elapsed = Date.now() - state.lastRollAt;
      const remainMs = config.cooldownSeconds * 1e3 - elapsed;
      if (state.lastRollAt > 0 && remainMs > 0) {
        const seconds = Math.ceil(remainMs / 1e3);
        return renderTemplate(config.cooldownMessage, {
          seconds,
          currency: config.currency
        });
      }
    }
    if (config.cost > 0) {
      const cost = await costWithBank(ctx, uid, config.currency, config.cost, config.enableBankSync);
      if (!cost.success) return cost.error || "扣款失败。";
    }
    const topPrize = [...prizes].sort((a, b) => b.amount - a.amount)[0];
    let draw = drawPrize(prizes);
    if (!draw) {
      if (config.cost > 0) await ctx.monetary.gain(uid, config.cost, config.currency);
      return "抽奖配置异常，已退还本次费用。";
    }
    if (config.pityEnabled && topPrize && state.sinceBigWin + 1 >= config.pityThreshold) {
      draw = { prize: topPrize, normalizedProbability: 100 };
    }
    const prize = draw.prize;
    const now = /* @__PURE__ */ new Date();
    try {
      await ctx.database.transact(async (tx) => {
        await tx.create("lottery_record", {
          uid,
          userId: session.userId,
          platform: session.platform,
          channelId: session.channelId,
          prizeId: prize.id,
          prizeName: prize.name,
          amount: prize.amount,
          cost: config.cost,
          createdAt: now
        });
        await tx.set("lottery_state", { uid }, {
          todayCount: state.todayCount + 1,
          lastDate: today,
          lastRollAt: Date.now(),
          sinceBigWin: topPrize && prize.id === topPrize.id ? 0 : state.sinceBigWin + 1
        });
        if (prize.amount > 0) {
          await tx.upsert("monetary", (row) => [{
            uid,
            currency: config.currency,
            value: import_koishi.$.add(row.value, prize.amount)
          }]);
        }
      });
    } catch (error) {
      logger2.error("抽奖结算失败：%o", error);
      if (config.cost > 0) {
        await ctx.monetary.gain(uid, config.cost, config.currency).catch(() => {
        });
        return "抽奖结算失败，本次费用已退还，请稍后再试。";
      }
      return "抽奖结算失败，请稍后再试。";
    }
    const balance = await getCashBalance(ctx, uid, config.currency);
    const pityForced = config.pityEnabled && topPrize && state.sinceBigWin + 1 >= config.pityThreshold;
    let pityText = "";
    if (config.pityEnabled && topPrize) {
      if (pityForced) pityText = "已触发保底！";
      else if (prize.id === topPrize.id) pityText = "恭喜中得最高档奖项！";
      else pityText = `保底进度：${state.sinceBigWin + 1}/${config.pityThreshold}`;
    }
    return renderTemplate(config.resultMessage, {
      name: prize.name,
      amount: prize.amount,
      cost: config.cost,
      balance,
      currency: config.currency,
      today: state.todayCount + 1,
      limit: config.dailyLimit > 0 ? config.dailyLimit : "∞",
      pity: pityText
    });
  });
  ctx.command("roll.stats", "查看个人抽奖统计").userFields(["id"]).action(async ({ session }) => {
    if (!session) return "无法获取会话信息。";
    const uid = uidOf(session);
    if (uid == null) return "无法获取用户数字 ID。";
    const records = await ctx.database.get("lottery_record", { uid });
    if (records.length === 0) return "你还没有抽过奖，试试 roll 吧！";
    const totalCost = records.reduce((sum, r) => sum + Number(r.cost ?? 0), 0);
    const totalGain = records.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    const byPrize = /* @__PURE__ */ new Map();
    for (const record of records) {
      byPrize.set(record.prizeName, (byPrize.get(record.prizeName) ?? 0) + 1);
    }
    const state = await getState(ctx, uid);
    const today = toLocalDateKey(/* @__PURE__ */ new Date());
    const todayCount = state.lastDate === today ? state.todayCount : 0;
    return [
      `抽奖统计：累计 ${records.length} 次（今日 ${todayCount} 次）`,
      `总消耗 ${totalCost} / 总获得 ${totalGain} ${config.currency}（净 ${totalGain - totalCost}）`,
      ...[...byPrize.entries()].map(([name2, count]) => `- ${name2} × ${count}`)
    ].join("\n");
  });
  ctx.command("roll.prize.list", "查看奖项列表（管理员）", { authority: 3 }).action(async () => {
    const prizes = await ctx.database.get("lottery_prize", {}, { sort: { id: "asc" } });
    if (prizes.length === 0) return "尚未配置任何奖项。";
    const total = prizes.reduce((sum, p) => sum + Math.max(0, p.probability), 0);
    const normalized = Math.abs(total - 100) > 1e-3 ? `（总和 ${total.toFixed(2)}%，${config.probabilityStrict ? "严格模式下将拒绝抽奖" : "将按权重归一化"}）` : "（总和 100%）";
    return [
      `奖项列表 ${normalized}：`,
      ...prizes.map((p) => `#${p.id} ${p.enabled ? "" : "[停用] "}${p.name}：${p.amount} ${config.currency} @ ${p.probability}%`)
    ].join("\n");
  });
  ctx.command("roll.prize.add <name:string> <amount:number> <probability:number>", "添加奖项（管理员）", { authority: 3 }).action(async (_, name2, amount, probability) => {
    if (!name2?.trim()) return "请提供奖项名称。";
    if (!Number.isFinite(amount) || amount < 0) return "奖励数额不能为负。";
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) return "概率必须在 0-100 之间。";
    const created = await ctx.database.create("lottery_prize", {
      name: name2.trim(),
      amount,
      probability,
      enabled: true
    });
    const total = (await ctx.database.get("lottery_prize", {})).reduce((sum, p) => sum + Math.max(0, Number(p.probability)), 0);
    return `奖项 #${created?.id ?? "?"}「${name2}」已添加。当前概率总和：${total.toFixed(2)}%${Math.abs(total - 100) > 1e-3 ? "（不为 100%！" + (config.probabilityStrict ? "严格模式将拒绝抽奖" : "将按权重归一化") + "）" : ""}`;
  });
  ctx.command("roll.prize.edit <id:number>", "修改奖项（管理员）", { authority: 3 }).option("name", "-n <name:string> 奖项名称").option("amount", "-a <amount:number> 奖励数额").option("probability", "-p <probability:number> 概率（0-100）").option("enable", "-e <enable:string> 是否启用（true/false）").action(async ({ options }, id) => {
    const [prize] = await ctx.database.get("lottery_prize", { id });
    if (!prize) return "未找到该奖项。";
    const patch = {};
    if (options.name != null) patch.name = options.name.trim();
    if (options.amount != null) {
      if (options.amount < 0) return "奖励数额不能为负。";
      patch.amount = options.amount;
    }
    if (options.probability != null) {
      if (options.probability < 0 || options.probability > 100) return "概率必须在 0-100 之间。";
      patch.probability = options.probability;
    }
    if (options.enable != null) {
      const flag = String(options.enable).toLowerCase();
      if (flag !== "true" && flag !== "false") return "启用状态只接受 true/false。";
      patch.enabled = flag === "true";
    }
    if (Object.keys(patch).length === 0) return "请至少提供一个要修改的字段。";
    await ctx.database.set("lottery_prize", { id }, patch);
    return `奖项 #${id}「${prize.name}」已更新。`;
  });
  ctx.command("roll.prize.remove <id:number>", "删除奖项（管理员）", { authority: 3 }).action(async (_, id) => {
    const [prize] = await ctx.database.get("lottery_prize", { id });
    if (!prize) return "未找到该奖项。";
    await ctx.database.remove("lottery_prize", { id });
    return `奖项 #${id}「${prize.name}」已删除。`;
  });
  ctx.command("roll.reset <user:text>", "重置指定用户的今日抽奖次数（管理员）", { authority: 3 }).action(async ({ session }, user) => {
    if (!user) return "请 @目标用户或提供其平台 ID。";
    const target = await resolveTargetUid(ctx, session, user);
    if (!target) return "未找到该用户的绑定信息。";
    const today = toLocalDateKey(/* @__PURE__ */ new Date());
    await ctx.database.set("lottery_state", { uid: target.uid }, { todayCount: 0, lastDate: today });
    return `已重置用户 ${target.userId} 的今日抽奖次数。`;
  });
}
__name(registerCommands, "registerCommands");

// src/index.ts
var name = "monetary-lottery";
var inject = {
  required: ["database", "monetary"],
  optional: ["monetaryBank"]
};
var logger = new import_koishi2.Logger("monetary-lottery");
var SeedPrizeSchema = import_koishi2.Schema.object({
  name: import_koishi2.Schema.string().required().description("奖项名称"),
  amount: import_koishi2.Schema.number().min(0).description("奖励数额"),
  probability: import_koishi2.Schema.number().min(0).max(100).description("概率（百分比，总和应为 100）")
});
var Config = import_koishi2.Schema.intersect([
  import_koishi2.Schema.object({
    currency: import_koishi2.Schema.string().default(defaultConfig.currency).description("货币单位"),
    cost: import_koishi2.Schema.number().min(0).default(defaultConfig.cost).description("单次抽奖消耗（0 表示免费）"),
    dailyLimit: import_koishi2.Schema.number().min(0).step(1).default(defaultConfig.dailyLimit).description("每人每日抽奖次数上限（0 表示不限）"),
    cooldownSeconds: import_koishi2.Schema.number().min(0).step(1).default(defaultConfig.cooldownSeconds).description("两次抽奖的最小间隔秒数（0 表示不冷却）"),
    enableBankSync: import_koishi2.Schema.boolean().default(defaultConfig.enableBankSync).description("现金不足时是否联动银行活期扣款")
  }).description("基础设置"),
  import_koishi2.Schema.object({
    probabilityStrict: import_koishi2.Schema.boolean().default(defaultConfig.probabilityStrict).description("奖项概率总和不为 100 时：开启则拒绝抽奖，关闭则按权重归一化"),
    pityEnabled: import_koishi2.Schema.boolean().default(defaultConfig.pityEnabled).description("是否启用保底（连续未中最高档奖项后必中）"),
    pityThreshold: import_koishi2.Schema.number().min(2).step(1).default(defaultConfig.pityThreshold).description("连续多少次未中最高档奖项后触发保底"),
    seedPrizes: import_koishi2.Schema.array(SeedPrizeSchema).role("table").default(defaultConfig.seedPrizes).description("首次启动时导入的默认奖项（之后请在机器人内用 roll.prize 指令管理）")
  }).description("奖项与保底"),
  import_koishi2.Schema.object({
    resultMessage: import_koishi2.Schema.string().role("textarea").default(defaultConfig.resultMessage).description(
      `中奖反馈文本。可用变量：<ul>${resultMessageVariables.map((v) => `<li><code>${v}</code></li>`).join("")}</ul>`
    ),
    limitMessage: import_koishi2.Schema.string().role("textarea").default(defaultConfig.limitMessage).description("次数上限拒绝文本。可用变量：<code>{limit} 每日次数上限</code>"),
    cooldownMessage: import_koishi2.Schema.string().role("textarea").default(defaultConfig.cooldownMessage).description("冷却拒绝文本。可用变量：<code>{seconds} 剩余冷却秒数</code>")
  }).description("自定义反馈文本")
]);
function apply(ctx, config) {
  ctx.model.extend("lottery_prize", {
    id: "unsigned",
    name: "string",
    amount: "double",
    probability: "double",
    enabled: "boolean"
  }, { autoInc: true, primary: "id" });
  ctx.model.extend("lottery_record", {
    id: "unsigned",
    uid: "unsigned",
    userId: "string",
    platform: "string",
    channelId: "string",
    prizeId: "unsigned",
    prizeName: "string",
    amount: "double",
    cost: "double",
    createdAt: "timestamp"
  }, { autoInc: true, primary: "id" });
  ctx.model.extend("lottery_state", {
    uid: "unsigned",
    todayCount: "unsigned",
    lastDate: "string",
    lastRollAt: "unsigned",
    sinceBigWin: "unsigned"
  }, { primary: "uid" });
  ctx.on("ready", async () => {
    try {
      const existing = await ctx.database.get("lottery_prize", {}, { limit: 1 });
      if (existing.length === 0 && config.seedPrizes.length > 0) {
        for (const seed of config.seedPrizes) {
          await ctx.database.create("lottery_prize", {
            name: seed.name,
            amount: seed.amount,
            probability: seed.probability,
            enabled: true
          });
        }
        logger.info(`已导入 ${config.seedPrizes.length} 个默认奖项。`);
      }
    } catch (error) {
      logger.error("导入默认奖项失败：%o", error);
    }
  });
  registerCommands({ ctx, config, logger });
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name
});
