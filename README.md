# AI 辅助投资系统

这是一个面向个人投资者的本地投资决策工作台。它不负责预测哪只股票一定上涨，而是把账户、持仓、市场环境、板块机会、宏观变量、投资判断、交易记录和视频观点放进同一个可复盘框架。

原来的“凯哥视频 A 股分析”已保留为研究数据源：视频观点会参与综合判断，但只是多种依据之一，不会直接变成买卖指令。

## 启动

推荐使用 Node.js 24：

```bash
npm install
npm run open
```

默认打开：

```text
http://127.0.0.1:4173/
```

只启动服务、不自动打开浏览器：

```bash
npm run serve
```

一键重启看板服务（先停旧实例，再以脱离终端的方式启动并等待就绪）：

```bash
npm run restart              # 重启主看板 4173
npm run restart -- --port 4174   # 重启指定端口
npm run restart:open         # 重启并自动打开浏览器
npm run restart -- --all     # 停止所有 serve 实例后重启主看板
```

重启后服务与终端解绑，关闭终端窗口仍会继续运行；日志写入 `logs/serve-<port>.log`。

页面为 PC 桌面端工作台。服务会在首次启动时创建本地数据库 `data/investment.sqlite`。

## V1 功能

### 今日决策与投资总览

- 首页按“确认数据 → 处理最多三个行动项 → 留下记录”引导完成每日复盘。
- 行动项可以标记为已处理、暂缓或忽略，并保存理由；刷新和重启后不会丢失。
- 完成页汇总最近 7 次复盘的完成天数、处理事项与暂缓事项，帮助判断系统是否真正产生价值。
- 账户总资产、股票市值、现金、累计收益、最大回撤和年度目标。
- 当前市场状态、风险等级、机会等级与行动策略。
- 数据充分度检查：明确区分“没有风险”和“数据还不够”。
- 风险事项、机会事项、持仓行动与最新投资日报。
- 展示每种判断依据的数量，视频观点不会覆盖用户自己的持仓与判断。

### 我的持仓

- 股票、代码、**成本价格**、数量和仓位；仓位按「成本价格 × 数量」自动计算。
- **最新价与浮盈/浮亏率**：点击「刷新行情」或由每日定时任务从新浪行情接口采集（只展示价格与盈亏比率，不计算盈亏金额）；市值与费用仍以你的交易软件为准。
- 买入逻辑、趋势、资金、基本面和逻辑状态。
- **基本面卡片**：可一键拉取阿里云财务主要指标（每股收益、净资产、同比增速等，接口按次计费），展示最近报告期客观指标，不生成估值结论。
- **逻辑待确认高亮**：买入逻辑未填或逻辑状态为「待确认」的持仓会高亮提示，可一键筛选只看待确认项，逐个补全。
- 持有、观察、减仓、退出四级操作状态。
- 行动理由、触发条件与主要风险。
- **持仓变更自动留痕**：每次编辑持仓导致数量变化（加仓 / 减仓 / 清仓）都必须填写变更原因，系统自动生成「原数量 → 新数量 + 原因」的记录；数量归零视为清仓，可从 0 恢复为持有。

### 关注板块与关注列表

- 板块评级、周期、当前状态、核心逻辑、风险与验证指标。
- 关注列表（观察池）记录候选标的的关注原因、买入条件和排除风险。
- 清仓后可手动把标的加入关注列表继续跟踪（系统不做价格追踪，以交易软件为准）。
- 关注标的条件触发后可一键「转入持仓」，带出代码与逻辑，保存后原关注记录自动移除。
- 评级表达研究优先级，不代表上涨概率。

### 宏观变量

- 记录当前事实、最近变化、短期影响、中期影响和应对动作。
- 默认建立美联储、黄金变量和 A 股资金三个观察框架。
- 黄金变量已接入阿里云云市场“探数API”上海黄金交易所行情，进入宏观页时自动同步，5 分钟内优先使用缓存。
- 其他市场与宏观变量仍需人工更新，系统不会把缺失数据包装成当前结论。

### 投资判断与持仓变更记录

- 手动记录每次判断的短期、中期、行动、依据和风险。
- **事后复盘**：每条判断可标记复盘结论（判断正确 / 部分正确 / 判断错误 / 待复盘）并填写复盘说明，判断记录页顶部展示近 90 天的命中率与复盘完成度（命中率按「正确=1、部分=0.5」加权）。
- 自动生成《今日投资日报》，并保存使用的数据来源。
- **持仓变更记录**：更新持仓数量时自动生成的「原数量 → 新数量 + 变更原因」历史，替代原来的手动买卖记账（成交价、佣金等费用计算已移除）。

### 视频观点研究库

- 读取 `reports/data.json` 中的现有视频分析结果。
- 聚合高频板块、方向、原文摘录和最近视频。
- 保留完整旧看板入口：`http://127.0.0.1:4173/legacy/`。
- 保留本地原视频入口，AI 提炼不覆盖完整转写和原视频。

