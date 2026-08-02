# Repository Guidelines — AI 辅助投资系统

## 0. 项目定位与文档地图

**定位**：本地优先的个人 AI 辅助投资决策工作台。它不预测哪只股票一定上涨，而是把账户、持仓、市场环境、板块机会、宏观变量、投资判断、交易记录和视频观点放进同一套可复盘框架。原「凯哥视频 A 股分析」保留为研究数据源之一，不会直接变成买卖指令。

**文档地图**（单一事实来源，禁止重复漂移）：

| 文档 | 读者 | 内容 | 维护触发 |
|---|---|---|---|
| `AGENTS.md`（本文件） | AI 智能体 | 行为约束、系统边界、写入权限、命令 | 任何规则/边界/命令变化 |
| `README.md` | 人 | 功能总览、启动方式、常用命令 | 功能/命令/表结构变化 |
| `docs/data-collection.md` | 采集执行者 | 每个数据源的 URL、字段解析、已知陷阱 | 数据源接口变化 |
| `docs/api-aliyun-stockhistory.md` | 财务指标接入者 | 阿里云计费接口手册 | 接口/计费变化 |
| `AI辅助投资系统需求.md` | 人 | V1.0 需求快照（历史），不代表现状 | 不随实现更新 |

**文档同步规则**：改代码必须同步相关文档；文档与代码矛盾时**以代码为准并立即修正文档**。新增/修改表结构、字段、npm 命令、数据源 URL 时，必须同步更新本文件对应章节与 `README.md`。禁止在文档中写下与代码不一致的「计划中」内容。

**规则落地义务**：用户明确说「记住」「以后都这样」或要求长期保留的关于本项目的任何规则、偏好、约定，必须立即落实到 `AGENTS.md` 对应章节，禁止只留在对话记录里——对话记忆随时丢失，`AGENTS.md` 是跨对话的单一事实来源。

## 1. 项目结构与模块组织

**视频研究管线**（原版功能，只读边界）：

- `analyze-videos.cjs`：视频扫描、`ffmpeg` 音频抽取、阿里云 NLS 转写、LLM 精炼、报告生成。
- `download_douyin_july.py`：按月份下载视频；`update.cjs`：编排下载与增量分析；`watch.cjs`：监听新视频。
- `dashboard-template.html`：旧视频看板模板（主看板为 `investment-dashboard.html`）。

数据流为「视频文件名日期 → WAV 缓存 → COS 临时上传 → NLS 转写 → 本地 JSON → 报告」。`transcripts/` 是可复核的中间结果；报告可从已有转写重建，修改提炼或展示逻辑时优先 `npm run summarize`，不重复调用云端服务。**原视频始终只读，生成物可删除后重建。**

**投资模块**（当前主体）：

- `investment-store.cjs`：SQLite 存取层（含表结构与字段校验）。
- `investment-analysis.cjs`：看板数据装配（`buildOverview`）。
- `investment-dashboard.html`：投资看板页面。
- `serve.cjs`：HTTP 服务，实时读库；内置 `scripts/task-scheduler.cjs` 调度每日数据采集 / 行情刷新 / 数据库备份，**不依赖 launchd**（`scripts/install-collect-schedule.cjs`、`install-backup-schedule.cjs` 已废弃；`install-schedule.cjs` 仅用于视频下载分析）。
- `scripts/`：`collect-macro.cjs` / `collect-market.cjs` / `collect-sector.cjs` / `collect-all.cjs`（行情采集）、`collect-quotes.cjs`（个股行情）、`analyze-market.cjs` / `analyze-sector.cjs`（AI 分析）、`backup-investment.cjs`、`check-investment.cjs`、`restart-dashboard.cjs`、`trading-calendar.cjs`、`task-scheduler.cjs`、`lib/`（网络与解析工具）、`test/`。
- `stock-fundamentals.cjs`：阿里云计费接口采集持仓股财务指标（见 `docs/api-aliyun-stockhistory.md`）。
- `gold-market.cjs`：阿里云云市场「探数API」上海金交所金价（AppCode 认证）。
- `operation-log.cjs`：操作日志封装。

**数据库**：`data/investment.sqlite` 是投资模块唯一数据源，看板实时读库，不依赖 `reports/data.json`。当前共 9 张表，全部带项目前缀 `kai_`：

