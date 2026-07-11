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
- `aero_financial_profit`：按报告期保存 BaoStock 盈利能力原始字段。
- `aero_report`：Markdown/PDF 日报文件索引。
- `aero_ingestion_run`：盘后任务运行状态和错误信息。
- `aero_sync_pipeline_run`：每日盘后流程的触发来源、当前步骤、重试时间和最终状态。
- `aero_data_source`：API、智能体、搜索等系统数据源的统一注册目录。
- `aero_data_source_capability`：数据源可提供的数据能力、输出契约与优先级。
- `aero_data_source_run`：每次数据源采集/提交的运行状态、候选数与采纳数。
- `aero_data_artifact`：数据源提交的原始产物及其内容哈希。
- `aero_data_artifact_link`：原始产物与业务证据、画像等实体的溯源关联。
- `aero_space_sector`：商业航天一、二级板块字典。
- `aero_company_space_profile`：公司级商业航天收入暴露、非航天核心业务和研究摘要。
- `aero_company_space_profile_evidence`：公司级画像的原始研究证据，以公司和证据哈希去重。
- `aero_company_space_business`：公司与二级板块的业务关联、角色、占比区间、价值量和重要性。
- `aero_space_business_evidence`：业务关联的可追溯证据来源。
- `aero_space_profile_revision`：人工新增、修改、确认和恢复时的前后值与原因。
- `aero_space_sector_daily`：细分板块每日等权/暴露加权表现、广度和贡献归因。

## 去重策略

- 行情：`trade_date + company_id`。
- 板块：`trade_date + board_key`。
- 公告：`source_name + external_key`，并用 `content_hash` 做二次校验。
- 业务事实：`company_id + fact_type + fact_hash`。
- 日报：`report_date + report_type`。
- 业务画像：当前有效关联以 `company_id + sector_id + is_current` 读取；历史变更保存在 `aero_space_profile_revision`，不覆盖删除。
- 商业航天研究证据：`company_id + evidence_key`；Hermes 原始成果先写入 `data/research/space-exposure/inbox/`，通过导入脚本校验后才进入正式表。

## 公告与事件

- 公告采集：东财个股公告（`stock_individual_notice_report`）为主源，巨潮资讯（`stock_zh_a_disclosure_report_cninfo`）为非科创板回退。`external_key` 从公告链接路径提取（东财为 `AN` 前缀编码，巨潮为 `announcementId`）；`content_hash` 存标题 SHA-256。断点记录在 `aero_sync_checkpoint`（key=`announcement_last_fetch`）。
- 事件抽取：按公告标题关键词规则分类为减持、增持、回购、解禁、定增、业绩、股权、诉讼、订单、投资、并购等类型。事件以 `(company_id, announcement_id, event_type)` 为业务唯一键，重复运行时更新而非重复插入。
- 减持状态机：首次发现减持计划 → `即将减持`；标题含进展/实施 → `减持中`；含完成/完毕 → `减持完毕`；计划到期未完成 → `计划到期未完成`。状态变化时追加 `aero_event_status_history`，相同状态不重复记录。

## 日报归档

- 日报生成脚本从已入库的行情、板块、事件和宏观数据中汇总，用规则模板生成 Markdown 简报。
- 文件写入 `reports/YYYY-MM-DD/daily.md`（目录由 `REPORT_DIR` 环境变量控制，默认 `reports`）。
- `aero_report` 按 `report_date + report_type`（`daily`）去重，重复生成时用 `ON DUPLICATE KEY UPDATE` 更新 `markdown_path`、`content_hash` 和 `generated_at`。
- `content_hash` 存 Markdown 全文的 SHA-256，用于检测内容是否变化。

## 宏观指标

- `aero_macro_indicator` 按 `indicator_key + observed_date` 复合主键去重，支持 upsert 幂等。
- A 股指数（上证/深证/创业板/科创50）通过腾讯日线接口获取，含收盘价和环比涨跌幅。
- 全球指数（日经225/德国DAX/英国富时100）通过新浪环球市场接口获取；标普500/纳斯达克/恒生指数因东财推送节点限制暂未接入。
- 美元/人民币汇率取央行中间价，缺失时用中行折算价回退。
- FR007 回购利率取中国外汇交易中心回购定盘利率，`value_text` 存"利率 X.XX%"文本。
- 后端查询取最新观测日的全部指标，前端"宏观天气"面板按 `value_text`（优先）或 `value + unit` 展示。

## 公司池来源

当前整理文件为 `/Users/xujiping/Documents/aiProject/AI 快速项目/myStock/商业航天公司名录.txt`。导入脚本只处理文件中的“中国 A 股上市公司”章节，目前识别到 122 家 A 股公司；未上市民营公司和海外公司不会进入本项目公司池。
