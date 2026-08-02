# 改进路线图（Improvement Backlog）

本文档跟踪本系统已发现、待处理的改进项。来源：2026-08-02 全栈审查（后端核心 / 采集调度 / 前端看板 / 测试配置文档四路并行）。

**严重度约定**：P0 立即修复（功能 bug / 安全 / 计费）｜P1 尽快修复（合规越界 / 正确性）｜P2 优化（质量 / 体验）｜P3 基础设施（长期）。

每项标注：`位置`（文件:行号）、`类别`、`状态`（🔴待办 / 🟡进行中 / ✅完成）。完成后不删除，改状态为 ✅ 并写明提交，作为变更留痕。

---

## ✅ 已完成

### ✅ P0-A — `.gitignore` 缺防御性规则 + git 已跟踪 `.pyc`
- **位置**：`.gitignore`、`__pycache__/download_douyin_july.cpython-311.pyc`
- **问题**：`.gitignore` 缺 `__pycache__/`、`*.pyc`、`*.sqlite*`、`cookies*.txt`、`.env.local`、`*.log` 等规则；反编译 `.pyc` 可还原 Python 源码逻辑，已泄漏的 `.pyc` 已被 git 跟踪。
- **修复**：补全防御性规则；`git rm --cached -r __pycache__/`。
- **状态**：✅ 已修复（本次提交）

### ✅ P0-B — `gold-market.cjs` 写库漏传 source + 携带越界 rationale
- **位置**：`gold-market.cjs:119-141`（`syncGoldMacro`）
- **问题**：`store.update/create` 未传 `{source}`，默认走 manual 绕过权限审计；payload 含 `rationale`（§2.1 规定 macro 的 collect 不可写判断字段）。
- **修复**：显式传 `{source:'collect'}`；将原 rationale 的「数据来源说明」合并进 collect 可写的 `change_note`；移除 `rationale` 字段；加回归测试。
- **状态**：✅ 已修复（本次提交）

---

## 🔴 P0 — 立即修复

### 🔴 P0-1 — 本地服务零鉴权 + 无 Origin/CSRF 校验
- **位置**：`serve.cjs` 全文
- **问题**：服务监听 127.0.0.1 但任何本机网页（DNS rebinding / 被打开的钓鱼页）都能 POST 改持仓、DELETE 删决策、触发付费采集。无 token、无 Origin 校验、无 CSRF 防护。
- **修复**（用户选「仅 Origin/Host 校验」方案）：写操作（POST/PUT/DELETE）入口校验 Host 头 hostname ∈ {127.0.0.1, localhost}；带 Origin 头时其 hostname 也必须本机；不符返回 403。
- **状态**：✅ 已修复（第五波提交）

### 🔴 P0-2 — 采集脚本无重试，单点失败丢全天数据
- **位置**：`scripts/lib/net-collect.cjs:26-54`、`scripts/collect-market.cjs:72`
- **问题**：`curl()` 一次失败直接返回；`collect-market.cjs` 还 `throw` 后 `process.exit(1)`，新浪抖动就连累东方财富一起丢，违背「任一层失败不阻断后续」。
- **修复**：`curl` 内对超时/网络错误做 1-2 次指数退避重试并分类错误（timeout/network/empty）；`collect-market` 新浪彻底失败时降级写「采集失败」标注入库而非退出。
- **状态**：✅ 已修复（第二波提交）

### 🔴 P0-3 — 交易金额永远为 0（amount 短路 bug）
- **位置**：`investment-store.cjs:305`
- **问题**：`if (!result.amount && result.price && result.quantity)` 对 `amount:0` 不触发；`updateHoldingWithChange` 自动生成的 trades 缺价格，导致 amount 恒 0。
- **修复**：区分「未提供」与「为 0」；自动生成 trades 时主动算 `amount = price * |delta|`。
- **状态**：✅ 已修复（第一波提交）

### 🔴 P0-4 — DB 句柄泄漏（shutdown 不保证 close）
- **位置**：`serve.cjs:1006`、shutdown `setTimeout(500ms)`（`:1048-1051`）
- **问题**：`store.close()` 依赖 `server.close()` 完成；500ms 内未完成则 WAL 不 checkpoint。
- **修复**：shutdown 流程里显式同步调用 `store.close()`（幂等化），不依赖 `server.on('close')`。
- **状态**：✅ 已修复（第一波提交）

