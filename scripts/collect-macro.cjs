#!/usr/bin/env node
/*
 * 宏观变量一键采集 → 写入 kai_invest_market (record_type='macro')。
 *
 * 按 AGENTS.md 规定的顺序：美联储 → 黄金 → A 股资金。每项独立采集，
 * 单项失败不阻断其余，失败项如实标注原因。
 *
 * 数据来源（均已在 2026-08-01 验证）：
 *   1. 美联储：federalreserve.gov 官网，先读 FOMC 日历确认最新已开会议，再读声明
 *   2. 黄金：已有 gold-market.cjs（阿里云探数API 上海金交所），直接复用
 *   3. 美元指数：MarketWatch DXY（CDP）
 *   4. 10Y 美债：Yahoo ^TNX 取 Previous Close / Day's Range（CDP，不用异常的 regularMarketPrice）
 *   5. A 股资金：复用 collect-market 的成交额/主力资金（已写入 market 记录），这里只回填 macro 行
 *
 * 写入策略：只更新客观事实（current_value/change_note/impact_* 描述客观影响方向），
 * 不自动写入投资动作 strategy（属用户判断）。
 *
 * 用法：
 *   node scripts/collect-macro.cjs              # 采集全部
 *   node scripts/collect-macro.cjs --only fed   # 只采集美联储
 *   node scripts/collect-macro.cjs --only gold
 *   node scripts/collect-macro.cjs --only fund
 *   node scripts/collect-macro.cjs --skip fed   # 跳过某项
 *   node scripts/collect-macro.cjs --dry-run
 */
require('dotenv').config();

const path = require('node:path');
const { InvestmentStore } = require('../investment-store.cjs');
const { localDate } = require('../investment-store.cjs');
const { curl, scrapePage, sleep } = require('./lib/net-collect.cjs');
const { installOperationLogger } = require('../operation-log.cjs');
installOperationLogger({ category: 'collection', operationKey: 'collect-macro', title: '宏观变量采集' });

function args() {
  const a = process.argv.slice(2);
  const onlyIdx = a.indexOf('--only');
  const skipIdx = a.indexOf('--skip');
  return {
    dryRun: a.includes('--dry-run'),
    only: onlyIdx >= 0 ? a[onlyIdx + 1] : '',
    skip: skipIdx >= 0 ? a[skipIdx + 1] : '',
  };
}

// ── 美联储 ─────────────────────────────────────────────────────

