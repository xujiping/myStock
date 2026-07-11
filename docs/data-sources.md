# A 股数据源调研报告

> 调研日期：2026-07-11
> 测试环境：macOS / Python 3.13 / 项目 venv313
> 测试标的：航天电子（600879）
> 网络环境：深圳本地开发机（系统代理已禁用，直连测试）

---

## 一、当前项目数据源现状

项目使用 **akshare** 作为唯一数据源，通过三个脚本完成数据采集：

| 脚本 | 数据用途 | akshare 接口 | 底层数据源 |
| :--- | :--- | :--- | :--- |
| `ingest-akshare.py` | 日线 OHLCV + 实时估值 | `stock_zh_a_hist_tx` / `stock_zh_a_hist` | 腾讯（主）→ 东方财富（备） |
| 同上 | 实时市值/PE/PB/换手率 | 直接请求 `qt.gtimg.cn` | 腾讯实时快照 |
| `ingest-company-concepts.py` | 概念板块成分 | `stock_board_concept_name_em` / `stock_board_concept_cons_em` | 东方财富 |
| `ingest-company-industry.py` | 行业归属 | `stock_individual_info_em` | 东方财富（+公开页回退） |

### 稳定性问题

- **东方财富行情 API（push2his.eastmoney.com）在部分网络环境下不可达**（本次测试中连接被拒），导致依赖东财的接口（概念板块、行业归属、全市场快照）间歇性失败。
- akshare 本身是对各网站爬虫接口的封装，上游接口变更会直接影响稳定性。

---

## 二、各数据源实测结果

### 1. BaoStock ✅ 强烈推荐

**安装**: `pip install baostock`

**实测结果**:

| 数据类型 | 测试接口 | 结果 | 延迟 |
| :--- | :--- | :--- | :--- |
| 日 K 线 | `query_history_k_data_plus` | ✅ 6 条，OHLCV + 涨跌幅 + 换手率 | 0.06s |
| 5 分钟 K 线 | `query_history_k_data_plus(freq=5)` | ✅ 96 条 | 0.10s |
| 估值指标 | PE/PB/PS/PCF (TTM/MRQ) | ✅ 6 条 | 0.09s |
| 行业分类 | `query_stock_industry` | ✅ 证监会行业分类 | 0.12s |
| 季频财务 | `query_profit_data` | ✅ ROE/净利率/EPS/总股本等 | 0.16s |

**优势**:
- 证券类 SDK，连接稳定（专用 API 服务器，非爬虫）
- 完全免费，无调用限制、无积分门槛
- 数据可追溯至 1990 年
- 覆盖日线/分钟线/估值/财务/行业，与项目需求高度匹配
- 数据质量规范，字段清晰

**劣势**:
- 需要调用 `bs.login()` / `bs.logout()` 管理会话
- 股票代码需要带市场前缀（`sh.600879` / `sz.000001`）
- 无实时行情快照（仅收盘后的历史数据）
- 无概念板块数据
- 数据更新可能有 1 天延迟

**字段映射到当前项目**:

```
BaoStock 字段              →  项目数据库字段
─────────────────────────────────────────────
date                       →  trade_date
open / high / low / close  →  open/high/low/close_price
volume                     →  volume
amount                     →  turnover
turn                       →  turnover_rate
pctChg                     →  change_pct
peTTM                      →  pe_ttm
pbMRQ                      →  pb
```

---

### 2. Tushare ⚠️ 有条件推荐

**安装**: `pip install tushare`

**实测结果**:

| 数据类型 | 测试接口 | 结果 |
| :--- | :--- | :--- |
| 实时行情（旧版免费） | `get_realtime_quotes` | ✅ 价格/量额（无 PE/PB） |
| 历史日 K（旧版免费） | `get_hist_data` | ❌ 502 Bad Gateway（已弃用） |
| Pro 接口 | 需要 token | 未测试 |

**优势**:
- 数据质量高，社区成熟
- Pro 版覆盖面极广（行情/财务/宏观/基金/期货）
- 旧版实时行情接口无需注册

