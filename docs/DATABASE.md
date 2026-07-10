# MySQL 数据设计

数据库：`fast-common`。本项目表统一使用 `aero_` 前缀。

## 核心表

- `aero_company`：公司主数据和航天相关等级。
- `aero_company_tag`：行业、概念和关联标签，使用有效起止日期记录变化。
- `aero_daily_quote`：每只股票每个交易日一行。
- `aero_board_quote`：行业/概念板块每日表现。
- `aero_announcement`：公告元数据、原文链接、内容哈希和 AI 摘要。
- `aero_event`：公告抽取后的重大事项。
- `aero_event_status_history`：减持等事项的状态变化历史，只在状态改变时追加。
- `aero_business_fact`：公司当前、规划中和已披露的业务事实。
- `aero_macro_indicator`：OMO、全球指数、汇率等宏观指标。
- `aero_report`：Markdown/PDF 日报文件索引。
- `aero_ingestion_run`：盘后任务运行状态和错误信息。

## 去重策略

- 行情：`trade_date + company_id`。
- 板块：`trade_date + board_key`。
- 公告：`source_name + external_key`，并用 `content_hash` 做二次校验。
- 业务事实：`company_id + fact_type + fact_hash`。
- 日报：`report_date + report_type`。

## 公司池来源

当前整理文件为 `/Users/xujiping/Documents/aiProject/AI 快速项目/myStock/商业航天公司名录.txt`。导入脚本只处理文件中的“中国 A 股上市公司”章节，目前识别到 122 家 A 股公司；未上市民营公司和海外公司不会进入本项目公司池。
