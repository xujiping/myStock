#!/usr/bin/env node
/*
 * 安装/卸载投资数据库每日自动备份的 macOS launchd 定时任务。
 *
 * 用法：
 *   node scripts/install-backup-schedule.cjs --hour 3 --minute 0   # 每天 03:00 备份
 *   node scripts/install-backup-schedule.cjs --uninstall            # 卸载
 *
 * 默认每天 03:00 运行，备份保留最近 30 天。
 * 日志输出到 logs/backup.log。
 * 建议设在凌晨，避开交易时段和视频分析任务（与 install-schedule.cjs 错开）。
 */
require('dotenv').config();

// ⚠️ 已废弃：数据库备份现由 serve.cjs 内置 TaskScheduler 调度（每天 23:30 自动运行）。
//    本脚本保留仅供存量 launchd 安装卸载，不应再新装。新用户直接 npm run serve 即可。
console.warn('⚠️ 本脚本已废弃——数据库备份现由看板服务内置调度（serve.cjs TaskScheduler）。如仅需停止旧的 launchd 任务，可继续用 --uninstall。');

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execSync } = require('node:child_process');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const LABEL = 'com.kaige.investment-backup';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(ROOT, 'logs');

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

function buildPlist(hour, minute, keep) {
  const nodeBin = process.execPath;
  const outLog = path.join(LOG_DIR, 'backup.log');
  const errLog = path.join(LOG_DIR, 'backup.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${path.join(ROOT, 'scripts', 'backup-investment.cjs')}</string>
    <string>--keep</string>
    <string>${keep}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
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
  try { execSync(`launchctl bootout gui/$(id -u)/${LABEL}`, { stdio: 'ignore' }); console.log('已停止备份任务'); } catch {}
  try { await fsp.unlink(PLIST_PATH); console.log(`已删除 ${PLIST_PATH}`); } catch {}
  console.log('卸载完成。');
}

async function install() {
  const hour = Number(get('--hour', '3'));
  const minute = Number(get('--minute', '0'));
  const keep = Number(get('--keep', '30'));
  if (![...Array(24).keys()].includes(hour)) { console.error('--hour 必须在 0-23 之间'); process.exit(1); }
  if (![...Array(60).keys()].includes(minute)) { console.error('--minute 必须在 0-59 之间'); process.exit(1); }
  if (!(Number.isInteger(keep) && keep > 0)) { console.error('--keep 必须是正整数'); process.exit(1); }

  await fsp.mkdir(LOG_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(PLIST_PATH), { recursive: true });

  // 先卸载旧的
  try { execSync(`launchctl bootout gui/$(id -u)/${LABEL}`, { stdio: 'ignore' }); } catch {}

  const plist = buildPlist(hour, minute, keep);
  await fsp.writeFile(PLIST_PATH, plist, 'utf8');
  console.log(`已写入 ${PLIST_PATH}`);

  try {
    execSync(`launchctl bootstrap gui/$(id -u) ${PLIST_PATH}`);
    console.log('已加载备份任务');
  } catch (error) {
    try { execSync(`launchctl load ${PLIST_PATH}`); console.log('已加载备份任务（load 方式）'); }
    catch { throw error; }
  }

  console.log(`\n✅ 每天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 会自动：`);
  console.log('   - WAL checkpoint（合并 -wal 回主库）');
  console.log('   - 在线备份到 data/backup/（按天去重）');
  console.log(`   - 清理旧备份，仅保留最近 ${keep} 天`);
  console.log(`\n   日志：${path.join(LOG_DIR, 'backup.log')}`);
  console.log('   卸载：node scripts/install-backup-schedule.cjs --uninstall');
  console.log('   手动试跑一次：node scripts/backup-investment.cjs');
}

if (args.includes('--uninstall')) {
  uninstall();
} else {
  install();
}
