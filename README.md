# 轨道观察 · A 股航天情报终端

面向 A 股航天相关公司的盘后数据、公告、重大事项和业务变化跟踪工具。第一版采用 React/Vite Web 面板、Node/Express API 和 MySQL 持久化层。

## 启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

打开 <http://localhost:5173>。

默认 `DB_ENABLED=false`，前端使用内置演示数据，便于先查看界面。接入 MySQL 前，在 `.env` 中设置 `DB_ENABLED=true`，再执行：

```bash
pnpm db:schema
pnpm seed:space-sectors
pnpm import:companies -- data/company-pool.txt
python3.13 -m venv .venv313
.venv313/bin/pip install -r requirements.txt
pnpm ingest:quotes
```

也可以直接导入当前整理好的公司名录，脚本会只读取其中的 A 股章节，忽略未上市和海外公司：

```bash
pnpm import:companies -- "/Users/xujiping/Documents/aiProject/AI 快速项目/myStock/商业航天公司名录.txt"
pnpm seed:data-sources
```

真实凭据只放在 `.env`，不要提交到 Git。当前项目所有数据库表使用 `aero_` 前缀。

`ingest:quotes` 采用多源链路：AKShare/腾讯日线为主，BaoStock 为独立回退，AKShare/东方财富为最后回退。估值优先读取腾讯实时快照，失败时用 BaoStock 最新收盘估值补齐 PE、PB、换手率。首次入库默认回补约 250 个交易日；后续运行只请求缺失的新日期。每次运行结果与错误会记录在 `aero_ingestion_run`，每条日线的实际来源记录在 `aero_daily_quote.source_name`。

执行 `pnpm ingest:boards` 会从已入库的最新公司行情计算“航天相关公司池”及各关联等级的等权涨跌、涨跌家数和领涨公司，写入 `aero_board_quote`。这是项目内部聚合板块，不会额外请求外部站点；每次运行可安全覆盖同一交易日的数据。

执行 `pnpm ingest:industry` 会优先使用 BaoStock 的证监会行业分类；BaoStock 不可用时才回退到 AKShare/东方财富和公开页。默认跳过已存在行业标签的公司；失败记录在 `aero_ingestion_run`，可直接再次运行以续补。

执行 `pnpm ingest:concepts` 会优先通过 AKShare/东方财富读取概念板块列表及成分股，再反向匹配公司池并写入概念标签。首次同步按每板块 1.5～3 秒随机间隔运行，支持中断后续跑；完成后不会再次全量扫描。每个请求默认最多尝试 4 次，并会轮换东方财富推送节点；仍失败的板块会作为待补项保留，下一次执行时优先重试，不会被静默跳过。当东方财富接口整体不可用时，脚本会自动切换到 Tushare Pro 的按公司概念明细查询；需在 `.env` 配置 `TUSHARE_TOKEN`（概念接口权限取决于账户积分）。概念归属一般只需按需或低频（如每周）使用 `--refresh` 重新核对。

执行 `pnpm ingest:finance` 会通过 BaoStock 回补最近 8 个报告期的盈利能力字段，原始字段完整存入 `aero_financial_profit.metrics_json`，便于后续增加财务看板而不丢失源数据。

## 商业航天业务画像

执行 `pnpm seed:space-sectors` 初始化 9 个一级板块和 36 个二级板块。公司画像的数据模型覆盖商业航天收入暴露、普通主营业务、公司与二级板块的多对多关联、业务角色、价值量区间、产业链及公司重要性、证据与人工维护历史。

接口 `PUT /api/companies/:code/space-profile` 可维护公司级画像，`POST /api/companies/:code/space-businesses` 可新增细分板块关联，`PATCH /api/companies/:code/space-businesses/:businessId` 可修订已有关联；三者均写入 `aero_space_profile_revision`。每日 `pnpm ingest:boards` 会同时计算二级与一级板块的等权/市值暴露加权涨跌、涨跌广度、领涨领跌、主要贡献公司和集中度。

Hermes 等研究任务将每日候选结果写入 `data/research/space-exposure/inbox/YYYY-MM-DD.json`，原始证据写入同目录下的 `evidence/YYYY-MM-DD/`。先运行 `pnpm db:schema` 创建证据表；随后用 `pnpm ingest:space-exposure -- --date YYYY-MM-DD` 预检，用 `pnpm ingest:space-exposure -- --date YYYY-MM-DD --apply` 正式导入。脚本只处理标记为“可入库”、且每条候选均能找到原始证据的记录；导入成功后候选文件会移至 `processed/`，并为画像更新保留修订历史。

## 统一数据源架构

AKShare、BaoStock、Hermes 和未来的网页搜索/其他智能体均作为“数据源”登记，不直接与业务表耦合。先执行 `pnpm seed:data-sources` 初始化数据源目录；每种渠道声明其可提供的能力与输出契约，运行记录和原始产物统一存入 `aero_data_source_run` 与 `aero_data_artifact`。详情见 [数据源架构](docs/DATA-SOURCE-ARCHITECTURE.md)。