### 🔴 P0-5 — 财务接口无缓存，重复点击重复计费
- **位置**：`stock-fundamentals.cjs:57-106`、`:237-264`
- **问题**：按次计费接口无任何缓存，短时间内连续点刷新对每只持仓股各扣费一次；违反 AGENTS.md §9「接入前先确认用量与缓存策略」。
- **方案**：以 `stock_code+report_date` 为键，若 DB `fetched_at` 距今 < N 小时（如 6h）且 `report_date` 未变化则复用；进程内对同代码做短窗去重。
- **状态**：🔴 待办

---

## 🟠 P1 — 尽快修复（合规与正确性）

### 🟠 P1-1 — `FIELD_WRITE_RULES` 实际权限比 AGENTS.md §2.1 宽【核心约束】
- **位置**：`investment-store.cjs:179-184`
- **问题**：collect 的 market 白名单直接含 `score/risk_level/opportunity_level/strategy/rationale`，注释说「仅限 CLI 显式传参」但代码不区分调用方——任何 `source:'collect'` 都能写判断字段。
- **修复**：把判断字段从 collect 白名单移除；CLI `--score` 等 override 改走 `manual` source 单独写入；同步 §2.1 文档。
- **状态**：✅ 已修复（第三波提交）

### 🟠 P1-2 — `collect-market.cjs` 在 collect 下写 `rationale`
- **位置**：`scripts/collect-market.cjs:130`
- **问题**：与 P1-1 联动，采集脚本正在改写应只属 AI 分析的字段。
- **修复**：把「数据来源说明」改放进 `change_note`（与 P0-B 同款）。
- **状态**：✅ 已修复（第三波提交）

### 🟠 P1-3 — task-scheduler / trading-calendar 未锁 Asia/Shanghai 时区
- **位置**：`scripts/task-scheduler.cjs:23,150,154`、`scripts/trading-calendar.cjs:34-41`
- **问题**：调度器用宿主机本地时区，部署到非东八区时「16:10 采集」会偏移整天；store 的 `localDate()` 已锁东八区，调度层却没锁。
- **修复**：`serve.cjs` 顶部进程级 `process.env.TZ = 'Asia/Shanghai'`（在所有日期计算前设置）。
- **状态**：✅ 已修复（第四波提交）

### 🟠 P1-4 — 板块过期 AI 建议仍可被「采纳」
- **位置**：`investment-dashboard.html:792,2111`
- **问题**：`adoptSectorAnalysis` 只校验数据存在性，不校验 `analysisFreshness.stale`，违反 §2.3「过期结论不得呈现为当前建议」。
- **修复**：起手判断 `record.analysisFreshness?.stale`，过期则拒绝并提示「分析已过期，请重新 AI 分析」。
- **状态**：✅ 已修复（第四波提交）

### 🟠 P1-5 — 交易日历硬编码 2026，无 2027 数据、无过期告警
- **位置**：`scripts/trading-calendar.cjs:16-31`
- **问题**：2027 年起节假日全漏，春节休市日会误触发采集。
- **修复**：加 `CALENDAR_COVERAGE_YEAR` 常量与运行时告警；年份超出覆盖范围时 WARN 并降级为「按工作日判断」（周末仍排除）。
- **状态**：✅ 已修复（第四波提交）

### 🟠 P1-6 — 持仓变更仅前端校验 `change_reason`
- **位置**：`serve.cjs:917`、`investment-store.cjs`（`updateHoldingWithChange`）
- **问题**：~~curl 绕过前端可静默改仓位而无留痕~~（审查误报）。
- **核实**：`updateHoldingWithChange`（行 1006-1008）已强制校验 `change_reason`，所有 portfolio PUT 均走此函数；测试「数量变化必须填写变更原因」已覆盖。无需改动。
- **状态**：✅ 经核实已完善（无需改动）

