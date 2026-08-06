# 阿里云「股票历史行情查询 - 极速数据」API 手册

> 商品页：<https://market.aliyun.com/detail/cmapi00045130#sku=yuncode3913000009>
> 服务商：杭州网尚科技有限公司（极速数据 / jisuapi）
> 上架日期：2021-01-11 · 所属类目：身份核验与金融银行
> 整理日期：2026-07-31（页面信息为准）

本手册记录该商品下 **8 个接口** 的调用地址、请求参数与响应字段，供后续接入「投资看板」所需数据时参考。该商品**按次计费**，接入前需先购买并取得 `AppCode`。

---

## 0. 通用约定

| 项目 | 说明 |
|------|------|
| Base Host | `https://jsapigpls.market.alicloudapi.com` |
| 认证方式 | Header `Authorization: APPCODE <你的AppCode>`（阿里云 API 简单身份认证） |
| 返回类型 | JSON，统一外层结构 `{ status, msg, result }`，`status=0` 表示成功 |
| 计费 | 按次：2元/200次、198元/10万次、370元/20万次、850元/50万次、1500元/100万次、15000元/1000万次；另有 30 天免费试用 100 次 |
| SLA | 近一月 100%；近 7 天响应 ≈ 3624ms |

### 通用错误码

| 错误码 | HTTP | 含义 | 解决 |
|--------|------|------|------|
| Quota Exhausted | 403 | 调用次数已用完 | 重新购买 |
| Quota Expired | 403 | 购买次数已过期 | 重新购买 |
| Unauthorized | 403 | 未授权 | 确认是否购买/买错 |
| Invalid AppCode | 400 | AppCode 错误 | 复制正确 AppCode，勿带空格 |
| Empty Signature | 401 | 签名为空 | Header 缺少签名 |
| Invalid AppKey | 400 | AppKey 错误 | 复制正确 AppKey |

### 调用示例（curl）

```bash
curl "https://jsapigpls.market.alicloudapi.com/stockhistory/query?code=300917&startdate=2026-07-01&enddate=2026-07-31" \
  -H "Authorization: APPCODE 你的AppCode"
```

---

## 1. 股票历史查询（K 线日线） `/stockhistory/query`

按股票代码 + 日期区间返回日线 OHLCV、换手率、涨跌幅等，**数据粒度为天**，可绘制 K 线。

| 参数 | 必填 | 说明 | 实例 |
|------|------|------|------|
| `code` | Y | 股票代码 | `300917` |
| `startdate` | N | 开始时间 | `2020-12-24` |
| `enddate` | N | 结束时间 | `2020-12-25` |

**响应 `result`**：`code` / `name` / `startdate` / `enddate` + `list[]`，每条字段：

| 字段 | 含义 |
|------|------|
| `stockid` | 股票 id |
| `date` | 日期 |
| `openningprice` | 开盘价 |
| `closingprice` | 收盘价 |
| `maxprice` | 最高价 |
| `minprice` | 最低价 |
| `tradenum` | 成交量 |
| `tradeamount` | 成交额 |
| `turnoverrate` | 换手率 |
| `changepercent` | 涨跌幅（%） |
| `changeamount` | 涨跌额 |
| `amplitude` | 振幅（%） |
| `per` | 市盈率（可空） |
| `pbr` | 市净率（可空） |
| `totalmarket` | 总市值（可空） |
| `circulationmarket` | 流通市值（可空） |

---

## 2. 股票详情（实时行情） `/stockhistory/detail`

单只股票当日/最新行情快照。

| 参数 | 必填 | 说明 | 实例 |
|------|------|------|------|
| `code` | Y | 股票代码 | `300917` |

**响应 `result`**：

| 字段 | 含义 |
|------|------|
| `name` / `code` | 名称 / 代码 |
| `classid` | 分类（1=沪深股市） |
| `price` | 现价 |
| `maxprice` / `minprice` | 最高 / 最低 |
| `openningprice` / `lastclosingprice` | 开盘 / 昨收 |
| `tradenum` / `tradeamount` | 成交量 / 成交额 |
| `turnoverrate` | 换手率 |
| `changepercent` / `changeamount` | 涨跌幅 / 涨跌额 |
| `amplitude` | 振幅 |
| `quantityratio` | 量比 |
| `per` / `pbr` | 市盈率 / 市净率 |
| `totalmarket` / `circulationmarket` | 总市值 / 流通市值（可能为 null） |
| `updatetime` | 行情更新时间 |