## 公告与事件

执行 `pnpm ingest:announcements` 采集公司池公告并去重入库。数据源以东方财富个股公告接口（`stock_individual_notice_report`）为主，覆盖全部代码含科创板 688；东财不可用时对非科创板代码回退至巨潮资讯（`stock_zh_a_disclosure_report_cninfo`）。首次运行默认回补最近 14 天，后续运行只拉取上次截止后的新增；断点记录在 `aero_sync_checkpoint`（key=`announcement_last_fetch`）。公告按 `source_name + external_key` 去重，标题哈希存入 `content_hash`。支持 `--symbols 600879,002025` 限定公司、`--backfill-days 30` 调整回补范围、`--force` 忽略断点重新回补。

执行 `pnpm extract:events` 从已入库公告中规则抽取重大事项。按公告标题关键词分类为减持、增持、回购、解禁、定增、业绩、股权、诉讼、订单、投资和并购等类型，并标记风险等级；减持类公告额外解析计划比例、已完成比例和起止日期，状态机区分即将减持、减持中、减持完毕和计划到期未完成，状态变化时追加 `aero_event_status_history`。默认只处理尚未抽取的公告，`--reprocess` 可重新处理全部。事件通过 `announcement_id` 外键回溯到原始公告，事件中心展示真实数据并可直接打开原公告链接。

## 日报归档

执行 `pnpm generate:report` 生成当日盘后 Markdown 简报。脚本从已入库的行情、板块、事件和宏观数据中汇总，用规则模板生成五个部分：公司池概况（涨跌家数、涨跌幅前五）、商业航天板块表现（等权/加权涨跌、广度、主要贡献）、重要事件（按风险等级分组）、宏观环境和研究观察（板块强度、事件风险、宏观背景三条摘要）。Markdown 文件写入 `reports/YYYY-MM-DD/daily.md`，并记录到 `aero_report` 表（按 `report_date + report_type` 去重）。支持 `--date 2026-07-10` 指定日期、`--force` 强制重新生成。前端"日报归档"页面可查看已归档列表和 Markdown 预览，也可手动触发生成。

## 宏观指标

执行 `pnpm ingest:macro` 采集宏观指标并写入 `aero_macro_indicator` 表。当前接入的指标和数据源：

| 指标 | 数据源 |
|---|---|
| 上证指数、深证成指、创业板指、科创50 | 腾讯日线指数 |
| 日经 225、德国 DAX、英国富时 100 | 新浪环球市场 |
| 美元 / 人民币 | 新浪中国银行牌价（央行中间价，缺失时用中行折算价） |
| 7 天回购利率（FR007） | 中国外汇交易中心回购定盘利率 |

标普 500、纳斯达克和恒生指数因东财推送节点网络限制暂未接入，待网络恢复后可补充。指标按 `indicator_key + observed_date` 去重，重复运行覆盖更新。今日总览的"宏观天气"面板自动展示最新观测日的指标。

## 数据同步中心

侧栏”数据同步”统一展示行情与估值、公告采集、事件抽取、行业归属、概念归属、季频财务、板块聚合、宏观指标、日报生成九类任务。每日盘后流程固定按”行情与估值 → 公告采集 → 事件抽取 → 板块聚合 → 宏观指标 → 日报生成”运行，行业、概念和财务按低频维护；页面提供”立即执行盘后同步”以及单任务手动运行。每个流程和任务都保留状态、日志、告警和失败原因。

服务进程运行时，会在每个工作日 `18:30`（`Asia/Shanghai`）自动启动每日盘后流程；行情失败会在流程内最多重试 2 次，间隔为 15 分钟、30 分钟。可通过以下环境变量调整：

```bash
DAILY_SYNC_ENABLED=true
DAILY_SYNC_TIME=18:30
DAILY_SYNC_TIME_ZONE=Asia/Shanghai
```

该排程由 API 服务进程承载，因此服务未运行期间不会执行；服务在当晚启动时会补跑尚未启动的自动批次。

如果运行环境配置了无法访问东方财富的代理，在 `.env` 设置 `AKSHARE_DISABLE_PROXY=true`，采集器会仅对自身进程关闭代理后直连。

完整的产品需求、数据范围、存储策略和阶段计划见 [项目汇总.md](./项目汇总.md)。

## 当前实现

- 盘后总览、公司列表、事件中心、日报归档四个视图。
- MySQL 建表脚本和 TXT 公司池导入脚本。
- 每日行情、板块行情、公告、事件、减持状态历史、业务事实、宏观指标、日报文件的表设计。
- API 健康检查与演示数据回退机制。

## 数据边界

每日行情保留历史记录用于趋势计算；公告原文和重大事项长期保留；减持状态只在发生变化时追加历史记录；AI 的最终日报落地为 Markdown/PDF 文件，不保存重复的页面快照。