| 表 | 用途 | 写入方 |
|---|---|---|
| `kai_invest_portfolio` | 持仓 + 关注列表（`list_type` 区分） | 仅人工 |
| `kai_invest_market` | 账户 / 市场环境 / 宏观变量（`record_type` 区分） | 采集 + AI 分析 + 人工 |
| `kai_invest_sector` | 板块池 | 采集 + AI 参考 + 人工 |
| `kai_invest_decision` | 投资判断与 AI 日报（含 `input_snapshot`） | 人工 + 日报生成 |
| `kai_invest_trade_log` | 交易记录 | 仅人工（看板操作产生） |
| `kai_invest_daily_review` | 每日复盘 | 仅人工（看板交互） |
| `kai_invest_stock_fundamentals` | 持仓股财务指标 | `stock-fundamentals.cjs` |
| `kai_invest_stock_quote` | 个股行情快照 | `collect-quotes.cjs` / 定时任务 |
| `kai_invest_operation_log` | 系统运行日志 | `serve.cjs` |

运行时目录：`videos/`、`audio/`、`transcripts/`、`reports/`、`logs/` 属生成或本地数据，不应提交大文件或密钥；`data/` 已 gitignore。

## 2. 系统边界与写入权限（最高优先级约束）

**总原则**：AI 只做两件事——采集客观行情、生成可追溯的参考分析。投资判断权永远在人。**数据可信度分层：人工录入 > 客观采集 > AI 参考分析 > 视频观点**，低层不得覆盖高层。

### 2.1 字段写权限表

任何写入必须符合下表；**默认拒绝，越界即 bug**。新增写入逻辑时对照此表，如需扩大权限必须经用户确认并同步更新本表。

**`kai_invest_market`**（按 `record_type`）：

| 写入方 | 可写字段 | 禁止 |
|---|---|---|
| 采集脚本（`collect-macro/market`） | `current_value`、`change_note`、`impact_short`、`impact_mid`、`metrics_json`、`observed_at`、`status`（失败时写失败标注） | **任何判断字段**（`score`/`risk_level`/`opportunity_level`/`strategy`/`rationale`）一律不可写；数据来源说明并入 `change_note`。CLI `--score` 等显式传参改走 `manual` 来源单独写入 |
| AI 分析（`analyze-market.cjs`） | `score`、`risk_level`、`opportunity_level`、`strategy`、`rationale`、`analysis_source`、`analyzed_at` | **绝不修改** `metrics_json` / `current_value` / `observed_at` / `status` |
| 人工（看板 / CLI override） | 全部字段；`record_type='account'` 只能人工写；`collect-market.cjs --score` 等判断字段经此通道写入 | — |

**`kai_invest_sector`**：

| 写入方 | 可写字段 | 禁止 |
|---|---|---|
| 采集脚本（`collect-sector.cjs`） | `indicators`、`updated_note` | `rating` / `status` / `logic` / `risks` / `cycle` |
| AI 分析（`analyze-sector.cjs`） | `analysis_source`、`analyzed_at`、`analysis_note` | 同上；AI 结论只作页面「AI 参考分析」展示 |
| 人工（看板） | 全部字段；「采纳建议」仅写 `rating` / `status`（二次确认） | `logic` / `risks` 永不被采纳操作修改 |

**其他表**：

| 表 | 写入方 | 约束 |
|---|---|---|
| `kai_invest_portfolio` | 仅人工 | 行情刷新只写 `kai_invest_stock_quote`，禁止回写持仓价格/盈亏 |
| `kai_invest_trade_log` | 仅人工 | AI 禁止生成或修改任何买卖记录 |
| `kai_invest_daily_review` | 仅人工 | AI 禁止代填复盘 |
| `kai_invest_decision` | 人工 + 日报生成 | AI 日报是综合摘要，不是买卖指令；必须存 `input_snapshot` |
| `kai_invest_stock_fundamentals` | `stock-fundamentals.cjs` | 只写客观财务指标 |
| `kai_invest_stock_quote` | `collect-quotes.cjs` | 只写客观行情，不做盈亏金额计算 |
| `kai_invest_operation_log` | `serve.cjs` | 系统日志 |

### 2.2 AI 禁止清单

1. 禁止编造或修改私人数据：持仓、成本、仓位、交易、账户资产、收益率、回撤。
2. 禁止自动改动板块 `rating` / `status` / `logic` / `risks`（判断权在人；采纳必须经看板二次确认）。
3. 禁止编造已停止披露的数据（如北向资金净流入，只记成交总额）。
4. 禁止用旧值或猜测填补采集失败项，必须如实标注「暂无公开数据」/「已停止披露」/「采集失败」。
5. 禁止把 AI 结论表述为事实：任何 AI 生成内容必须带来源（`analysis_source`）与数据日期（`observed_at` / `analyzed_at`）。
6. 禁止在无数据或无 LLM key 时"降级生成看似完整的结论"——此时必须拒绝分析并说明缺什么。
7. 禁止输出、提交或记录凭据（.env、cookies、AppCode、密钥）。
8. 禁止绕过看板/脚本直接修改人工字段（调试用 `sqlite3` 改人工数据前必须经用户确认）。