---

## 3. 股票列表 `/stockhistory/list`

分页返回某分类下全部股票代码清单（沪深共 4486 只）。

| 参数 | 必填 | 说明 | 实例 |
|------|------|------|------|
| `classid` | Y | 分类 ID（1=沪深股市） | `1` |
| `pagenum` | N | 当前页，默认 1 | `1` |
| `pagesize` | N | 每页数量，默认 30 | `10` |

**响应 `result`**：`pagesize` / `pagenum` / `total` / `classid` + `list[]`（每条 `{name, code}`）。

---

## 4. 股票复权因子 `/stockhistory/fqfactor`

返回该股票历史除权除息的**前复权 / 后复权因子**，用于自行复权计算。

| 参数 | 必填 | 说明 | 实例 |
|------|------|------|------|
| `code` | Y | 股票代码 | `300917` |
| `pagenum` | N | 页码 | `1` |
| `pagesize` | N | 每页条数 | `10` |

**响应 `result`**：`code` / `name` / `pagesize` / `pagenum` / `total` + `list[]`：

| 字段 | 含义 |
|------|------|
| `stockid` | 股票 id |
| `date` | 除权日（最早一条常为 `1900-01-01`） |
| `qfqfactor` | 前复权因子 |
| `hfqfactor` | 后复权因子 |

---

## 5. 利润表 `/stockhistory/financialprofit`

利润表（损益表）分报告期数据。

| 参数 | 必填 | 说明 | 实例 |
|------|------|------|------|
| `code` | Y | 股票代码 | `688808` |
| `startdate` | N | 统计开始日期 | |
| `enddate` | N | 统计结束日期 | |

**响应 `result`**：`code` / `name` / `startdate` / `enddate` + `list[]`，每条含 `report_date`、`report_type`、`main{}`，`main` 主要字段：

| 字段 | 含义 |
|------|------|
| `total_operate_income` / `operate_income` | 营业总收入 / 营业收入 |
| `total_operate_cost` / `operate_cost` | 营业总成本 / 营业成本 |
| `research_expense` | 研发费用 |
| `operate_tax_add` | 税金及附加 |
| `sale_expense` / `manage_expense` / `finance_expense` | 销售 / 管理 / 财务费用 |
| `credit_impairment_loss` / `asset_impairment_loss` | 信用 / 资产减值损失 |
| `invest_income` / `fairvalue_change_income` | 投资收益 / 公允价值变动收益 |
| `operate_profit` | 营业利润 |
| `nonbusiness_income` / `nonbusiness_expense` | 营业外收入 / 支出 |
| `total_profit` | 利润总额 |
| `income_tax` | 所得税费用 |
| `netprofit` | 净利润 |

> 完整字段含银行业务项（`interest_income`、`earned_premium` 等），非银公司为空字符串。

---

## 6. 现金流量表 `/stockhistory/financialcashflow`

现金流量表分报告期数据。

| 参数 | 必填 | 说明 |
|------|------|------|
| `code` | Y | 股票代码 |
| `startdate` / `enddate` | N | 日期区间 |

**响应 `list[].main` 主要字段**：

| 字段 | 含义 |
|------|------|
| `sales_services` | 销售商品、提供劳务收到的现金 |
| `receive_tax_refund` | 收到的税费返还 |
| `receive_other_operate` | 收到其他与经营活动有关的现金 |
| `buy_services` | 购买商品、接受劳务支付的现金 |
| `pay_salary` | 支付给职工以及为职工支付的现金 |
| `pay_tax` | 支付的各项税费 |
| `net_operate_cashflow` | 经营活动现金流量净额 |
| `invest_*` | 投资活动各项现金流 |
| `finance_*` / `absorb_investment` / `cash_dividend` | 筹资活动各项现金流 |
| `net_increase_cash` | 现金及现金等价物净增加额 |

