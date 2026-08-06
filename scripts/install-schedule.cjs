#!/usr/bin/env node
/*
 * 安装/卸载 macOS launchd 定时任务，自动每天下载并分析新视频。
 *
 * 用法：
 *   node scripts/install-schedule.cjs --hour 21 --minute 0   # 每天 21:00 运行
 *   node scripts/install-schedule.cjs --uninstall            # 卸载
 *
 * 安装后任务会自动加载，无需重启。日志输出到 logs/schedule.log。
 */
require('dotenv').config();

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execSync, spawn } = require('node:child_process');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const LABEL = 'com.kaige.video-update';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(ROOT, 'logs');

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

function buildPlist(hour, minute) {
  const nodeBin = process.execPath;
  const outLog = path.join(LOG_DIR, 'schedule.log');
  const errLog = path.join(LOG_DIR, 'schedule.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${path.join(ROOT, 'update.cjs')}</string>
    <string>--no-download</string>
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
  try { execSync(`launchctl bootout gui/$(id -u)/${LABEL}`, { stdio: 'ignore' }); console.log('已停止任务'); } catch {}
  try { await fsp.unlink(PLIST_PATH); console.log(`已删除 ${PLIST_PATH}`); } catch {}
  console.log('卸载完成。');
}

async function install() {
  const hour = Number(get('--hour', '21'));
  const minute = Number(get('--minute', '0'));
  if (![...Array(24).keys()].includes(hour)) { console.error('--hour 必须在 0-23 之间'); process.exit(1); }
  if (![...Array(60).keys()].includes(minute)) { console.error('--minute 必须在 0-59 之间'); process.exit(1); }

  await fsp.mkdir(LOG_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(PLIST_PATH), { recursive: true });

  // 先卸载旧的
  try { execSync(`launchctl bootout gui/$(id -u)/${LABEL}`, { stdio: 'ignore' }); } catch {}

  const plist = buildPlist(hour, minute);
  await fsp.writeFile(PLIST_PATH, plist, 'utf8');
  console.log(`已写入 ${PLIST_PATH}`);

  try {
    execSync(`launchctl bootstrap gui/$(id -u) ${PLIST_PATH}`);
    console.log('已加载定时任务');
  } catch (error) {
    // 某些 macOS 版本用 load
    try { execSync(`launchctl load ${PLIST_PATH}`); console.log('已加载定时任务（load 方式）'); }
    catch { throw error; }
  }

  console.log(`\n✅ 每天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 会自动：`);
  console.log('   - 扫描 videos/ 里的新视频');
  console.log('   - 转写 + AI 精炼');
  console.log('   - 刷新看板与报告');
  console.log(`\n   日志：${path.join(LOG_DIR, 'schedule.log')}`);
  console.log('   卸载：node scripts/install-schedule.cjs --uninstall');
  console.log('\n   提示：默认不自动下载（避免风控/cookies 失效）。');
  console.log('   如需定时也下载，编辑 plist 去掉 <string>--no-download</string> 这一行。');
}

if (args.includes('--uninstall')) {
  uninstall();
} else {
  install();
}