**劣势**:
- 旧版历史接口已停止维护（502）
- Pro 接口需要注册获取 token，且高级数据有积分门槛（需 120-5000 积分）
- 积分获取方式：注册送 100 分，后续需通过社区贡献或付费获取

**结论**: 如果愿意注册 Pro 账号并积累积分，是数据质量最高的选择。项目已将其接入为概念归属的自动回退源；需在 `.env` 中配置 `TUSHARE_TOKEN`，且账户需具备 `concept_detail` 的调用权限。

---

### 3. efinance ❌ 网络兼容性问题

**安装**: `pip install efinance`

**实测结果**: ❌ 连接东方财富 API（push2his.eastmoney.com）失败

**原因分析**:
- efinance 底层完全依赖东方财富行情 API
- 当前开发网络环境下 `push2his.eastmoney.com` 不可达
- 与 akshare 的东财接口遇到相同问题

**如果网络可达时的能力（基于文档）**:
- 日 K 线、实时行情快照（全市场）
- 基本面/财务指标
- 基金、债券、期货数据

**结论**: 与 akshare 的东财数据源重叠，在 akshare 已经不稳定的情况下，不能作为有效备份。**不建议作为主数据源或备用源**。

---

### 4. Ashare ✅ 可选轻量备份

**安装**: 非 PyPI 包，需从 GitHub 获取单文件
```bash
curl -O https://raw.githubusercontent.com/mpquant/Ashare/main/Ashare.py
```

**实测结果**: 底层数据源（腾讯 `web.ifzq.gtimg.cn` + 新浪 `hq.sinajs.cn`）均可达 ✅

**优势**:
- 单文件实现，零依赖（仅需 requests + pandas）
- 新浪 + 腾讯双数据源，自动故障切换
- 日线/分钟线/实时行情全覆盖
- 代码极简，易于维护和定制

**劣势**:
- 非标准 PyPI 包，需要手动管理
- 无财务数据、概念板块、行业分类
- 数据字段较少（仅 OHLCV）
- 无文档和社区支持

**结论**: 适合作为日线行情的**轻量级备份**，与项目现有的腾讯接口互补。但功能覆盖面不足以替代 akshare。

---

### 5. AData ⚠️ 部分功能可用

**安装**: `pip install adata`

**实测结果**:

| 数据类型 | 测试接口 | 结果 |
| :--- | :--- | :--- |
| 财务核心指标 | `stock.finance.get_core_index` | ✅ 111 条，43 个指标字段 |
| 日 K 线（东财源） | `stock.market.get_market` | ❌ 0 条（东财不可达） |
| 腾讯实时行情 | `stock.market.qq_market.list_market_current` | ❌ 0 条 |
| 新浪实时行情 | `stock.market.sina_market.list_market_current` | ❌ 0 条 |
| 概念板块（东财） | `get_market_concept_east` | ❌ 东财不可达 |

**优势**:
- 多数据源架构设计（东财/腾讯/新浪/同花顺/百度）
- 财务指标数据丰富（43 个字段）
- 内置代理功能应对反爬
- 支持概念板块、资金流向等衍生数据

**劣势**:
- 行情数据严重依赖东方财富，东财不可达时大面积失效
- 腾讯/新浪行情源在当前版本返回空数据（疑似 API 变更或版本兼容问题）
- 分钟级数据不稳定
- 版本迭代快，API 可能变化

**结论**: 财务数据接口可用且丰富，但行情接口在当前环境下不可靠。可作为**财务数据的补充源**，不建议作为行情主源。

---

### 6. TickFlow ⚠️ 免费版能力有限

**安装**: `pip install tickflow`

**实测结果**:

| 数据类型 | 测试接口 | 结果 |
| :--- | :--- | :--- |
| 标的信息 | `TickFlow.free().instruments.get` | ✅ 总股本/流通股本/上市日期/涨跌停价 |
| 日 K 线 | `TickFlow.free().klines.get` | ❌ A 股返回格式异常（仅返回周期标识） |

**免费版能力**:
- ✅ 标的基本信息（上市日期、总股本、流通股本、涨跌停价）
- ✅ 历史 K 线（官方说明，实测 A 股日 K 返回异常）
- ❌ 无实时行情
- ❌ 无分钟 K 线
- ❌ 无估值/财务数据

