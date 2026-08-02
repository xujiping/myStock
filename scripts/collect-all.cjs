#!/usr/bin/env node
/*
 * 一键采集全部投资数据（按 AGENTS.md 规定顺序：宏观 → 市场 → 板块）。
 *
 * 前一层是后一层的判断依据，且一次性采集完再统一写库，避免半成品被看板读取。
 * 任何一层失败不阻断后续层，最终汇总各层成败。
 *
 * 用法：
 *   node scripts/collect-all.cjs                  # 全量采集
 *   node scripts/collect-all.cjs --dry-run
 *   node scripts/collect-all.cjs --no-macro       # 跳过宏观
 *   node scripts/collect-all.cjs --no-market
 *   node scripts/collect-all.cjs --no-sector
 */
require('dotenv').config();

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const NODE = process.execPath;
const ROOT = path.resolve(__dirname, '..');
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const { installOperationLogger } = require('../operation-log.cjs');
installOperationLogger({ category: 'collection', operationKey: 'collect-all', title: '全部行情采集' });

function runStep(label, script) {
  if (flags.has(`--no-${label}`)) {
    console.log(`\n〔跳过 ${label}〕`);
    return { label, skipped: true };
  }
  console.log(`\n━━━ ${label} ━━━`);
  const args = [path.join(ROOT, 'scripts', script)];
  if (dryRun) args.push('--dry-run');
  try {
    execFileSync(NODE, ['--disable-warning=ExperimentalWarning', ...args], { stdio: 'inherit' });
    return { label, ok: true };
  } catch (err) {
    console.error(`\n✗ ${label} 采集失败：${err.message}`);
    return { label, ok: false, error: err.message };
  }
}

console.log('开始一键采集投资数据（宏观 → 市场 → 板块）');
const steps = [
  runStep('macro', 'collect-macro.cjs'),
  runStep('market', 'collect-market.cjs'),
  runStep('sector', 'collect-sector.cjs'),
];

console.log('\n━━━ 采集汇总 ━━━');
for (const s of steps) {
  if (s.skipped) console.log(`  〔跳过〕${s.label}`);
  else if (s.ok) console.log(`  ✓ ${s.label}`);
  else console.log(`  ✗ ${s.label}：${s.error}`);
}
const failed = steps.filter((s) => !s.skipped && !s.ok);
if (failed.length) {
  console.error(`\n${failed.length} 个采集步骤失败，请检查上方日志。`);
  process.exit(1);
}
console.log('\n✓ 全部采集完成，刷新看板即可查看最新数据。');