### 2.3 可追溯要求

- 市场环境分析：页面同屏展示「采集数据 + 分析结果」；AI 分析输入只取原始数据字段，**禁止用结论生成结论**（历史 `score` 等不参与输入）。
- 投资日报：发送给模型的输入数据整体存入 `kai_invest_decision.input_snapshot`，展示的是生成时刻快照而非当前数据。
- 板块 AI 参考：`analysis_note` 含 summary/signals/attention/suggestedRating/suggestedStatus；采纳动作必须在看板二次确认，并写入 `kai_invest_operation_log`（`operation_key='adopt-ai-analysis'`，记录前后评级/状态与 AI 来源）。
- **新鲜度边界**：AI 分析与行情数据按交易日计算年龄（`analysisFreshness`/`dataFreshness`），阈值 market/sector=2 个交易日、macro=5 个交易日，超期自动标记「已过期」；展示层不得把过期结论呈现为当前建议，过期时引导重新采集/重新分析。
- 新增任何 AI 分析逻辑必须保持以上「原始数据 + 分析 + 来源」可追溯边界。

## 3. 每日 AI 联网数据采集规范

本节定义 AI 智能体每天需联网查询并写入 `data/investment.sqlite` 的范围、顺序与边界。原则：**只采集客观市场/宏观数据，不替用户做投资决策、不编造用户私人数据**。接口 URL、字段解析与已知陷阱见 [`docs/data-collection.md`](docs/data-collection.md)；本节只定义「做什么、顺序、边界」。

### 一、必须联网采集的数据（按先后顺序：宏观 → 市场 → 板块）

1. **宏观变量**（`kai_invest_market` 中 `record_type='macro'`）
   - **美联储**（先查，黄金/资金判断依赖它）：最新一次 FOMC 议息会议结果。数据源：美联储官网一手声明 `federalreserve.gov/newsevents/pressreleases/monetary*.htm`，先看 FOMC 日历页 `fomccalendars.htm` 确认最新已开会议日期，再读对应声明。写入：`current_value`（利率决议+投票）、`change_note`（结论/异议/经济判断）、`impact_short`/`impact_mid`、`observed_at`=会议日期，`status='已更新'`。
   - **黄金变量**：国际金价、美元指数、10 年期美债收益率。金价复用 `gold-market.cjs`（阿里云探数API 上海金交所）；DXY 与 10Y 美债按 `docs/data-collection.md` 执行。
   - **A股资金**：两市成交额、主力资金净流入、北向资金成交额。数据源：东方财富 `data.eastmoney.com/zjlx/dpzjlx.html`、`data.eastmoney.com/hsgt/`。**北向资金实时净流入自 2024 年起已停止披露，只记成交总额，禁止编造净额。**

2. **A股市场环境**（`record_type='market'`，name='A股市场环境'）
   - 指数（上证、深证）、成交额、涨跌家数、涨跌停家数、市场情绪。数据源：新浪行情接口（沪深指数第 10 字段为成交额，单位元）、东方财富 `push2.eastmoney.com` 的 `clist` 接口。
   - 写入：`current_value`、`metrics_json`（indexTrend/turnover/northbound/sentiment/advanceDecline/themePersistence）、`status='已更新'`；`score`/`risk_level`/`opportunity_level`/`strategy` 属判断字段，仅允许显式传参或 AI 分析脚本写入。

3. **板块池行情**（`kai_invest_sector`，目前含黄金/猪肉/商业航天）
   - 每个板块当日涨跌、龙头股表现、板块资金流向。写入：`indicators`、`updated_note`（更新说明+日期）。`rating`/`status`/`logic`/`risks` 属投资判断，**不随行情自动改动**。

### 二、不要联网采集的数据（必须用户人工录入）

- `kai_invest_portfolio`：股票代码、成本价、仓位、买入逻辑。
- `kai_invest_trade_log`：真实买卖记录。
- `kai_invest_market` 中 `record_type='account'`：总资产、股票市值、可用现金、收益率、回撤。
- `kai_invest_decision` 决策日报：依赖持仓等数据齐全后由 LLM 综合生成，不是联网搜索任务。

### 三、采集与写入规则

