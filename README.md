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
pnpm import:companies -- data/company-pool.txt
python3.13 -m venv .venv313
.venv313/bin/pip install -r requirements.txt
pnpm ingest:quotes
```

也可以直接导入当前整理好的公司名录，脚本会只读取其中的 A 股章节，忽略未上市和海外公司：

```bash
pnpm import:companies -- "/Users/xujiping/Documents/aiProject/AI 快速项目/myStock/商业航天公司名录.txt"
```

真实凭据只放在 `.env`，不要提交到 Git。当前项目所有数据库表使用 `aero_` 前缀。

`ingest:quotes` 使用 AKShare 的 A 股日线接口。首次入库默认回补约 250 个交易日；后续运行会按公司查询 `aero_daily_quote` 中最新交易日，只请求缺失的新日期，已完整入库的公司不会再次拉取。周末会自动使用最近工作日作为截止日。若需要修订历史数据，显式传入 `--force`。AKShare 为聚合数据接口，可能受上游数据源限流或变更影响；每次运行结果与错误会记录在 `aero_ingestion_run`。

执行 `pnpm ingest:boards` 会从已入库的最新公司行情计算“航天相关公司池”及各关联等级的等权涨跌、涨跌家数和领涨公司，写入 `aero_board_quote`。这是项目内部聚合板块，不会额外请求外部站点；每次运行可安全覆盖同一交易日的数据。

执行 `pnpm ingest:industry` 会优先通过 AKShare 的个股信息接口补齐缺失行业标签，网络不兼容时才回退到东方财富公开个股页。默认跳过已存在行业标签的公司，并按每次 1.5～3 秒的随机间隔访问；失败记录在 `aero_ingestion_run`，可直接再次运行以续补。

执行 `pnpm ingest:concepts` 会通过 AKShare 读取概念板块列表及成分股，再反向匹配公司池并写入概念标签。首次同步按每板块 1.5～3 秒随机间隔运行，支持中断后续跑；完成后不会再次全量扫描。概念归属一般只需按需或低频（如每周）使用 `--refresh` 重新核对。

如果运行环境配置了无法访问东方财富的代理，在 `.env` 设置 `AKSHARE_DISABLE_PROXY=true`，采集器会仅对自身进程关闭代理后直连。

完整的产品需求、数据范围、存储策略和阶段计划见 [项目汇总.md](./项目汇总.md)。

## 当前实现

- 盘后总览、公司列表、事件中心、日报归档四个视图。
- MySQL 建表脚本和 TXT 公司池导入脚本。
- 每日行情、板块行情、公告、事件、减持状态历史、业务事实、宏观指标、日报文件的表设计。
- API 健康检查与演示数据回退机制。

## 数据边界

每日行情保留历史记录用于趋势计算；公告原文和重大事项长期保留；减持状态只在发生变化时追加历史记录；AI 的最终日报落地为 Markdown/PDF 文件，不保存重复的页面快照。
