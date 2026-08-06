#!/usr/bin/env node
/*
 * 板块池行情一键采集 → 只更新 kai_invest_sector 的 indicators / updated_note。
 *
 * 严格遵守 AGENTS.md：rating/status/logic/risks 属于投资判断，不随行情自动改动。
 *
 * 数据来源（均已在 2026-08-01 验证）：
 *   - 新浪概念板块：money.finance.sina.com.cn/q/view/newFLJK.php?param=class（GBK）
 *   - 新浪行业板块：vip.stock.finance.sina.com.cn/q/view/newSinaHy.php（GBK）
 *   - 龙头个股：hq.sinajs.cn（GBK）
 *
 * 板块名映射（概念板块代码）：
 *   黄金 → 黄金概念 gn_hjgn / 有色金属行业
 *   猪肉 → 猪肉概念 gn_zr / 农林牧渔行业
 *   商业航天 → 军工航天 gn_jght + 卫星导航 gn_wxdh（无独立概念板块，组合近似）
 *
 * 用法：
 *   node scripts/collect-sector.cjs              # 采集全部板块行情
 *   node scripts/collect-sector.cjs --dry-run
 *   node scripts/collect-sector.cjs --name 黄金  # 只采集指定板块
 */
require('dotenv').config();

const { InvestmentStore } = require('../investment-store.cjs');
const { localDate } = require('../investment-store.cjs');
const { curl } = require('./lib/net-collect.cjs');
const { parseSinaBoard, parseSinaStocks } = require('./lib/parsers.cjs');
const { installOperationLogger } = require('../operation-log.cjs');
installOperationLogger({ category: 'collection', operationKey: 'collect-sector', title: '板块行情采集' });

// 板块名 → 采集配置
const SECTOR_CONFIG = {
  '黄金': {
    conceptNames: ['黄金概念'],
    industryNames: ['有色金属'],
    leaders: ['sh600988', 'sh600547'], // 赤峰黄金、山东黄金
  },
  '猪肉': {
    conceptNames: ['猪肉'],
    industryNames: ['农林牧渔'],
    leaders: ['sz002714', 'sz300498'], // 牧原、温氏
  },
  '商业航天': {
    conceptNames: ['军工航天', '卫星导航'],
    industryNames: [],
    leaders: ['sh601698', 'sz300762'], // 中国卫通、上海瀚讯
    note: '「商业航天」无独立概念板块，用军工航天+卫星导航组合近似',
  },
};

function fetchConceptBoards() {
  const r = curl('https://money.finance.sina.com.cn/q/view/newFLJK.php?param=class', {
    referer: 'https://finance.sina.com.cn/', gbk: true,
  });
  return r.ok ? parseSinaBoard(r.body, 'S_Finance_bankuai_class') : {};
}

function fetchIndustryBoards() {
  const r = curl('https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php', {
    referer: 'https://finance.sina.com.cn/', gbk: true,
  });
  return r.ok ? parseSinaBoard(r.body, 'S_Finance_bankuai_sinaindustry') : {};
}

function fetchStocks(codes) {
  if (!codes.length) return {};
  const r = curl(`https://hq.sinajs.cn/list=${codes.join(',')}`, {
    referer: 'https://finance.sina.com.cn/', gbk: true,
  });
  return r.ok ? parseSinaStocks(r.body) : {};
}

function describeBoardChange(concepts, industries) {
  const all = [...Object.values(concepts), ...Object.values(industries)];
  if (!all.length) return '未取到板块行情';
  const avg = all.reduce((s, b) => s + (b.changePct || 0), 0) / all.length;
  if (avg > 1.5) return `板块走强（均值 +${avg.toFixed(2)}%）`;
  if (avg > 0.3) return `板块小涨（均值 +${avg.toFixed(2)}%）`;
  if (avg < -1.5) return `板块走弱（均值 ${avg.toFixed(2)}%）`;
  if (avg < -0.3) return `板块小跌（均值 ${avg.toFixed(2)}%）`;
  return `板块震荡（均值 ${avg.toFixed(2)}%）`;
}