- **数据时效**：A股/板块取最近一个交易日收盘值；金价/美元/美债取采集时刻实时值；`observed_at` 如实填写数据对应日期。
- **一键采集**：`npm run collect` 按宏观→市场→板块顺序执行，任一层失败不阻断后续；支持 `--dry-run` 预览、`--only`/`--no-*` 选择性执行。
- **一手优先**：官方机构 > 交易所/财经门户 > 二手媒体；多个来源矛盾时以一手为准，并向用户声明。
- **失败处理**：某指标无法获取时如实标注，不用旧值或猜测填补。
- **写入校验**：写入后用 `sqlite3 data/investment.sqlite "SELECT ..."` 回读确认，并检查 `investment-analysis.cjs` 的 `buildOverview` 能正确读取。
- **看板刷新**：投资看板由 `serve.cjs` 实时读库，写入后无需重建 `reports/data.json`。

## 4. Build, Test, and Development Commands

```bash
npm install                 # 安装 Node.js 依赖
npm run open                # 启动看板服务并打开浏览器（开发用 npm run serve 免打开）
npm run serve               # 只启动服务（127.0.0.1:4173）
npm run restart             # 重启看板服务（后台运行，--all 停止所有实例）
npm run analyze             # 增量转写并生成视频报告
npm run summarize           # 仅用已有转写重建视频报告
npm run update -- --no-download  # 跳过下载，分析已有新视频
npm run watch               # 监听 videos/ 并自动分析
npm run collect             # 一键采集行情（宏观→市场→板块）
npm run collect:macro       # 只采集宏观（美联储/金价/美元/美债/A股资金）
npm run collect:market      # 只采集 A 股市场环境
npm run collect:sector      # 只采集板块行情
npm run analyze:market      # AI 分析市场环境（不联网，只写判断字段）
npm run analyze:sector      # 板块 AI 参考分析（不写评级/逻辑）
npm test                    # 单元测试（node:test，行情解析/持仓变更/调度/store）
npm run check               # 端到端自检（表结构、CRUD、总览聚合）
npm run backup              # 数据库热备份
```

修改前请确认已复制 `.env.example` 为 `.env`，并安装 `ffmpeg`。下载功能还需要本机 `~/Downloads/cookies.txt`；不要在测试或日志中输出凭据。端口冲突时运行 `node serve.cjs --port 4174 --no-open`。

## 5. 开发边界自检清单（改代码前过一遍）

- [ ] 新增写入逻辑：对照 §2.1 权限表，是否越界？扩大权限是否经用户确认并更新文档？
- [ ] 新增表/字段：是否带 `kai_` 前缀？是否同步本文件表清单与 `README.md`？
- [ ] 采集/分析脚本：先 `--dry-run` 预览，确认只写目标字段。
- [ ] 展示层：原始数据与 AI 结论是否同屏、来源与日期是否可见？数据缺失时是否如实展示而非包装？
- [ ] 云端/计费接口（NLS、COS、阿里云市场）：重试、超时、错误信息是否泄露密钥？
- [ ] 验证：`npm test` + `npm run check` + 涉及展示时 `npm run serve` 页面可访问。

## 6. Coding Style & Naming Conventions

JavaScript 使用 CommonJS、2 个空格缩进、单引号、分号和 `camelCase`；常量使用 `UPPER_SNAKE_CASE`。Python 使用 4 个空格缩进和 `snake_case`。视频文件名必须包含可识别日期，例如 `YYYYMMDD_描述.mp4`；新增脚本应通过 `package.json` 提供清晰的 `npm run` 入口。项目当前未配置格式化或 lint 工具，提交前应保持与邻近代码一致。

## 7. Testing Guidelines

提交前至少运行 `npm test`（现有测试：新浪/东财解析、持仓变更、定时调度、store 校验）、`npm run check`（端到端自检）、`npm run summarize`（报告重建）；涉及视频处理时再用一份小型带日期样例验证音频、转写缓存和报告输出。避免使用真实生产视频、云端密钥或 cookies 做测试。

## 8. Commit & Pull Request Guidelines

使用简短的 Conventional Commits 前缀（`feat:`、`fix:`、`docs:`、`refactor:`、`test:`），以动词说明改动，正文可使用中文。PR 应说明目的、影响的脚本或输出目录、验证命令及配置变化；若修改看板，请附桌面和窄屏截图；**修改表结构/字段/命令时注明同步更新的文档**。不要提交 `.env`、cookies、原始视频、音频缓存或包含敏感信息的日志。

## 9. Security & Configuration

所有阿里云、腾讯云和 LLM 凭据仅放在本地 `.env`（含 `GOLD_MARKET_APP_CODE`、`STOCK_FUNDAMENTALS_APP_CODE` 等云市场 AppCode）。COS 对象使用临时签名 URL；改动云端上传、转写或模型调用时，先检查失败重试、超时和错误信息是否会泄露密钥，并在完成后用脱敏日志验证。按次计费接口（如财务指标）接入前先确认用量与缓存策略，避免无谓消耗。
