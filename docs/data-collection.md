# 投资看板数据采集手册

本手册记录 AI 辅助投资看板（`data/investment.sqlite`）每日联网采集的**可执行操作细节**：每个数据项的来源、接口 URL、调用方式、字段解析、编码处理与已知陷阱。配合 [`AGENTS.md` 的「每日 AI 联网数据采集规范」](../AGENTS.md)使用——后者定义「做什么、先后顺序、边界」，本手册定义「具体怎么做」。

所有方法均已在本项目实测验证（验证日期 2026-07-31）。失效时优先按「一手优先」原则回退到同类来源。

---

## 0. 通用约定

- **采集时机**：A 股数据取最近一个交易日收盘值（盘后）；国际金价/美元/美债取采集时刻实时值。`observed_at` 必须填数据对应的日期，不是采集当天。
- **编码**：新浪财经接口返回 **GBK** 编码，`curl` 取回后需 `iconv -f GBK -t UTF-8` 转码；其余接口多为 UTF-8。
- **Referer**：新浪接口需带 `Referer: https://finance.sina.com.cn/`，否则返回空。
- **写入校验**：写入后用 `sqlite3 data/investment.sqlite "SELECT ..."` 回读，并用 `buildOverview` 确认看板能读取（见末尾校验脚本）。
- **看板刷新**：`serve.cjs` 实时读库，写入后无需重建 `reports/data.json`，刷新页面即可。

---

## 1. 宏观变量 → `kai_invest_market` (record_type='macro')

### 1.1 美联储（FOMC 议息会议）— 先采集

**为什么先采集**：黄金、A 股资金的短期影响判断都依赖美联储政策基调。

**一手来源**：美联储官网声明。

| 步骤 | URL | 方法 |
|------|-----|------|
| ① 确认最新已开会议 | `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm` | 读页面，提取所有 `monetaryYYYYMMDDa.htm` 链接，取日期最新且已过开会日的 |
| ② 读声明全文 | `https://www.federalreserve.gov/newsevents/pressreleases/monetaryYYYYMMDDa.htm` | 提取声明正文（"For release at 2:00 p.m. EDT" 之后） |

**需提取的关键信息**：
- 目标利率区间（如 "3-1/2 to 3-3/4 percent" → 3.5%–3.75%）
- 投票结果（如 "approved ... by a 9 – 3 vote"）
- 异议委员及倾向（如 "preferred to raise ... by 1/4 percentage point"）
- 经济判断描述（就业、通胀、增长措辞）

**写入字段**：`current_value`（利率+投票）、`change_note`（结论/异议/经济判断）、`impact_short`、`impact_mid`、`observed_at`=会议日期、`status`='已更新'。

**陷阱**：
- ⚠️ 不要用搜索引擎摘要里的日期（2025 vs 2026 易混），**必须以 FOMC 日历页官方链接为准**确认最新会议。
- `monetaryYYYYMMDDb.htm` 是「长期目标声明」、`a1.htm` 是实施说明，主声明是 `a.htm`。

---

### 1.2 黄金变量（金价 / 美元指数 / 美债收益率）

#### 国际金价（伦敦金 XAU）— 新浪

```bash
UA="Mozilla/5.0"
curl -s -A "$UA" -H "Referer: https://finance.sina.com.cn/" \
  "https://hq.sinajs.cn/list=hf_XAU" | iconv -f GBK -t UTF-8
```

返回字段（逗号分隔）：`当前价,昨收,今开,最高,最低,...,时间,昨结,...,日期,名称`

```
var hq_str_hf_XAU="4113.24,4066.130,4113.24,4113.59,4120.08,4028.42,00:35:00,4066.13,...,2026-07-31,伦敦金..."
```

> 国内黄金（上海金交所 Au9999）代码 `sh600920` 或看板块页 `quote.eastmoney.com/gjs/`，与伦敦金价位不同（人民币/克 vs 美元/盎司），记录时注明口径。

#### 美元指数（DXY）— MarketWatch

```bash
curl -s "http://localhost:3456/navigate?target=ID&url=https://www.marketwatch.com/investing/index/dxy"
# 等待 ready=complete，提取：
document.querySelector("h2.intraday__price").textContent  // 如 "99.97"
// 同容器内 .change 或文本 "-0.92 -0.91%"
```