## AI 日报

“生成今日日报”会组合：

1. 账户数据
2. 市场环境
3. 我的持仓
4. 板块池
5. 宏观变量
6. 历史判断
7. 视频观点

系统复用视频精炼使用的 OpenAI 兼容配置：

```bash
GLM_API_KEY=...
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_MODEL=glm-4-flash
LLM_TIMEOUT_MS=60000
```

点击“生成今日日报”时，账户、持仓、判断和研究证据的摘要会发送给这里配置的模型服务。请使用你信任的服务商，不要在投资记录中写入账号密码、API Key 等凭据。

没有配置模型或模型暂时不可用时，会退回规则辅助日报，并在页面标明来源；不会伪装成真实模型结论。

## 数据库

当前共 9 张 SQLite 表，全部带项目专属前缀：

```text
kai_invest_portfolio       # 持仓 + 关注列表（list_type 区分 holding / watch）
kai_invest_sector          # 板块池（评级/逻辑/风险为人工判断）
kai_invest_market          # 账户 / 市场环境 / 宏观变量（record_type 区分）
kai_invest_decision        # 投资判断 + AI 日报（含 input_snapshot 输入快照）
kai_invest_trade_log       # 交易记录（真实买卖，人工录入）
kai_invest_daily_review    # 每日复盘步骤与行动项
kai_invest_stock_fundamentals  # 持仓股财务指标（阿里云计费接口）
kai_invest_stock_quote     # 个股行情快照（新浪，仅客观行情）
kai_invest_operation_log   # 系统运行日志
```

- `kai_invest_portfolio` 用 `list_type` 区分持仓（holding）和关注列表（watch）。
- `kai_invest_market` 用 `record_type` 区分账户、市场环境和宏观变量。
- AI 日报和人工观点统一进入 `kai_invest_decision`，便于按时间复盘。
- 各表写入权限（采集 / AI 分析 / 人工）见 `AGENTS.md`「系统边界与写入权限」。
- 数据与 AI 分析新鲜度：看板按交易日标记年龄（市场/板块 2 个交易日、宏观 5 个交易日），超期显示「已过期」徽标并引导重新采集/重新分析；过期结论不会呈现为当前建议。
- 采纳板块 AI 参考建议会写入系统运行日志（`adopt-ai-analysis`），记录前后评级/状态与 AI 来源，可追溯、可复盘。
- 数据库目录 `data/` 已加入 `.gitignore`，不会误提交个人投资数据。
- 备份时复制 `data/investment.sqlite` 即可。

如需更改数据库位置：

```bash
INVESTMENT_DB_PATH=/absolute/path/to/investment.sqlite
```

黄金行情使用 AppCode 简单认证，AppKey 和 AppSecret 不需要写入项目：

```bash
GOLD_MARKET_APP_CODE=your_app_code
GOLD_MARKET_HOST=https://tsgold2.market.alicloudapi.com
GOLD_MARKET_PATH=/shgold
```

首次启动会按需求文档写入一组初始账户值和板块框架。请进入“更新账户”和“更新市场”核对后再使用。

## 视频转写与增量更新

原视频继续保持只读。数据流为：

```text
视频文件名日期
→ WAV 缓存
→ COS 临时上传
→ 阿里云 NLS 转写
→ 本地 JSON
→ AI 精炼
→ 视频报告与投资工作台研究依据
```

原视频放在 `videos/`，文件名必须带可识别日期：

```text
videos/2026-07-28_盘后复盘.mp4
videos/20260729_早盘观点.mov
```

常用命令：

```bash
npm run analyze                    # 增量转写并刷新视频研究数据
npm run summarize                  # 只用已有转写重建视频报告
npm run update                     # 下载当月视频并增量分析
npm run update -- --no-download    # 跳过下载，只分析已有新视频
npm run watch                      # 监听 videos/ 并自动分析
```

转写需要本地 `.env` 中的阿里云 NLS、腾讯云 COS 配置，并需要安装 `ffmpeg`。下载功能还需要本机 `~/Downloads/cookies.txt`。不要提交或输出任何凭据。

## 市场数据一键采集

看板的「市场环境 / 宏观变量 / 关注板块」行情数据可通过脚本一键采集，按 AGENTS.md 规定顺序（宏观 → 市场 → 板块）写入 `data/investment.sqlite`：

```bash
npm run collect              # 一键采集全部（宏观+市场+板块）
npm run collect:macro        # 只采集宏观变量（美联储/金价/美元/美债/A股资金）
npm run collect:market       # 只采集 A 股市场环境（指数/成交/主力资金/涨跌家数）
npm run collect:sector       # 只采集板块行情（概念/行业板块/龙头股）
```

采集原则：

