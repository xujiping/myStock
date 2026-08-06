#!/usr/bin/env node
/*
 * A 股市场环境一键采集 → 写入 kai_invest_market (record_type='market', name='A股市场环境')。
 *
 * 数据来源（均已在 2026-08-01 验证）：
 *   - 新浪行情 hq.sinajs.cn：上证、深证收盘价 / 涨跌幅 / 两市成交额（GBK）
 *   - 东方财富 data.eastmoney.com/zjlx/dpzjlx.html：主力资金净流入、超大/大/中/小单、
 *     涨跌平家数（CDP 取 innerText，避免 push2 接口 CORS）
 *
 * 写入策略：
 *   - 客观行情数据照实写入 current_value / metrics_json
 *   - score / risk_level / opportunity_level / strategy / rationale 属于投资判断，
 *     不自动编造；若调用方未通过 --score 传入，则保留既有评分不动，仅在日志标注。
 *   - 北向资金净流入自 2024 年起已停止披露，只记录「成交总额」，不编造净额。
 *
 * 用法：
 *   node scripts/collect-market.cjs                  # 只采集，评分留空
 *   node scripts/collect-market.cjs --score 3 --risk 3 --opp 4 --strategy '...'
 *   node scripts/collect-market.cjs --dry-run        # 只打印不写库
 *
 * 依赖：curl + iconv（系统自带）、CDP Proxy（web-access skill）。
 */
require('dotenv').config();

const path = require('node:path');
const { InvestmentStore } = require('../investment-store.cjs');
const { localDate } = require('../investment-store.cjs');
const { curl, scrapePage, sleep } = require('./lib/net-collect.cjs');
const { parseSinaQuote, parseMainFunds, parseAdvanceDecline } = require('./lib/parsers.cjs');
const { installOperationLogger } = require('../operation-log.cjs');
installOperationLogger({ category: 'collection', operationKey: 'collect-market', title: 'A 股市场采集' });

const SH = 'sh000001';
const SZ = 'sz399001';

function fmtTurnover(yuan) {
  if (!yuan) return '—';
  if (yuan >= 1e12) return `${(yuan / 1e12).toFixed(2)}万亿`;
  if (yuan >= 1e8) return `${(yuan / 1e8).toFixed(0)}亿`;
  return `${yuan.toFixed(0)}`;
}

function describeSentiment(ad, mainNet) {
  if (!ad) return '涨跌家数暂无';
  const ratio = ad.down ? ad.up / ad.down : ad.up;
  if (mainNet != null && mainNet > 200 && ratio > 2) return '偏强（普涨+主力净流入）';
  if (mainNet != null && mainNet < -200 && ratio < 0.5) return '偏弱（普跌+主力净流出）';
  if (ratio >= 2) return '赚钱效应较好';
  if (ratio <= 0.5) return '赚钱效应较差';
  return '分化';
}

function describeThemePersistence() {
  // 涨停板高度/连板数据不在当前页面，如实标注，不编造
  return '需结合涨停榜单独统计（当前页面未提供）';
}

