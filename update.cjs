#!/usr/bin/env node
/*
 * 一键更新：下载新视频 → 转写 → AI 精炼 → 刷新投资工作台的研究依据。
 *
 * 用法：
 *   node update.cjs              # 默认当年当月下载 + 增量分析
 *   node update.cjs --month 7    # 指定月份
 *   node update.cjs --no-download # 跳过下载，只分析 videos/ 里已有的新视频
 *   node update.cjs --open        # 完成后自动在浏览器打开看板
 *
 * 增量逻辑：analyze-videos.cjs 本身只处理未转写的视频，已转写的会跳过，
 * 所以重复运行安全且快速。
 */
require('dotenv').config();

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = __dirname;
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const { installOperationLogger } = require('./operation-log.cjs');
const operationLogger = installOperationLogger({
  category: 'video',
  operationKey: 'update-videos',
  title: '视频下载与增量分析',
});

const DASHBOARD_HTML = path.join(ROOT, 'investment-dashboard.html');

function log(icon, msg) { console.log(`${icon}  ${msg}`); }

function run(cmd, cmdArgs, label) {
  return new Promise((resolve, reject) => {
    log('▶', `${label}…`);
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stdout.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${label} 失败（退出码 ${code}）\n${stderr}`)));
  });
}

async function main() {
  const t0 = Date.now();
  log('🚀', '开始一键更新');

  // 1) 下载新视频（可跳过）
  if (!has('--no-download')) {
    const month = value('--month');
    const year = value('--year');
    const pyArgs = ['download_douyin_july.py'];
    if (month) pyArgs.push('--month', month);
    if (year) pyArgs.push('--year', year);
    try {
      await run('python3', pyArgs, '下载新视频');
    } catch (error) {
      log('⚠', `下载阶段出错（继续分析已有视频）：${error.message.split('\n')[0]}`);
    }
  } else {
    log('⏭', '已跳过下载');
  }

  // 2) 增量分析：自动只处理新增视频，已有转写会跳过
  await run('node', ['analyze-videos.cjs'], '转写 + AI 精炼 + 生成报告');

  // 3) 完成提示
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  log('✅', `完成，用时 ${seconds}s`);
  operationLogger.finishSuccess?.(`视频下载与增量分析完成，用时 ${seconds} 秒`);
  if (!fs.existsSync(DASHBOARD_HTML)) return;
  log('📊', `投资工作台：${path.relative(ROOT, DASHBOARD_HTML)}`);
  if (!has('--open')) {
    log('💡', '查看看板：npm run open（启动本地服务并打开浏览器）');
    return;
  }
  // --open：前台同步启动 serve.cjs（它会自动打开浏览器），
  // 这样 Ctrl+C 时 serve 会随当前进程一起退出，避免残留进程占用端口。
  log('🌐', '启动本地看板服务（Ctrl+C 退出）…');
  const serve = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'inherit' });
  // 把信号转交给子进程，确保一起退出
  const forward = (sig) => () => serve.kill(sig);
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  serve.on('exit', (code) => { process.exit(code ?? 0); });
}

main().catch((error) => {
  console.error(`\n❌ ${error.message || error}`);
  process.exitCode = 1;
});
