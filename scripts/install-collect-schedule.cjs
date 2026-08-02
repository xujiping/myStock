#!/usr/bin/env node
/*
 * 安装/卸载「每日投资数据采集」的 macOS launchd 定时任务。
 *
 * 任务每天（默认周一至周五，A 股交易日）收盘后运行 npm run collect，
 * 自动采集宏观变量、A 股市场环境、板块行情。
 *
 * 用法：
 *   node scripts/install-collect-schedule.cjs                      # 默认 工作日 16:00
 *   node scripts/install-collect-schedule.cjs --hour 16 --minute 30
 *   node scripts/install-collect-schedule.cjs --daily              # 每天（含周末）
 *   node scripts/install-collect-schedule.cjs --uninstall
 *
 * 默认 16:00 是为了避开 15:00 收盘后的数据结算延迟；A 股资金/涨跌家数
 * 在收盘后才有最终值。周末不采集（无新数据）。
 *
 * 日志输出到 logs/collect.log 与 logs/collect.err.log。
 *
 * ⚠️ 前置依赖：
 *   - CDP Proxy 必须在运行（主力资金/美元指数/美债需要浏览器渲染）。
 *     launchd 任务不会自动启动 Chrome，建议让 Chrome 开机自启并保持
 *     「Allow remote debugging」开启，或改为只跑不需要 CDP 的部分。
 *   - 黄金/财务接口的 AppCode 需在 .env 配置。
 */
require('dotenv').config();

// ⚠️ 已废弃：每日数据采集现由 serve.cjs 内置 TaskScheduler 调度（交易日 16:10 自动运行）。
//    本脚本保留仅供存量 launchd 安装卸载，不应再新装。新用户直接 npm run serve 即可。
console.warn('⚠️ 本脚本已废弃——数据采集现由看板服务内置调度（serve.cjs TaskScheduler）。如仅需停止旧的 launchd 任务，可继续用 --uninstall。');

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execSync } = require('node:child_process');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const LABEL = 'com.kaige.investment-collect';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(ROOT, 'logs');

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

// launchd Weekday：1=周一 … 7=周日（与 cron 的 0/7=周日 不同）
const WEEKDAY_NAMES = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

function buildPlist(hour, minute, daily) {
  const nodeBin = process.execPath;
  const outLog = path.join(LOG_DIR, 'collect.log');
  const errLog = path.join(LOG_DIR, 'collect.err.log');
  const calendar = daily
    ? `  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>`
    : `  <key>StartCalendarInterval</key>
  <array>
${[1, 2, 3, 4, 5].map((w) => `    <dict>
      <key>Weekday</key>
      <integer>${w}</integer>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>${minute}</integer>
    </dict>`).join('\n')}
  </array>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>${path.join(ROOT, 'scripts', 'collect-all.cjs')}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
${calendar}
  <key>StandardOutPath</key>
  <string>${outLog}</string>
  <key>StandardErrorPath</key>
  <string>${errLog}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

async function uninstall() {
  try { execSync(`launchctl bootout gui/$(id -u)/${LABEL}`, { stdio: 'ignore' }); console.log('已停止采集任务'); } catch {}
  try { await fsp.unlink(PLIST_PATH); console.log(`已删除 ${PLIST_PATH}`); } catch {}
  console.log('卸载完成。');
}

async function install() {
  const hour = Number(get('--hour', '16'));
  const minute = Number(get('--minute', '0'));
  const daily = args.includes('--daily');
  if (![...Array(24).keys()].includes(hour)) { console.error('--hour 必须在 0-23 之间'); process.exit(1); }
  if (![...Array(60).keys()].includes(minute)) { console.error('--minute 必须在 0-59 之间'); process.exit(1); }

  await fsp.mkdir(LOG_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(PLIST_PATH), { recursive: true });

  // 先卸载旧的
  try { execSync(`launchctl bootout gui/$(id -u)/${LABEL}`, { stdio: 'ignore' }); } catch {}

  const plist = buildPlist(hour, minute, daily);
  await fsp.writeFile(PLIST_PATH, plist, 'utf8');
  console.log(`已写入 ${PLIST_PATH}`);

  try {
    execSync(`launchctl bootstrap gui/$(id -u) ${PLIST_PATH}`);
    console.log('已加载采集任务');
  } catch (error) {
    try { execSync(`launchctl load ${PLIST_PATH}`); console.log('已加载采集任务（load 方式）'); }
    catch { throw error; }
  }

  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const days = daily ? '每天' : '工作日（周一至周五）';
  console.log(`\n✅ ${days} ${time} 会自动运行 npm run collect：`);
  console.log('   - 宏观变量（美联储/金价/美元/美债/A股资金）');
  console.log('   - A 股市场环境（指数/成交额/主力资金/涨跌家数）');
  console.log('   - 板块行情（概念/行业板块 + 龙头股）');
  console.log(`\n   日志：${path.join(LOG_DIR, 'collect.log')}`);
  console.log('   卸载：node scripts/install-collect-schedule.cjs --uninstall');
  console.log('   手动试跑：npm run collect');
  console.log('\n⚠️  CDP Proxy 需保持运行（主力资金/美元/美债依赖浏览器渲染）。');
  console.log('   launchd 不会自动启动 Chrome，请确保 Chrome 已开启 remote debugging。');
}

if (args.includes('--uninstall')) {
  uninstall();
} else {
  install();
}