### 🟠 P1-7 — 错误信息把上游响应体直接抛给客户端
- **位置**：`investment-analysis.cjs:498`、`serve.cjs:999`
- **问题**：模型网关 body 可能含 request id/配额信息，500 错误应只 log 不外泄。
- **修复**：`investment-analysis.cjs` 不再抛原始 errorBody，按状态码分类（401/403 鉴权、429 限流、5xx 不可用）；`serve.cjs` 全局 catch 对 500 类错误只返回通用文案，4xx 业务错误才透传 message。
- **状态**：✅ 已修复（第五波提交）

### 🟠 P1-8 — 任务失败无重试、崩溃后无当日补采
- **位置**：`scripts/task-scheduler.cjs:92-110`
- **问题**：16:10 采集抖动失败当天数据空缺要等次日；catch-up 只看 `lastRunAt` 不看「当天是否有 success」；syncStatus 不反写 `t.lastStatus`。
- **修复**：`isDue` 重构——当天已跑过但失败且未超 `MAX_RETRIES=2` 时，按 30 分钟间隔触发重试；catch-up 改判「今天计划点已过但今天没跑过」实现崩溃恢复补采；`runTask` 维护 `retryCount`，成功归零；状态暴露到 listTasks 快照。
- **状态**：✅ 已修复（第四波提交）

### 🟠 P1-9 — `tick` 静默吞掉异常
- **位置**：`scripts/task-scheduler.cjs:79`
- **问题**：`runTask(...).catch(()=>{})` 把异常吞掉连日志都不打，recomputeNextRunAt 抛错时调度循环静默失效。
- **修复**：`.catch((err) => console.error(...))` 至少落日志。
- **状态**：✅ 已修复（第二波提交）

### 🟠 P1-10 — quotes-refresh 部分失败即整体标 failed
- **位置**：`serve.cjs:546-551`
- **问题**：`ok: !result.errors.length`，一只停牌股就导致整个任务报 failed，掩盖「绝大多数已更新」。
- **修复**：`ok: result.results.length > 0`，summary 区分「全部成功/部分失败/全部失败」。
- **状态**：✅ 已修复（第二波提交）

---

## 🟡 P2 — 优化（代码质量 / 体验 / 可维护性）

### 前端
- ✅ **P2-F1**：拆分完成——`investment-dashboard.html` 内联 script（2263行）移到外链 `dashboard.js`（2109行），HTML 降至 156 行；serve.cjs 路由已就绪无需改。（第六波）
- **P2-F2**：`renderPages()` 每次全量重绘 8 个容器；轮询时 1.2s 重绘整页。→ 按当前页惰性渲染，轮询只更新进度条/日志区。（🔴 待办，重构风险较高，单独处理）
- ✅ **P2-F3**：4 个 `poll*Task` 已加指数退避（连续失败 1.5x 递增，上限 10s），避免服务挂掉时持续打满请求。（第六波）
- ✅ **P2-F4**：`marketMetricCard` 经核实实际风险低（所有调用方传数字或本地代码生成的固定文案，无外部字符串直接注入）；已加防御性注释明确「调用方须保证 value 可信，外部文本须先 escapeHtml」。（第六波）
- **P2-F5**：所有写入确认用原生 `confirm()`，与项目已有 `<dialog>` 体系不一致。→ 统一改用 `#confirm-dialog`。（🔴 待办，UX 细节）
- **P2-F6**：macro 数据过期时无「重新采集」引导入口。✅ 已修复（第七波）：renderMacroPage 检测过期项时显示醒目引导条（列出过期变量名 + 引导点击采集）。
- ✅ **P2-F7**：CSP `script-src` 已从 `'self' 'unsafe-inline'` 收紧为 `'self'`（拆分后无内联 script 与内联事件处理器，安全可收紧）。（第六波）

### 后端
- **P2-B1**：`serve.cjs` 1060 行，路由用长 `if` 链 + 正则，三个 spawn 任务函数近乎重复（`:121-302`）。→ 抽 `runManagedChildTask` 工厂 + 路由表。
- **P2-B2**：`buildOverview` 220+ 行单函数，魔法数字散落（`investment-analysis.cjs:140-365`）。→ 拆分 + 提取常量。
- **P2-B3**：`assertWriteAllowed` 未覆盖 `daily_review`/`quotes`/`operation_log` 表。✅ 已部分修复（第七波）：`saveDailyReview` 加 source 校验仅允许 manual；`saveQuotes` 加约束注释（入口已专用）。quotes/operation_log 的通用 source 校验待 P2-B1 重构时统一处理。
- **P2-B4**：`recalcPositionPct` N+1 更新且未在事务内。✅ 已修复（第七波）：包进 `BEGIN IMMEDIATE ... COMMIT`，异常时 ROLLBACK。
- **P2-B5**：`operation-log.cjs:34-41` 全局劫持 stdout/stderr 无还原，多次安装会叠加。→ 一次性安装标志。
- **P2-B6**：`serve.cjs:443-448` `latestOperationLog` 直接访问 `store.db` 内部字段。→ store 暴露 `findOperationByKey(key)`。