- 只写客观行情数据（`current_value` / `metrics_json` / `updated_note`）；评分、风险、机会、策略属投资判断，不自动编造。
- `collect:market` 可通过 `--score 3 --risk 3 --opp 4 --strategy "..."` 显式传入评分；判断字段属人工判断，采集脚本本身不写，CLI 传参经 `manual` 来源单独写入（见 AGENTS.md §2.1）。
- 北向资金净流入自 2024 年起已停止披露，只记录成交总额，禁止编造净额。
- 单项失败不阻断其余，失败项如实标注原因。
- 支持 `--dry-run` 先预览不写库。

依赖：`curl` + `iconv`（系统自带）采集新浪/美联储官网；CDP Proxy（web-access skill）采集东方财富、MarketWatch、Yahoo 等动态渲染页面。启动 CDP Proxy：

```bash
node "~/.agents/skills/web-access/scripts/check-deps.mjs"
```

各数据源的接口、字段与已知陷阱见 [`docs/data-collection.md`](docs/data-collection.md)。

### 看板内置定时任务

定时任务由看板服务统一调度，**服务运行期间自动执行**，不依赖 launchd 等外部定时器；状态在「系统 → 定时任务」页可见，可手动「立即运行」：

| 任务 | 计划 | 说明 |
|---|---|---|
| 每日数据采集 | 交易日 16:10 | 宏观变量 + A 股市场环境 + 板块行情 |
| 每日行情刷新 | 交易日 15:10 | 刷新持仓与关注股票的最新价与当日涨跌幅 |
| 数据库备份 | 每天 23:30 | WAL checkpoint 后热备份，保留最近 30 份 |

交易日 = 周一至周五且不在交易所公告的节假日休市区间内；节假日表内置在 `scripts/trading-calendar.cjs`（数据来源：沪深北交易所年度休市安排），**每年年初发布新安排后需更新该文件**。今日决策页与 AI 日报页在非交易日自动跳过复盘/日报，生成日报与保存复盘接口也会拒绝非交易日请求。

服务重启后自动恢复计划：每日任务若已过当日计划时刻则启动补跑。每次运行都写入「系统运行日志」，可追溯原始输出。

> 旧版 launchd 定时任务（`collect:install` / `backup:install`）已废弃，npm 入口已移除；现由看板服务内置调度。若之前安装过，可运行 `node scripts/install-collect-schedule.cjs --uninstall` 或 `node scripts/install-backup-schedule.cjs --uninstall` 卸载，避免与服务内置任务重复。

### 看板内采集

看板页面也提供一键采集按钮（后台异步执行，完成后自动刷新）：

- **今日决策页**：「采集市场」「一键采集行情」
- **宏观变量页**：「采集宏观行情」
- **关注板块页**：「采集板块行情」

采集进度通过 `GET /api/investment/collect` 轮询，任务完成后自动刷新当前页数据。同一时间只允许一个采集任务。

### 定时自动采集（已废弃，由服务内置定时任务替代）

早期版本用 macOS launchd 定时任务自动运行 `npm run collect`；现已由看板服务内置调度器替代（见上文「看板内置定时任务」），无需再安装。若之前安装过，可卸载：

```bash
node scripts/install-collect-schedule.cjs --uninstall   # 卸载 launchd 采集任务
node scripts/install-backup-schedule.cjs --uninstall    # 卸载 launchd 备份任务（避免与服务内置备份重复）
```

## 自检

```bash
npm test          # 单元测试：行情解析、持仓变更、定时调度、store 校验
npm run check     # 端到端自检：表结构、CRUD、今日复盘、持仓变更闭环、总览聚合
npm run summarize
```

`npm test` 使用 Node 内置 `node:test`（v22+），无需安装依赖，覆盖：

- 新浪指数 / 个股 / 板块解析，东方财富主力资金与涨跌家数解析（纯函数，无网络）
- `updateHoldingWithChange` 持仓变更：数量变化必填原因、加仓/减仓/清仓自动生成原数量 → 新数量记录、清仓归档与恢复持有、数量不变不产生记录
- 定时调度：interval 到期触发、交易日定点（排除节假日）、启动补跑、跨天求下次计划时刻
- 交易日历：2026 年节假日休市判断、下一交易日推算
- store 校验：`review_outcome` / `rating` / `record_type` 非法值回退、决策命中率加权

## 本地 API

主要接口：

```text
GET    /api/health
GET    /api/investment/overview
GET    /api/investment/daily-review
PUT    /api/investment/daily-review
GET    /api/investment/video-evidence
POST   /api/investment/daily-analysis
POST   /api/investment/gold/refresh
GET    /api/investment/collect[/{macro|market|sector|all}]
POST   /api/investment/collect/{macro|market|sector|all}

GET    /api/investment/{portfolio|sectors|market|decisions|trades}
POST   /api/investment/{resource}
PUT    /api/investment/{resource}/{id}
DELETE /api/investment/{resource}/{id}
```

系统只监听本地服务，不包含自动下单能力。所有自动整理与模型输出均不构成投资建议，请结合公开信息和原始来源独立核验。