async function collect() {
  const args = process.argv.slice(2);
  const flag = (k) => args.find((a) => a.startsWith(`--${k}=`));
  const dryRun = args.includes('--dry-run');
  const overrideScore = Number(flag('score'));
  const overrideRisk = Number(flag('risk'));
  const overrideOpp = Number(flag('opp'));
  const overrideStrategy = flag('strategy');

  console.log('▶ 采集沪深指数 + 成交额（新浪）…');
  const sina = curl(`https://hq.sinajs.cn/list=${SH},${SZ}`, {
    referer: 'https://finance.sina.com.cn/',
    gbk: true,
  });
  // 新浪是核心数据源；重试后仍失败时降级为「采集失败」标注入库（不 exit），
  // 让看板如实展示而非丢失整天数据。符合 AGENTS.md §2.2「如实标注采集失败」。
  if (!sina.ok) {
    console.warn(`  ⚠ 新浪行情采集失败：${sina.error}（已重试）。降级写「采集失败」标注。`);
    if (!dryRun) {
      const store = new InvestmentStore();
      try {
        const records = store.list('market', { record_type: 'market' });
        const target = records.find((r) => r.name === 'A股市场环境');
        const failPayload = {
          status: '采集失败',
          change_note: `${localDate()} 新浪行情采集失败：${sina.error}（指数/成交额缺失）`,
          observed_at: localDate(),
        };
        if (target) store.update('market', target.id, failPayload, { source: 'collect' });
        else store.create('market', { record_type: 'market', name: 'A股市场环境', current_value: '采集失败', ...failPayload }, { source: 'collect' });
      } finally { store.close(); }
    }
    return;
  }
  const shQuote = parseSinaQuote(sina.body, SH);
  const szQuote = parseSinaQuote(sina.body, SZ);
  if (!shQuote || !szQuote) throw new Error('新浪行情解析失败（返回内容异常）');
  const totalTurnover = shQuote.turnover + szQuote.turnover;
  const tradingDate = shQuote.date || localDate();
  console.log(`  上证 ${shQuote.price} (${shQuote.changePct >= 0 ? '+' : ''}${shQuote.changePct}%) · 深证 ${szQuote.price} (${szQuote.changePct >= 0 ? '+' : ''}${szQuote.changePct}%)`);
  console.log(`  两市成交额 ${fmtTurnover(totalTurnover)} · 日期 ${tradingDate}`);

  console.log('▶ 采集主力资金 + 涨跌家数（东方财富 CDP）…');
  const funds = await scrapePage(
    'https://data.eastmoney.com/zjlx/dpzjlx.html',
    'document.body.innerText',
    { waitMs: 4000 },
  );
  let mainFunds = null;
  let advanceDecline = null;
  if (funds.ok) {
    mainFunds = parseMainFunds(String(funds.value));
    advanceDecline = parseAdvanceDecline(String(funds.value));
    console.log(`  主力净流入 ${mainFunds.mainNet ?? '—'} 亿（${mainFunds.mainPct ?? '—'}%）`);
    if (advanceDecline) {
      console.log(`  涨跌家数 涨${advanceDecline.up} 平${advanceDecline.flat} 跌${advanceDecline.down}`);
    }
  } else {
    console.warn(`  ⚠ 东方财富采集失败：${funds.error}（降级为仅指数+成交）`);
  }

  const sentiment = describeSentiment(advanceDecline, mainFunds && mainFunds.mainNet);
  const themePersistence = describeThemePersistence();

  const currentValue = [
    `上证 ${shQuote.price}（${shQuote.changePct >= 0 ? '+' : ''}${shQuote.changePct}%）`,
    `深证 ${szQuote.price}（${szQuote.changePct >= 0 ? '+' : ''}${szQuote.changePct}%）`,
    `两市成交 ${fmtTurnover(totalTurnover)}`,
    advanceDecline ? `涨${advanceDecline.up}/平${advanceDecline.flat}/跌${advanceDecline.down}` : '',
    mainFunds && mainFunds.mainNet != null ? `主力净流入 ${mainFunds.mainNet} 亿（${mainFunds.mainPct}%）` : '',
  ].filter(Boolean).join(' · ');

  const metrics = {
    indexTrend: {
      sh: { price: shQuote.price, changePct: shQuote.changePct, prevClose: shQuote.prevClose },
      sz: { price: szQuote.price, changePct: szQuote.changePct, prevClose: szQuote.prevClose },
    },
    turnover: { yuan: totalTurnover, text: fmtTurnover(totalTurnover) },
    mainFunds,
    advanceDecline,
    sentiment,
    themePersistence,
    // §3：北向资金净流入自 2024 年起已停止披露；成交总额需从 data.eastmoney.com/hsgt/ 单独抓取，
    // 当前采集器尚未接入该接口，如实标注「未采集」而非编造或含糊措辞（§2.2 第4条）。
    northbound: { netInflow: '已停止披露（自2024年起）', totalTurnover: '未采集（待接入 hsgt 接口）' },
  };

  const payload = {
    status: '已更新',
    current_value: currentValue,
    // change_note 承载数据来源说明（rationale 属判断字段，collect 不可写，见 AGENTS.md §2.1）
    change_note: `${tradingDate} 收盘数据：${sentiment}；成交 ${fmtTurnover(totalTurnover)}。来源：新浪行情（指数/成交额）+ 东方财富大盘资金流向页（主力资金/涨跌家数）。北向净流入已停止披露。`,
    metrics_json: metrics,
    observed_at: tradingDate,
  };

  // 评分类字段：调用方明确传入才覆盖，否则保留既有判断（不替用户做投资决策）
  // 注意：判断字段（score/risk_level/opportunity_level/strategy）属人工判断，collect 不可写，
  // 故 CLI --score 等改走 manual source 显式写入（§2.1：判断字段限 analyze/manual）。
  const overrides = {};
  if (Number.isFinite(overrideScore) && overrideScore > 0) overrides.score = overrideScore;
  if (Number.isFinite(overrideRisk) && overrideRisk > 0) overrides.risk_level = overrideRisk;
  if (Number.isFinite(overrideOpp) && overrideOpp > 0) overrides.opportunity_level = overrideOpp;
  if (overrideStrategy) overrides.strategy = overrideStrategy;

  if (dryRun) {
    console.log('\n[DRY-RUN] 将写入 payload（source=collect）+ overrides（source=manual）：');
    console.log(JSON.stringify({ ...payload, ...overrides }, null, 2));
    return;
  }

  const store = new InvestmentStore();
  try {
    const records = store.list('market', { record_type: 'market' });
    const target = records.find((r) => r.name === 'A股市场环境');
    let saved;
    // 先用 collect 写入客观行情（不含判断字段）
    if (target) {
      saved = store.update('market', target.id, payload, { source: 'collect' });
    } else {
      saved = store.create('market', { record_type: 'market', name: 'A股市场环境', ...payload }, { source: 'collect' });
    }
    // 若有 CLI 显式传入的判断字段，再以 manual 单独写入（与采集数据分离，留痕清晰）
    if (Object.keys(overrides).length) {
      saved = store.update('market', saved.id, overrides, { source: 'manual' });
    }
    console.log(`\n✓ 已写入 A 股市场环境（id=${saved.id}，observed_at=${saved.observed_at}）`);
    if (Object.keys(overrides).length) {
      console.log(`  已同步覆盖评分字段：${Object.keys(overrides).join('、')}（来自命令行参数）。`);
    } else {
      console.log('  评分/风险/机会/策略未通过参数传入，保留既有判断值（避免自动编造投资决策）。');
    }
    console.log(`  可运行 npm run serve 后刷新看板查看。`);
  } finally {
    store.close();
  }
}

collect().catch((err) => {
  console.error(`\n✗ 采集失败：${err.message}`);
  process.exit(1);
});
