#!/usr/bin/env node
/*
 * 监听 videos/ 目录：有新视频写入完成时，自动触发增量分析并刷新报告。
 *
 * 用法：node watch.cjs
 * 按 Ctrl+C 退出。
 *
 * 实现说明：macOS 自带 FSEvents，Node 的 fs.watch 已足够；为避免大文件分多次
 * 写入造成的重复触发，采用「防抖」：检测到变化后等待 DEBOUNCE_MS 再执行。
 */
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const VIDEO_DIR = path.join(ROOT, 'videos');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm']);
const DEBOUNCE_MS = 4000; // 视频下载完成后等 4s 再分析，避免半成品

let timer = null;
let running = false;

function log(msg) { console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`); }

function scheduleAnalyze(reason) {
  if (timer) clearTimeout(timer);
  log(`检测到变化（${reason}），${DEBOUNCE_MS / 1000}s 后开始分析…`);
  timer = setTimeout(() => {
    timer = null;
    runAnalyze();
  }, DEBOUNCE_MS);
}

function runAnalyze() {
  if (running) { log('上一次分析还在进行，跳过本次。'); return; }
  running = true;
  log('▶ 开始增量分析…');
  const child = spawn('node', ['analyze-videos.cjs'], { cwd: ROOT, stdio: 'inherit' });
  child.on('close', (code) => {
    running = false;
    log(code === 0 ? '✅ 分析完成，看板已刷新' : `⚠ 分析退出码 ${code}`);
  });
  child.on('error', (error) => { running = false; log(`❌ ${error.message}`); });
}

try {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
} catch {}

let watcher;
try {
  watcher = fs.watch(VIDEO_DIR, { recursive: false }, (eventType, filename) => {
    if (!filename) return;
    const ext = path.extname(filename).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) return;
    scheduleAnalyze(`${eventType}: ${filename}`);
  });
} catch (error) {
  console.error(`无法监听 ${VIDEO_DIR}：${error.message}`);
  process.exit(1);
}

log(`👀 正在监听 ${path.relative(ROOT, VIDEO_DIR)}/ ，丢入新视频会自动分析。`);
log('   Ctrl+C 退出。');
// 启动时先跑一次，把之前漏掉的视频补上
runAnalyze();

process.on('SIGINT', () => { watcher.close(); console.log('\n已停止监听。'); process.exit(0); });
process.on('SIGTERM', () => { watcher.close(); process.exit(0); });
