<h1 align="center">koishi-plugin-monetary-lottery</h1>

<p align="center">
	为 Koishi 提供基于 <code>monetary</code> 通用货币系统的百分比概率抽奖功能。
</p>

<p align="center">
	<a href="https://www.npmjs.com/package/koishi-plugin-monetary-lottery"><img src="https://img.shields.io/npm/v/koishi-plugin-monetary-lottery?style=for-the-badge&logo=npm" alt="npm" /></a>
	<a href="https://github.com/BYWled/koishi-plugin-monetary-lottery"><img src="https://img.shields.io/github/stars/BYWled/koishi-plugin-monetary-lottery?style=for-the-badge&logo=github" alt="GitHub Stars" /></a>
	<a href="https://github.com/BYWled/koishi-plugin-monetary-lottery/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License" /></a>
</p>

<p align="center">
	<a href="https://gitee.com/BYWled/koishi-plugin-monetary-lottery"><img src="https://img.shields.io/badge/Gitee-代码镜像-C71D23?style=for-the-badge&logo=gitee&logoColor=white" alt="Gitee Mirror" /></a>
</p>

<p align="center">
	<a href="https://github.com/BYWled/koishi-plugin-monetary-lottery">GitHub</a> ·
	<a href="https://gitee.com/BYWled/koishi-plugin-monetary-lottery">Gitee</a>
</p>

一个玩法定位于"日常小额稳定概率"的抽奖插件：奖项名称、数额、百分比概率均可由管理员通过指令动态调整，支持每日限额、冷却、连续未中奖保底，以及自定义反馈文本（支持变量占位）。与刮刮乐（权重型、可连买）和大乐透（奖池分摊）玩法完全区分。

> 版本：**1.0.0**

## ✨ 特性

- **🎯 百分比概率**：奖项按 0-100 百分比概率精确抽取，总和校验可选严格拒绝或权重归一化。
- **🛠️ 指令管理奖项**：`roll.prize.add/edit/remove` 动态增删改奖项，无需重启；首次启动自动导入默认奖项模板。
- **🛡️ 防刷四件套**：每日次数上限、冷却时间、扣费门槛（现金不足自动联动银行活期），保底计数跨日延续。
- **🎁 保底机制**：连续 N 次未中最高档奖项后下一次必中（可开关、阈值可调）。
- **✍️ 自定义反馈文本**：中奖/次数上限/冷却三类反馈均可在配置中自定义，支持变量占位。
- **🏦 银行联动**：现金不足时自动扣除 [koishi-plugin-monetary-bank](https://github.com/BYWled/koishi-plugin-monetary-bank) 活期存款。
- **🧾 完整流水**：每次抽奖记录奖项、消耗与时间，供统计与信用分体系使用。

## 📦 依赖

| 服务 | 必需 | 说明 |
| --- | --- | --- |
| `database` | ✅ | 存储奖项、抽奖流水与用户状态 |
| `monetary` | ✅ | 货币结算 |
| `monetaryBank` | 可选 | 现金不足时联动银行活期 |

## 🎮 指令说明

### 用户指令

- **`roll`** — 抽奖：按配置消耗货币并随机获取奖项。
- **`roll.stats`** — 查看个人抽奖统计（累计次数、总消耗、总获得、各奖项分布）。
- **`roll.help`** — 查看指令帮助。

### 管理指令（authority ≥ 3）

- **`roll.prize.list`** — 查看奖项列表（自动校验概率总和）。
- **`roll.prize.add <名称> <数额> <概率>`** — 添加奖项（概率 0-100）。
- **`roll.prize.edit <id> [-n 名称] [-a 数额] [-p 概率] [-e true/false]`** — 修改奖项。
- **`roll.prize.remove <id>`** — 删除奖项。
- **`roll.reset <@用户>`** — 重置指定用户今日抽奖次数。

## ⚙️ 配置项

### 基础设置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `currency` | string | `coin` | 货币单位 |
| `cost` | number | `10` | 单次抽奖消耗（0 表示免费） |
| `dailyLimit` | number | `0` | 每人每日抽奖次数上限（0 表示不限） |
| `cooldownSeconds` | number | `0` | 两次抽奖最小间隔秒数（0 表示不冷却） |
| `enableBankSync` | boolean | `true` | 现金不足时联动银行活期扣款 |

### 奖项与保底

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `probabilityStrict` | boolean | `false` | 概率总和 ≠ 100 时：开启拒绝抽奖，关闭按权重归一化 |
| `pityEnabled` | boolean | `false` | 启用保底 |
| `pityThreshold` | number | `50` | 连续未中最高档 N 次后触发保底 |
| `seedPrizes` | table[] | 五档默认奖项 | 首次启动导入的奖项模板 |

### 自定义反馈文本（支持变量占位）

| 配置项 | 可用变量 | 默认值 |
| --- | --- | --- |
| `resultMessage` 中奖反馈 | `{name}` 中奖名称、`{amount}` 奖励数额、`{cost}` 本次消耗、`{balance}` 抽奖后余额、`{currency}` 货币单位、`{today}` 今日已抽次数、`{limit}` 每日上限（0 显示 ∞）、`{pity}` 保底信息（未启用为空 / `保底进度：n/m` / `已触发保底！`） | 原三行文案 |
| `limitMessage` 次数上限 | `{limit}` | 原文案 |
| `cooldownMessage` 冷却 | `{seconds}` 剩余秒数 | 原文案 |

## 🗃️ 数据库表

- `lottery_prize`：奖项配置（指令管理）。
- `lottery_record`：抽奖流水（审计与统计）。
- `lottery_state`：用户状态（每日次数、冷却、保底计数）。

## 🎲 与其他抽奖玩法的边界

| | 本插件 roll | 刮刮乐 | 大乐透 |
| --- | --- | --- | --- |
| 概率语义 | 百分比概率（精确校验） | 权重隐式归一化 | 号码开奖 |
| 结算 | 单人即时固定奖项 | 单人即时可连买 | 多人分摊奖池 |
| 管理方式 | 指令动态管理 | 仅配置 | 仅配置 |

## 📄 License

[MIT](https://github.com/BYWled/koishi-plugin-monetary-lottery/blob/main/LICENSE)