---

## 7. 资产负债表 `/stockhistory/financialbalancesheet`

资产负债表分报告期数据。

| 参数 | 必填 | 说明 |
|------|------|------|
| `code` | Y | 股票代码 |
| `startdate` / `enddate` | N | 日期区间 |

**响应 `list[].main` 主要字段**（字段名按字母序）：

| 字段 | 含义 |
|------|------|
| `accounts_rece` / `accounts_payable` | 应收账款 / 应付账款 |
| `advance_receivables` / `advance_payment` | 预收账款 / 预付账款 |
| `inventory` | 存货 |
| `monetaryfund` / `fund_financial_institution` | 货币资金 / 金融机构资金 |
| `notes_account_rece` / `notes_payable` | 应收票据 / 应付票据 |
| `total_assets` / `total_liabilities` | 资产总计 / 负债合计 |
| `total_equity` / `parent_equity` | 所有者权益合计 / 归属母公司权益 |
| `total_current_assets` / `total_noncurrent_assets` | 流动 / 非流动资产合计 |
| `total_current_liab` / `total_noncurrent_liab` | 流动 / 非流动负债合计 |

> 完整字段含保险、银行特有科目（如 `accept_deposit_interbank` 同业存放等），多数为空。

---

## 8. 财务主要指标 `/stockhistory/financialmain`

把三大表汇总成核心财务指标，**含同比增速**，最适合看板/估值快速读取。

| 参数 | 必填 | 说明 | 实例 |
|------|------|------|------|
| `code` | Y | 股票代码 | `688808` |
| `indicator` | N | 口径：`按报告期` \| `按单季度` | `按报告期` |
| `startdate` / `enddate` | N | 日期区间 | |

**响应 `list[]` 主要字段**：

| 字段 | 含义 |
|------|------|
| `epsjb` / `epskcjb` / `epsxs` | 基本 / 扣非基本 / 稀释每股收益 |
| `bps` | 每股净资产 |
| `mgzbgj` / `mgwfplr` / `mgjyxjje` | 每股资本公积 / 未分配利润 / 经营现金流净额 |
| `totaloperatereve` / `mlr` | 营业总收入 / 毛利润 |
| `parentnetprofit` / `kcfjcxsyjlr` | 归母净利润 / 扣非净利润 |
| `totaloperaterevetz` | 营业总收入同比变动（%） |
| `parentnetprofittz` | 归母净利润同比变动（%） |
| `kcfjcxsyjlrtz` | 扣非净利润同比变动（%） |
| `report_date` / `report_type` / `notice_date` / `update_date` | 报告期日期 / 类型 / 公告日 / 更新日 |

---

## 9. 接入建议（对应看板数据需求）

参考 [`AGENTS.md` 每日 AI 联网数据采集规范](../AGENTS.md)：

| 看板需求 | 是否适用本商品 | 建议 |
|----------|---------------|------|
| A 股大盘指数/成交额/涨跌家数 | ❌ 不适用 | 仍用新浪行情 + 东方财富 clist |
| 板块龙头股当日行情 | ⚠️ 部分适用（`/detail` 实时快照） | 实时性不如东方财富免费接口，且按次计费成本高 |
| 个股 K 线/历史回测 | ✅ 适用（`/query` + `/fqfactor`） | 适合需要前复权历史价的场景 |
| 持仓股财务健康度（季报） | ✅ 适用（`/financialmain`） | 一次拉取含同比的核心指标，最适合看板「基本面」卡片 |
| 持仓股三大报表深度分析 | ✅ 适用（利润/现金流/资产负债三接口） | 需要时再调用，避免浪费调用次数 |

**结论**：免费接口（新浪/东方财富）已能覆盖行情类需求；本商品的核心价值在于 **`/financialmain`（财务主要指标）** 和 **`/financialprofit`/`financialcashflow`/`financialbalancesheet`（三大报表）**——这些是免费行情接口拿不到的，可用于看板中持仓股的基本面分析。`AppCode` 仅放在 `.env`，调用失败勿在日志中打印。