- ⚠️ **investing.com 的 `/indices/usd-index`、`/indices/usd-dollar-index` 均 404**，不要用。
- ⚠️ Yahoo Finance `DX-Y.NYB` 的 `fin-streamer[data-field=regularMarketPrice]` 抓取不可靠（会拿到无关大数字），用 `regularMarketPreviousClose` 字段或直接看 MarketWatch。

#### 10 年期美债收益率 — Yahoo Finance `^TNX`

```bash
curl -s "http://localhost:3456/navigate?target=ID&url=https://finance.yahoo.com/quote/%5ETNX/"
# 提取 Previous Close、Day's Range（在 "Previous Close 4.6220 ... Day's Range 4.6510 - 4.6860"）
```

- ⚠️ Yahoo 的 `^TNX` `regularMarketPrice` 字段数值异常（曾显示 454.53），**不可信**。用页面上 "Previous Close" 和 "Day's Range" 文本取值，当前值取 Day's Range 中间值。

---

### 1.3 A 股资金（成交额 / 主力资金 / 北向）

#### 两市成交额 — 新浪（沪深指数）

```bash
curl -s -A "$UA" -H "Referer: https://finance.sina.com.cn/" \
  "https://hq.sinajs.cn/list=sh000001,sz399001" | iconv -f GBK -t UTF-8
```

解析（字段索引，逗号分隔）：
- `[0]` 名称，`[1]` 今开，`[2]` 昨收，`[3]` 现价/收盘，`[4]` 最高，`[5]` 最低
- `[8]` 成交量（手），**`[9]` 成交金额（元）** ← 两市成交额
- `[30]` 日期，`[31]` 时间

```
sh000001: [3]=3804.69(上证收盘), [9]=1106477266462 → 1.106万亿
sz399001: [3]=13285.80(深证收盘), [9]=1236331989082 → 1.236万亿
```

**涨跌幅** = (现价 − 昨收) / 昨收 × 100%。

#### 主力资金净流入 — 东方财富

页面：`https://data.eastmoney.com/zjlx/dpzjlx.html`（用 CDP 打开后读 innerText）

提取关键文本块（正则）：
- `主力净流入：\s*(-?\d+\.\d+)亿` → 如 `-789.9322亿`
- `主力净比：\s*(-?\d+\.\d+)%` → `-3.37%`
- `超大单净流入：...`、`大单净流入：...`、`小单净流入：...`

#### 北向资金（沪深港通）— 东方财富

页面：`https://data.eastmoney.com/hsgt/index.html`

提取：
- `沪股通 成交总额 XXX亿元`
- `深股通 成交总额 XXX亿元`
- `北向资金 成交总额 XXX亿元`

> ⚠️ **重要**：北向资金**实时净流入额自 2024 年 8 月起已停止披露**，公开数据只有成交总额。`change_note` 必须如实标注「净流入已停止披露」，**禁止编造净额**。南向资金净买额仍可获取（港股通沪/深）。

---

## 2. A 股市场环境 → `kai_invest_market` (record_type='market', name='A股市场环境')

### 2.1 指数与成交额