async function collectFed() {
  // 读 FOMC 日历，找最新已开会议的声明链接
  const cal = curl('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', { timeoutMs: 15000 });
  if (!cal.ok) return { ok: false, error: `FOMC 日历抓取失败：${cal.error}` };
  const links = [...cal.body.matchAll(/monetary(\d{8})a\.htm/g)].map((m) => m[1]);
  if (!links.length) return { ok: false, error: 'FOMC 日历未找到会议声明链接' };
  const today = localDate().replace(/-/g, '');
  // 取日期 <= 今天、且最大的（已开会议）
  const past = links.filter((d) => d <= today).sort();
  const latest = past[past.length - 1];
  if (!latest) return { ok: false, error: 'FOMC 日历中没有已召开的会议' };
  const dateStr = `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}`;

  const stmt = curl(`https://www.federalreserve.gov/newsevents/pressreleases/monetary${latest}a.htm`, { timeoutMs: 15000 });
  if (!stmt.ok) return { ok: false, error: `声明页抓取失败：${stmt.error}` };

  const text = stmt.body;
  // 提取利率区间
  const rateMatch = text.match(/target range for the federal funds rate[^.]*?(\d[–\-\s]?\d?\s?(?:to\s)?[\d/]+\s?(?:to\s)?[\d/]+\s?percent)/i)
    || text.match(/(\d[–\-]\d\s?(?:to\s)?\d\s?(?:to\s)?\d?\s?percent)/i);
  // 投票结果
  const voteMatch = text.match(/(\d+)\s*(?:to|–|-)\s*(\d+)\s*vote/i) || text.match(/approved[^.]*?by a\s*(\d+)[^]*?(\d+)\s*vote/i);
  // 异议
  const dissentMatch = text.match(/([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)[^.]*(?:preferred|dissented)[^.]*\./);

  const rate = rateMatch ? rateMatch[1].replace(/\s+/g, ' ').trim() : '未解析到利率区间';
  const vote = voteMatch ? `${voteMatch[1]}-${voteMatch[2]}` : '投票结果未解析';
  const dissent = dissentMatch ? dissentMatch[0].replace(/\s+/g, ' ').trim().slice(0, 200) : '';

  return {
    ok: true,
    date: dateStr,
    currentValue: `目标利率区间 ${rate}（${dateStr} FOMC）`,
    changeNote: `投票 ${vote}${dissent ? `；异议：${dissent}` : '；无异议或未解析'}`,
    impactShort: '依会议基调与投票分歧判断（需人工确认对持仓的短期影响）',
    impactMid: '依会议经济预测与政策路径判断（需人工确认中期影响）',
  };
}

// ── 美元指数 DXY ────────────────────────────────────────────────

async function collectDxy() {
  const r = await scrapePage(
    'https://www.marketwatch.com/investing/index/dxy',
    `(() => {
      const priceEl = document.querySelector('h2.intraday__price');
      const price = priceEl ? priceEl.textContent.trim() : '';
      const changeEl = document.querySelector('.intraday__change');
      const change = changeEl ? changeEl.textContent.trim().replace(/\\s+/g, ' ') : '';
      return { price, change };
    })()`,
    { waitMs: 4500 },
  );
  if (!r.ok) return { ok: false, error: `MarketWatch DXY 采集失败：${r.error}` };
  const { price, change } = r.value || {};
  if (!price) return { ok: false, error: 'DXY 页面未解析到价格' };
  return { ok: true, value: `${price}${change ? `（${change}）` : ''}` };
}

// ── 10Y 美债 ^TNX ───────────────────────────────────────────────

async function collectTnx() {
  // 文档：regularMarketPrice 异常，取 Previous Close 与 Day's Range 文本
  const r = await scrapePage(
    'https://finance.yahoo.com/quote/%5ETNX/',
    `(() => {
      const text = document.body.innerText;
      const pc = text.match(/Previous Close\\s*([\\d.]+)/);
      const dr = text.match(/Day's Range\\s*([\\d.]+)\\s*[–-]\\s*([\\d.]+)/);
      return {
        prevClose: pc ? pc[1] : '',
        low: dr ? dr[1] : '',
        high: dr ? dr[2] : '',
      };
    })()`,
    { waitMs: 5000 },
  );
  if (!r.ok) return { ok: false, error: `Yahoo ^TNX 采集失败：${r.error}` };
  const { prevClose, low, high } = r.value || {};
  if (!prevClose && !high) return { ok: false, error: '^TNX 未解析到收益率' };
  const mid = low && high ? ((Number(low) + Number(high)) / 2).toFixed(3) : prevClose;
  return {
    ok: true,
    value: `${mid}%（前收 ${prevClose || '—'}%，区间 ${low || '—'}–${high || '—'}%）`,
    prevClose,
    low,
    high,
  };
}

// ── 写入 ────────────────────────────────────────────────────────

function upsertMacro(store, name, fields, payload) {
  const records = store.list('market', { record_type: 'macro' });
  const target = records.find((r) => r.name === name);
  if (target) return store.update('market', target.id, { ...payload, ...fields }, { source: 'collect' });
  return store.create('market', { record_type: 'macro', name, ...payload, ...fields }, { source: 'collect' });
}

async function run() {
  const opt = args();
  const want = (key) => (!opt.only || opt.only === key) && opt.skip !== key;

  const results = { fed: null, gold: null, fund: null, dxy: null, tnx: null };

  if (want('fed')) {
    console.log('▶ 采集美联储（FOMC 最新声明）…');
    results.fed = await collectFed();
    console.log(`  ${results.fed.ok ? '✓ ' : '✗ '}${results.fed.ok ? results.fed.currentValue : results.fed.error}`);
  }

  let goldInfo = null;
  let dxyInfo = null;
  let tnxInfo = null;
  if (want('gold')) {
    console.log('▶ 采集黄金变量（金价/美元指数/美债）…');
    // 金价复用 gold-market.cjs
    try {
      const { refreshGoldMarket } = require('../gold-market.cjs');
      const store = opt.dryRun ? null : new InvestmentStore();
      if (store) {
        goldInfo = await refreshGoldMarket(store, { force: true });
        console.log(`  ✓ 金价已同步：${goldInfo.quotes[0].name} ${goldInfo.quotes[0].price}（${goldInfo.marketUpdatedAt}）`);
        store.close();
      } else {
        const { fetchGoldMarket } = require('../gold-market.cjs');
        goldInfo = await fetchGoldMarket({ force: true });
        console.log(`  ✓ [DRY] 金价：${goldInfo.quotes[0].name} ${goldInfo.quotes[0].price}`);
      }
    } catch (err) {
      goldInfo = { ok: false, error: err.message };
      console.log(`  ✗ 金价：${err.message}`);
    }
    // 美元指数
    dxyInfo = await collectDxy();
    console.log(`  ${dxyInfo.ok ? '✓' : '✗'} 美元指数 DXY：${dxyInfo.ok ? dxyInfo.value : dxyInfo.error}`);
    // 美债
    tnxInfo = await collectTnx();
    console.log(`  ${tnxInfo.ok ? '✓' : '✗'} 10Y 美债：${tnxInfo.ok ? tnxInfo.value : tnxInfo.error}`);
  }

  if (want('fund')) {
    console.log('▶ 采集 A 股资金（复用市场环境成交额/主力资金）…');
    // 复用 collect-market 的采集逻辑，但不重复写 market 记录
    const sina = curl(`https://hq.sinajs.cn/list=sh000001,sz399001`, { referer: 'https://finance.sina.com.cn/', gbk: true });
    if (sina.ok) {
      const shM = sina.body.match(/var hq_str_sh000001="([^"]*)"/);
      const szM = sina.body.match(/var hq_str_sz399001="([^"]*)"/);
      const turnover = shM && szM ? Number(shM[1].split(',')[9]) + Number(szM[1].split(',')[9]) : 0;
      const date = shM ? shM[1].split(',')[30] : localDate();
      results.fund = {
        ok: true,
        date,
        turnover,
        text: `${date} 两市成交 ${(turnover / 1e8).toFixed(0)} 亿`,
      };
      console.log(`  ✓ ${results.fund.text}`);
    } else {
      results.fund = { ok: false, error: sina.error };
      console.log(`  ✗ ${sina.error}`);
    }
  }

  if (opt.dryRun) {
    console.log('\n[DRY-RUN] 采集结果概览，未写库。');
    return;
  }

  const store = new InvestmentStore();
  try {
    if (results.fed) {
      if (results.fed.ok) {
        upsertMacro(store, '美联储', {
          status: '已更新',
          current_value: results.fed.currentValue,
          change_note: results.fed.changeNote,
          impact_short: results.fed.impactShort,
          impact_mid: results.fed.impactMid,
          observed_at: results.fed.date,
        }, {});
        console.log('  ✓ 美联储已写入');
      } else {
        upsertMacro(store, '美联储', {
          status: '采集失败',
          change_note: `采集失败：${results.fed.error}`,
        }, {});
        console.log('  ⚠ 美联储采集失败已如实标注');
      }
    }

    if (want('gold')) {
      const goldParts = [];
      if (goldInfo && goldInfo.ok === undefined && goldInfo.quotes) {
        const q = goldInfo.quotes[0];
        goldParts.push(`${q.name} ${q.price}${q.changePercent != null ? `（${q.changePercent > 0 ? '+' : ''}${q.changePercent}%）` : ''}`);
      } else if (goldInfo && goldInfo.error) {
        goldParts.push(`金价：${goldInfo.error}`);
      }
      if (dxyInfo && dxyInfo.ok) goldParts.push(`美元指数 ${dxyInfo.value}`);
      if (tnxInfo && tnxInfo.ok) goldParts.push(`10Y 美债 ${tnxInfo.value}`);
      if (goldParts.length) {
        upsertMacro(store, '黄金变量', {
          status: goldParts.length >= 3 ? '已更新' : '部分更新',
          current_value: goldParts.join(' · '),
          change_note: `${localDate()} 同步（金价来自探数API，美元/美债来自 MarketWatch/Yahoo）`,
          observed_at: localDate(),
        }, {});
        console.log('  ✓ 黄金变量已写入');
      }
    }

    if (results.fund && results.fund.ok) {
      upsertMacro(store, 'A股资金', {
        status: '已更新',
        current_value: `${results.fund.text}（主力资金净流入见市场环境记录）`,
        change_note: `${results.fund.date} 收盘；北向净流入自 2024 年起已停止披露`,
        observed_at: results.fund.date,
      }, {});
      console.log('  ✓ A 股资金已写入');
    }
    console.log('\n✓ 宏观变量采集完成');
  } finally {
    store.close();
  }
}

run().catch((err) => {
  console.error(`\n✗ 宏观采集失败：${err.message}`);
  process.exit(1);
});