**优势**:
- 有官方 SDK，无需注册即可使用免费版
- 标的信息含涨跌停价等特色字段
- 可平滑升级到付费版（实时数据）

**劣势**:
- 免费版 A 股日 K 数据测试不通过（可能仅支持其他市场）
- 免费版无实时数据
- 功能覆盖面窄

**结论**: 免费版对当前项目价值有限，仅可补充标的基本信息。如需实时数据需付费。

---

## 三、综合对比

| 数据源 | 日K线 | 实时行情 | 分钟线 | PE/PB估值 | 财务数据 | 行业 | 概念板块 | 稳定性 | 费用 | 接入推荐度 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **akshare**（现有） | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ⚠️ | 免费 | 基线 |
| **BaoStock** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ 高 | 免费 | ★★★★★ |
| **Tushare Pro** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 高 | 积分制 | ★★★★☆ |
| **efinance** | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ 低 | 免费 | ★☆☆☆☆ |
| **Ashare** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ 高 | 免费 | ★★★☆☆ |
| **AData** | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ | ❌ | ⚠️ | ⚠️ 中 | 免费 | ★★☆☆☆ |
| **TickFlow** | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ 高 | 免费/付费 | ★☆☆☆☆ |

---

## 四、接入建议

### 已采用方案：AKShare + BaoStock 双数据源

```
行情数据（日线 OHLCV + 估值）
    主源: AKShare（腾讯日线 + 腾讯实时快照）
    备源: BaoStock（日线 + PE/PB/换手率）    ← 已接入，腾讯失败时自动切换
    末备: AKShare（东方财富日线）

财务数据（新增能力）
    源:   BaoStock（季频盈利能力）             ← 已接入，完整原始字段入库
    扩展: AData（43 个财务指标字段，暂不纳入关键链路）

行业归属
    主源: BaoStock（证监会行业分类）         ← 已接入，当前网络环境最稳定
    备源: AKShare（东方财富个股信息）
    末备: 东方财富公开个股页

概念板块
    主源: akshare（东方财富概念板块）        ← 默认优先
    回退: Tushare Pro（按公司 concept_detail） ← 已接入，需 TUSHARE_TOKEN
```

### 实施步骤

1. 在 `requirements.txt` 中添加 `baostock>=0.8.80,<1` ✅
2. 在 `ingest-akshare.py` 的日线与估值链路中接入 BaoStock 回退 ✅
3. 在 `ingest-company-industry.py` 中接入 BaoStock 证监会行业分类 ✅
4. 新增 `ingest-baostock-finance.py` 和 `aero_financial_profit`，采集季频财务指标 ✅
5. 在 `ingest-company-concepts.py` 中接入 Tushare Pro 概念明细回退，东财整体不可用时自动按公司补齐 ✅

### BaoStock 接入示例

```python
import baostock as bs

def fetch_baostock_history(stock_code: str, start: date, end: date):
    """BaoStock 日线回退源"""
    prefix = "sh" if stock_code.startswith(("5", "6", "9")) else "bj" if stock_code.startswith(("4", "8")) else "sz"
    bs_code = f"{prefix}.{stock_code.zfill(6)}"
    bs.login()
    try:
        rs = bs.query_history_k_data_plus(
            bs_code,
            "date,code,open,high,low,close,volume,amount,turn,pctChg,peTTM,pbMRQ",
            start_date=start.strftime("%Y-%m-%d"), end_date=end.strftime("%Y-%m-%d"),
            frequency="d", adjustflag="3"
        )
        rows = []
        while (rs.error_code == '0') and rs.next():
            rows.append(rs.get_row_data())
        return rows, "BaoStock"
    finally:
        bs.logout()
```

---

## 五、测试脚本

本次调研的测试脚本保存在 `scripts/` 目录下：

- `test-datasources.py` - 首轮全量测试
- `test-datasources-2.py` 至 `test-datasources-6.py` - 逐轮深入测试

可随时运行复现：

```bash
.venv313/bin/python scripts/test-datasources.py
```