### 采集
- **P2-C1**：CDP Proxy 硬依赖 localhost:3456 无降级路径；DXY/^TNX 可加新浪 `hf_DXY`/`hf_US10Y` fallback（`net-collect.cjs:19,107-116`）。
- **P2-C2**：FOMC 利率正则过松，易误匹配经济预测段落（`collect-macro.cjs:66-67`）。
- **P2-C3**：板块成交额单位未标注（`parsers.cjs:81` `turnover` 直存未带单位）。
- **P2-C4**：北向资金 metrics_json 既无净额也无成交总额。✅ 已修复（第七波）：改为结构化 `{netInflow:'已停止披露', totalTurnover:'未采集（待接入 hsgt 接口）'}`，如实标注当前状态（§2.2 第4条）。

---

## 🟢 P3 — 基础设施（长期）

- **P3-1 测试覆盖严重不足**：仅 1 个测试文件。`buildOverview`/`freshnessFor`（§2.3 核心逻辑）、`serve.cjs` 全部 HTTP 路由、采集脚本主流程、备份逻辑全部零测试。优先补 freshnessFor + HTTP 写权限拒绝 + buildOverview 纯函数。
- **P3-2 无 CI**：PR 不强制跑 `npm test`/`check`，§8 要求的「附验证命令」纯靠人工。→ GitHub Actions（matrix: macOS/Linux）。
- **P3-3 无 lint/format/类型检查**：AGENTS.md §6 自承认。→ ESLint + Prettier + husky pre-commit。
- **P3-4 `package.json` 无 `engines`**：依赖 `node:sqlite`（实验性，Node 22+），旧版本运行时崩。✅ 已修复（第七波）：加 `"engines":{"node":">=22.5.0"}` + `.nvmrc`（24）。
- **P3-5 无告警通道**：定时任务失败只写库，无人值守时静默失败。→ Webhook/邮件/桌面通知。
- **P3-6 npm registry 锁 npmmirror**：`npm audit` 完全无法运行。→ 切回官方或配置 `npm_config_registry` 跑 audit。
- **P3-7 已废弃脚本仍挂 npm 入口**：✅ 已修复（第七波）：移除 `backup:install`/`collect:install`/`*uninstall` npm 入口；两个 install 脚本加运行时 deprecation 警告；README 同步为直接调用脚本卸载。
- **P3-8 测试默认读 `.env`**：⚠️ 已评估（第七波）：受 serve.cjs require 时副作用制约（checkLocalOrigin 测试需 require serve），加注释说明；所有网络测试用 mock 不触发真实计费。待 P2-B1 拆分 serve.cjs 后彻底移除 dotenv 依赖。
- **P3-9 依赖未 pin**：package.json 用 `^` 浮动范围；dotenv 跨主版本过期（16.6.1 vs 17.x）。→ pin + 定期升级。

---

## 决策清单（需用户拍板才能继续的项）

| 编号 | 决策点 | 选项 | 决策 |
|---|---|---|---|
| P0-1 | 本地服务鉴权方案 | (a) token（前端全改） / (b) 仅 Origin/Host 校验（改动小） / (c) 暂不做 | ✅ (b) 仅 Origin/Host 校验 |
| P1-1 | §2.1 权限收口方向 | (a) 收紧代码（判断字段移出 collect 白名单） / (b) 放宽文档（明确 rationale 双语义） | ✅ (a) 收紧代码（已完成） |
| P2-F1 | 前端拆分粒度 | (a) 全量拆 JS/CSS / (b) 仅抽出大块 / (c) 保持单文件 | ✅ (a) 全量拆分 |

其余项无需决策，按优先级顺序执行即可。