同 [1.3 两市成交额](#13-a-股资金成交额--主力资金--北向)，上证 `sh000001`、深证 `sz399001` 一次取回。

### 2.2 全市场涨跌家数 — 东方财富 clist 接口

直接 `curl` 推 push2 接口会 `http=000`（拒绝非浏览器请求）；在东方财富页面 tab 内 `fetch` 会被 CORS 拦截（`Failed to fetch`）。

**可行方法**：CDP 打开任意东方财富页面（如 `data.eastmoney.com/zjlx/dpzjlx.html`），**在页面内 eval 分页 fetch + 统计**（同源 fetch 在部分页面可用，实测 `zjlx` 页可行）：

```javascript
// 在 eastmoney tab 内 eval（注意 pz 上限约 100，需翻页累加）
var base = "https://push2.eastmoney.com/api/qt/clist/get?pn=P&pz=100&po=1&np=1&fltt=2&invt=2&fields=f3&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
// fs 全 A：沪市主板+深市主板+创业板+科创+北交所
var up=0,down=0,flat=0,zt=0,dt=0,total=null;
for(var p=1;p<=60;p++){
  var r=await fetch(base.replace("P",p),{credentials:"include"});
  var j=await r.json();
  if(!total) total=j.data.total;          // 如 5885
  var diff=j.data.diff; if(!diff||!diff.length) break;
  diff.forEach(function(x){var c=x.f3||0;
    if(c>0)up++; else if(c<0)down++; else flat++;
    if(c>=9.9)zt++; if(c<=-9.9)dt++;
  });
  if(diff.length<100) break;
}
// 输出: total / up / down / flat / zt(涨停≥9.9%) / dt(跌停≤-9.9%)
```

`f3` = 涨跌幅(%)。涨跌停阈值 9.9% 对 ST 股(5%)不精确，仅供市场情绪参考。

> ⚠️ push2 的 CORS 行为不稳定：在某些 eastmoney tab 下 fetch 成功，某些 tab 报 `Failed to fetch`。若失败，尝试先 `navigate` 到 `data.eastmoney.com/zjlx/zjlx.html` 再 eval。统计涨跌家数若实在取不到，降级为「主力资金流向 + 指数涨跌」定性描述，勿编造精确家数。

**写入字段**：
- `metrics_json`：`{indexTrend, turnover, northbound, sentiment, advanceDecline, themePersistence}`
- `current_value`：指数涨跌 + 成交 + 涨跌家数摘要
- `score`(1-5)、`risk_level`(1-5)、`opportunity_level`(1-5)、`strategy`、`rationale`

---

## 3. 板块池行情 → `kai_invest_sector`

**只更新 `indicators`（行情指标）和 `updated_note`（更新说明）**；`rating`/`status`/`cycle`/`logic`/`risks` 属于投资判断，**不随行情自动改动**。

### 3.1 概念板块涨跌 — 新浪（推荐主源）

```bash
UA="Mozilla/5.0"
curl -s -A "$UA" -H "Referer: https://finance.sina.com.cn/" \
  "https://money.finance.sina.com.cn/q/view/newFLJK.php?param=class" \
  | iconv -f GBK -t UTF-8 > /tmp/gn.txt
```

返回 `var S_Finance_bankuai_class = {板块代码:"板块代码,名称,成分股数,均价,涨跌额,涨跌幅,成交量,成交额,领涨股代码,领涨幅,领涨股价,领涨股涨幅,领涨股名", ...}`

按板块名筛选（如 `黄金概念 gn_hjgn`、`猪肉 gn_zr`、`军工航天 gn_jght`、`卫星导航 gn_wxdh`）。

**注意**：「商业航天」无独立概念板块，用「军工航天」「卫星导航」组合近似，并在 `updated_note` 注明。

### 3.2 行业板块涨跌 — 新浪

```bash
curl -s -A "$UA" -H "Referer: https://finance.sina.com.cn/" \
  "https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php" \
  | iconv -f GBK -t UTF-8 > /tmp/hy.txt
```

返回 `var S_Finance_bankuai_sinaindustry = {...}`，字段同上。如 `new_nlmy 农林牧渔`（含猪肉）、`new_ysjs 有色金属`（含黄金）。

### 3.3 龙头个股行情 — 新浪

```bash
codes="sh600988,sh600547,sz002714,sz300498,sh601698,sz300762"  # 赤峰黄金/山东黄金/牧原/温氏/中国卫通/上海瀚讯
curl -s -A "$UA" -H "Referer: https://finance.sina.com.cn/" \
  "https://hq.sinajs.cn/list=$codes" | iconv -f GBK -t UTF-8
```

解析同 [1.3 沪深指数]：`[3]`现价、`[4]`最高、`[5]`最低、`[9]`成交额。涨跌幅=(现价−昨收`[2]`)/昨收。

### 3.4 持仓/关注个股行情 — 新浪（看板「刷新行情」与每日 15:10 定时任务）

`scripts/collect-quotes.cjs` 复用上面的新浪接口，批量拉取**持仓 + 关注**全部 6 位代码（含场内 ETF，如 513310 → `sh513310`），写入 `kai_invest_stock_quote`（代码主键、最新价、当日涨跌幅、采集时间）。

- 只采集客观最新价与涨跌幅，**不做盈亏金额计算**；看板装配时按 `(最新价 − 成本价格) / 成本价格` 展示浮盈/浮亏率。
- 代码前缀规则：`5/6/9` → `sh`，`0/1/2/3` → `sz`，`4/8` → `bj`。
- 非交易时段返回最近收盘价；取不到价格的代码如实标记「未取得数据」，不编造。

---

## 4. 写入与校验

### 4.1 写入示例（SQLite）

```bash
sqlite3 data/investment.sqlite <<'SQL'
UPDATE kai_invest_market
SET status='已更新', current_value='...', change_note='...',
    impact_short='...', impact_mid='...',
    observed_at='2026-07-29', updated_at=datetime('now')
WHERE id=3;  -- 美联储
SQL
```

### 4.2 看板读取校验

```bash
node -e "
const { buildOverview } = require('./investment-analysis.cjs');
const { InvestmentStore } = require('./investment-store.cjs');
const ov = buildOverview(new InvestmentStore());
console.log('宏观:', ov.macro.map(m=>m.name+'('+m.status+')').join(', '));
console.log('市场:', ov.market.name, ov.market.status, 'score='+ov.market.score);
ov.sectors.forEach(s=>console.log('板块:', s.name, '评级'+s.rating));
" 2>/dev/null
```

### 4.3 完整性 checklist（`buildOverview` 生成）

| 维度 | ready 判定 | 当前状态 |
|------|-----------|---------|
| 账户数据 | `metrics.totalAssets` 存在 | ✅（人工） |
| 市场环境 | `hasMarketAssessment` | ✅ 已更新 |
| 持仓逻辑 | 持仓非空且无缺失 | ❌ 持仓为空（需人工） |
| 宏观变量 | `updatedMacro.length > 0` | ✅ 已更新 |
| 视频观点 | `videoEvidence.totalVideos > 0` | ✅ |

---

## 5. 数据源对照速查表

| 数据 | 主源 | 备选 | 不可用（已踩坑） |
|------|------|------|-----------------|
| FOMC 声明 | federalreserve.gov 官网 | — | 搜索引擎摘要日期（易混） |
| 国际金价 | 新浪 `hf_XAU` | — | — |
| 美元指数 | MarketWatch DXY | — | investing.com（404）、Yahoo 抓取错 |
| 10Y 美债 | Yahoo `^TNX` 文本 | — | Yahoo `regularMarketPrice` 字段 |
| 沪深指数/成交额 | 新浪 `hq.sinajs.cn` | 东方财富 push2 | — |
| 主力资金 | 东方财富 `zjlx` 页 | — | — |
| 北向净流入 | **已停止披露**（只记成交额） | — | 任何声称给净额的源 |
| 涨跌家数 | 东方财富 push2 clist（页面内 eval） | 主力资金定性 | push2 跨域直接 curl |
| 概念板块 | 新浪 `newFLJK.php?param=class` | 东方财富概念页 | push2 CORS |
| 行业板块 | 新浪 `newSinaHy.php` | — | — |
| 个股行情 | 新浪 `hq.sinajs.cn` | — | — |

---

## 6. 阿里云云市场备选接口（调研记录）

> 核对日期：2026-08-01。以下商品均为阿里云云市场第三方服务商提供的 API，不等同于交易所官方直连。商品价格、接口状态和套餐内容会变化，购买前必须重新查看商品页并用试用额度验证返回数据。

### 6.1 首选：金融数据 API（`cmapi018884`）

商品页：[金融数据API接口_全球指数API_国内期货API](https://market.aliyun.com/detail/cmapi018884)。当前页面列出全球指数延迟报价、A 股实时报价、A 股延迟排行等接口，并支持上证指数 `SH000001`、深证成指 `SZ399001`、创业板指 `SZ399006`。

其中 **A 股延迟排行**已核对到：

- 调用地址：`https://finance.market.alicloudapi.com/hs/rank`
- 方法：`GET`
- 参数：`sort`、`asc`、`page`、`limit`、`market`
- `limit` 最大 100；`market` 支持 `hs_a`（沪深 A 股）、`hs_bjs`（北交所）、`kcb`（科创板）、`cyb`（创业板）等
- 返回字段包括 `symbol`、`name`、`price`、`preclose`、`volume`、`value`（成交额）、`changeRate`（涨跌幅）、`update_time`

它可以作为看板市场环境的主要行情源：分页拉取全市场后，汇总上涨/下跌/平盘家数、成交额和涨跌停数量。接口本身是排行接口，示例未提供全市场汇总字段，因此需要程序持续翻页直到没有数据；涨跌停统计还要区分普通股、ST、科创板和北交所的不同涨跌幅规则。

页面核对时显示有免费试用和约 `10 元 / 10000 次` 的套餐；如果每天盘后拉取约 55–60 页，一年约需 1.5 万次，正式接入前应以控制台实际套餐为准。

### 6.2 补充候选：A 股个股行情榜单两融量化数据（`cmapi00074224`）

商品页：[A股个股行情榜单两融量化数据服务](https://market.aliyun.com/detail/cmapi00074224)。商品说明声称包含 A 股实时行情、涨停/连板榜、破发查询、两融数据和技术面信号。

它更适合补充“涨停情绪、连板高度、融资情绪”，不应直接当作市场环境的唯一来源。当前公开页面没有完整展示字段、接口路径和稳定性指标，且采用较新的网关/MCP 交付方式；只有在试用调用真实返回并核对数据日期后，才考虑接入。

### 6.3 备用：通用行情及历史数据（`cmapi029045`）

商品页：[通用行情及历史数据](https://market.aliyun.com/detail/cmapi029045)。其“搜索排序查询”接口为 `GET /query/comp`，文档示例支持分页、关键词、市场路由和排序字段，返回结构包含价格、成交额、涨跌幅、涨停价和跌停价等字段。

它理论上也能通过全市场分页汇总涨跌家数和成交额，但每页股票数较少，调用量和接入复杂度高于 `cmapi018884`，因此只作为故障回退，不作为第一选择。

### 6.4 不适合替代市场环境的接口

- `cmapi00045130` 股票历史行情：适合个股 K 线、财务指标和持仓基本面，不提供全市场涨跌汇总；详细字段见 [`api-aliyun-stockhistory.md`](./api-aliyun-stockhistory.md)。
- 单只股票实时行情类商品：只能更新持仓股，不能得到市场宽度、两市成交额或资金流向。
- 仅提供新闻/财经快讯的商品：可以作为事件来源，不能替代行情统计。

### 6.5 接入结论

建议采用混合数据源，而不是把市场环境绑定到一个第三方商品：

1. `cmapi018884`：指数、个股排行、成交额、涨跌家数的主行情源。
2. `cmapi00074224`：试用验证通过后，再补充涨停/连板和两融情绪。
3. 东方财富：继续负责主力资金、北向成交额和板块资金；北向净流入仍按“停止披露”处理，不能编造。
4. 新浪行情：作为指数和板块行情的低成本交叉校验源。

所有阿里云凭据只放在 `.env`，不进入页面、SQLite 或日志。接入后仍须保存 `observed_at`、数据源、接口商品编号和失败原因，确保看板显示的是“哪一天、从哪里来的数据”。

---

## 6.6 持仓股基本面（财务主要指标）— `cmapi00045130`

商品页：<https://market.aliyun.com/detail/cmapi00045130#sku=yuncode3913000009>（极速数据「股票历史行情查询」）。完整接口手册见 [`docs/api-aliyun-stockhistory.md`](api-aliyun-stockhistory.md)。

- **使用接口**：`/stockhistory/financialmain`（财务主要指标，含同比增速）。
- **AppCode**：`.env` 中 `STOCK_FUNDAMENTALS_APP_CODE`。
- **采集范围**：仅采集当前持仓股（`kai_invest_portfolio` 中 `list_type='holding'`、`quantity>0`、`closed_at=''`、有 `stock_code` 的标的）。恒生科技等无代码的标的自动跳过。
- **存储**：写入 `kai_invest_stock_fundamentals` 表（按 `stock_code` 唯一，upsert）。展示时只显示持仓范围内的记录，不影响板块/行情数据。
- **触发方式**：看板「我的持仓」页点击「刷新基本面」按钮，调用 `POST /api/investment/stock-fundamentals/refresh`。单只失败不阻断其余，错误以结构化形式返回。
- **为什么不用本商品做行情**：行情类需求（指数、成交额、涨跌家数）免费接口（新浪/东方财富）已能覆盖，本商品按次计费，仅用于免费接口拿不到的财务报表与主要指标。

---

## 7. 维护说明

- 接口或字段失效时，按「一手优先 > 财经门户 > 二手媒体」回退，并在本文件更新来源、标注发现日期。
- 新增数据项时，先在 [`AGENTS.md` 采集规范](../AGENTS.md) 登记范围与顺序，再在此手册补充具体接口。
- 重大变更（如某数据源永久失效、监管停止披露）用 `> ⚠️` 标注并写明日期。
