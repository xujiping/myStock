# 研究包输出契约

适用对象：Hermes、网页搜索连接器、未来其他研究智能体，以及人工整理脚本。研究方只负责提交候选与证据；领域导入器负责校验、去重和写库。

## 目录约定

以 `commercial-space` 主题为例：

```text
data/research/space-exposure/
  inbox/YYYY-MM-DD.json
  evidence/YYYY-MM-DD/<股票代码>-<证据ID>.json
  reports/YYYY-MM-DD.md
  state.json
```

所有文件写完且校验完成后，才更新 `state.json`：

```json
{ "lastSuccessfulAt": "2026-07-11T18:42:00+08:00" }
```

这表示“今日取证完成”，不表示一定发现了新证据。

服务端每分钟检查一次：当天候选文件、研究摘要和完成时间均存在时，会自动校验并导入。若文件未齐、自动导入失败，或你希望提前处理，可在“数据同步 → Hermes 取证”卡片点击“手动校验并导入”。

## 候选文件

`inbox/YYYY-MM-DD.json`：

```json
{
  "date": "2026-07-11",
  "records": [
    {
      "code": "600879",
      "companyName": "航天电子",
      "operation": "new_evidence",
      "primarySector": "导航、测控与地面系统",
      "secondarySector": "测控设备",
      "businessRole": "相关业务",
      "commercialRevenueExact": null,
      "commercialRevenueMin": null,
      "commercialRevenueMax": null,
      "companyTotalRevenue": null,
      "contractAmount": null,
      "contractExposure": null,
      "contractExposureNote": null,
      "dataState": "待确认",
      "confidence": "低",
      "calculation": null,
      "conclusion": "可复核的事实结论",
      "evidenceIds": ["64位证据哈希"],
      "recommendation": "仅保存证据"
    }
  ]
}
```

规则：

- `commercialRevenue*` 与数值型 `contractExposure` 都是 0–100 的百分比，不得传入描述文字。
- 合同金额填写 `contractAmount`；对合同范围、周期或“非收入”的说明写入 `contractExposureNote`。
- `recommendation=可入库`：允许更新业务关联或收入暴露，必须有原始证据。
- `recommendation=仅保存证据`：只保存证据及原始产物，不更新业务关系和收入暴露。
- `recommendation=人工复核`：仅归档原始产物，不产生公司画像证据或业务更新。
- `operation=update_revenue_exposure` 时，至少填写一个 `commercialRevenue*` 字段，并给出 `calculation`。

为兼容已存在的 Hermes 文件，导入器暂时接受文字型 `contractExposure`，但新连接器不得继续使用这种写法。

## 证据文件

每个 `evidenceId` 必须对应一个证据文件：

```json
{
  "evidenceId": "64位证据哈希",
  "code": "600879",
  "companyName": "航天电子",
  "sourceName": "巨潮资讯",
  "sourceUrl": "https://...",
  "publishedAt": "2026-07-11",
  "title": "公告标题",
  "excerpt": "不超过300字的关键原文",
  "sourceLevel": "official_filing",
  "facts": []
}
```

`sourceName/sourceUrl` 是事实的原始出处；智能体/搜索连接器只是采集渠道。导入器会把渠道运行记录写入数据源控制面，把原始出处保留在业务证据中。