function collectSector(name, config, concepts, industries, stocks) {
  const matchedConcepts = config.conceptNames
    .map((n) => concepts[n])
    .filter(Boolean);
  const matchedIndustries = config.industryNames
    .map((n) => industries[n])
    .filter(Boolean);
  const leaders = config.leaders
    .map((c) => stocks[c])
    .filter(Boolean);

  const change = describeBoardChange(
    Object.fromEntries(matchedConcepts.map((b) => [b.name, b])),
    Object.fromEntries(matchedIndustries.map((b) => [b.name, b])),
  );

  const indicators = {
    concepts: matchedConcepts.map((b) => ({ name: b.name, changePct: b.changePct, leader: b.leaderStock, leaderChangePct: b.leaderChangePct })),
    industries: matchedIndustries.map((b) => ({ name: b.name, changePct: b.changePct, leader: b.leaderStock })),
    leaders: leaders.map((s) => ({ code: s.code || '', name: s.name, price: s.price, changePct: s.changePct })),
  };

  const detail = [];
  if (matchedConcepts.length) detail.push(matchedConcepts.map((b) => `${b.name}${b.changePct >= 0 ? '+' : ''}${b.changePct}%`).join('/'));
  if (matchedIndustries.length) detail.push(matchedIndustries.map((b) => `${b.name}${b.changePct >= 0 ? '+' : ''}${b.changePct}%`).join('/'));
  if (leaders.length) detail.push(`龙头：${leaders.map((s) => `${s.name}${s.changePct >= 0 ? '+' : ''}${s.changePct}%`).join('、')}`);

  return {
    indicators,
    updatedNote: `${localDate()} 行情更新：${change}${detail.length ? `；${detail.join('；')}` : ''}${config.note ? `。${config.note}` : ''}`,
    change,
  };
}

function run() {
  const opt = { dryRun: process.argv.includes('--dry-run') };
  const nameIdx = process.argv.indexOf('--name');
  const onlyName = nameIdx >= 0 ? process.argv[nameIdx + 1] : '';

  const dbSectors = Object.keys(SECTOR_CONFIG).filter((n) => !onlyName || n === onlyName);
  if (!dbSectors.length) {
    console.error('未找到匹配的板块配置');
    process.exit(1);
  }

  console.log('▶ 采集概念板块（新浪）…');
  const concepts = fetchConceptBoards();
  console.log(`  概念板块 ${Object.keys(concepts).length} 个`);
  console.log('▶ 采集行业板块（新浪）…');
  const industries = fetchIndustryBoards();
  console.log(`  行业板块 ${Object.keys(industries).length} 个`);

  const allLeaders = [...new Set(dbSectors.flatMap((n) => SECTOR_CONFIG[n].leaders))];
  console.log(`▶ 采集龙头个股 ${allLeaders.length} 只…`);
  const stocks = fetchStocks(allLeaders);

  const collected = dbSectors.map((name) => {
    const result = collectSector(name, SECTOR_CONFIG[name], concepts, industries, stocks);
    console.log(`  ${name}：${result.change}`);
    return { name, ...result };
  });

  if (opt.dryRun) {
    console.log('\n[DRY-RUN] 采集结果：');
    console.log(JSON.stringify(collected, null, 2));
    return;
  }

  const store = new InvestmentStore();
  try {
    const dbRecords = store.list('sectors');
    for (const item of collected) {
      const target = dbRecords.find((r) => r.name === item.name);
      if (target) {
        store.update('sectors', target.id, {
          indicators: JSON.stringify(item.indicators),
          updated_note: item.updatedNote,
        }, { source: 'collect' });
        console.log(`  ✓ ${item.name} 已更新（只改 indicators/updated_note，不动评级与逻辑）`);
      } else {
        console.log(`  ⚠ 数据库无「${item.name}」板块记录，跳过（需先在板块池新增）`);
      }
    }
    console.log('\n✓ 板块行情采集完成');
  } finally {
    store.close();
  }
}

run();
