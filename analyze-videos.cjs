#!/usr/bin/env node
/*
 * 本地视频 -> 16kHz 单声道 WAV -> 阿里云 NLS 实时一句话识别 -> 日期报告。
 * 输出均可删除后重建；原视频永不修改。
 */
require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const NlsFileTransClient = require('@alicloud/nls-filetrans-2018-08-17');
const COS = require('cos-nodejs-sdk-v5');

const ROOT = __dirname;
const VIDEO_DIR = path.join(ROOT, 'videos');
const AUDIO_DIR = path.join(ROOT, 'audio');
const TRANSCRIPT_DIR = path.join(ROOT, 'transcripts');
const REPORT_DIR = path.join(ROOT, 'reports');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm']);
const SAMPLE_RATE = Number(process.env.ALIYUN_NLS_SAMPLE_RATE || 16000) === 8000 ? 8000 : 16000;
const args = new Set(process.argv.slice(2));
const { installOperationLogger } = require('./operation-log.cjs');
installOperationLogger({
  category: 'video',
  operationKey: args.has('--summarize-only') ? 'summarize-videos' : 'analyze-videos',
  title: args.has('--summarize-only') ? '重建视频研究报告' : '视频增量分析',
  summary: args.has('--summarize-only') ? '正在使用已有转写重建报告' : '正在扫描、转写并分析新视频',
  successSummary: args.has('--summarize-only') ? '视频研究报告重建完成' : '视频分析与研究报告更新完成',
});

function fail(message) {
  console.error(`错误：${message}`);
  process.exitCode = 1;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}。请复制 .env.example 为 .env 后填写。`);
  return value;
}

function extractDate(name) {
  const match = name.match(/(?:^|[^0-9])((?:20\d{2}|19\d{2})[-_.年]?(?:0[1-9]|1[0-2])[-_.月]?(?:0[1-9]|[12]\d|3[01]))(?:[^0-9]|$)/);
  if (!match) return null;
  const digits = match[1].replace(/\D/g, '');
  const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

async function listVideos() {
  const entries = await fsp.readdir(VIDEO_DIR, { withFileTypes: true });
  const videos = [];
  for (const entry of entries) {
    if (!entry.isFile() || !VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const date = extractDate(entry.name);
    if (!date) {
      console.warn(`跳过（文件名未识别到日期）：${entry.name}`);
      continue;
    }
    const fullPath = path.join(VIDEO_DIR, entry.name);
    const stat = await fsp.stat(fullPath);
    videos.push({ path: fullPath, name: entry.name, date, stat });
  }
  return videos.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'zh-CN'));
}

function stableId(video) {
  return crypto.createHash('sha1').update(`${video.name}:${video.stat.size}:${video.stat.mtimeMs}`).digest('hex').slice(0, 14);
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} 退出码 ${code}`)));
  });
}

async function ensureAudio(video, id) {
  const audioPath = path.join(AUDIO_DIR, `${id}.wav`);
  if (fs.existsSync(audioPath) && !args.has('--force')) return audioPath;
  console.log(`抽取音频：${video.name}`);
  await run('ffmpeg', ['-y', '-i', video.path, '-vn', '-acodec', 'pcm_s16le', '-ar', String(SAMPLE_RATE), '-ac', '1', audioPath]);
  return audioPath;
}

function nlsConfig() {
  return {
    accessKeyId: requiredEnv('ALIYUN_AK_ID'),
    accessKeySecret: requiredEnv('ALIYUN_AK_SECRET'),
    appkey: requiredEnv('ALIYUN_NLS_APP_KEY'),
    bucket: requiredEnv('COS_BUCKET'),
    region: requiredEnv('COS_REGION'),
    secretId: requiredEnv('COS_SECRET_ID'),
    secretKey: requiredEnv('COS_SECRET_KEY'),
    prefix: process.env.COS_PREFIX || 'kaige-video-analysis/'
  };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeNlsTranscript(result) {
  if (!result) return '';
  if (typeof result === 'string') {
    try { return normalizeNlsTranscript(JSON.parse(result)); } catch { return result.trim(); }
  }
  if (Array.isArray(result)) return result.map((item) => String(item.Text || item.text || item.Sentence || item.sentence || '')).filter(Boolean).join('\n').trim();
  return normalizeNlsTranscript(result.Sentences || result.sentences || result.Result || result.result || result.Text || result.text || '');
}

async function transcribeAudio(audioPath, id) {
  const config = nlsConfig();
  const cos = new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
  const key = `${config.prefix.replace(/\/?$/, '/')}${id}.wav`;
  console.log('上传用于转写的音频到腾讯云 COS…');
  await new Promise((resolve, reject) => cos.uploadFile({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    FilePath: audioPath,
    SliceSize: 8 * 1024 * 1024
  }, (error) => error ? reject(error) : resolve()));
  const fileLink = cos.getObjectUrl({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    Sign: true,
    Method: 'GET',
    Protocol: 'https:',
    Expires: 3600
  });
  const client = new NlsFileTransClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.accessKeySecret, endpoint: 'http://filetrans.cn-shanghai.aliyuncs.com' });
  // 阿里云 SDK 默认 readTimeout=3000ms，轮询 GetTaskResult 时极易触发 ReadTimeout(3000)，故显式放大。
  const runtime = {
    connectTimeout: Number(process.env.ALIYUN_NLS_CONNECT_TIMEOUT_MS || 10_000),
    readTimeout: Number(process.env.ALIYUN_NLS_READ_TIMEOUT_MS || 30_000)
  };
  const task = JSON.stringify({ appkey: config.appkey, file_link: fileLink, version: '4.0', enable_words: false, enable_sample_rate_adaptive: true });
  const submitted = await client.submitTask({ Task: task }, { method: 'POST', runtime });
  if (submitted.StatusText !== 'SUCCESS' || !submitted.TaskId) throw new Error(`阿里云录音文件识别提交失败：${submitted.StatusText || 'UNKNOWN'}`);
  const timeout = Math.max(60_000, Number(process.env.ALIYUN_NLS_TIMEOUT_MS || 3_600_000));
  const interval = Math.max(3_000, Number(process.env.ALIYUN_NLS_POLL_INTERVAL_MS || 10_000));
  const deadline = Date.now() + timeout;
  console.log('阿里云 NLS 正在识别…');
  const maxPollRetries = Math.max(0, Number(process.env.ALIYUN_NLS_POLL_MAX_RETRIES || 3));
  while (Date.now() < deadline) {
    await sleep(interval);
    let response;
    let pollError;
    // 单次轮询网络抖动/读超时不应让整个任务失败，按 maxPollRetries 重试。
    for (let attempt = 0; attempt <= maxPollRetries; attempt++) {
      try {
        response = await client.getTaskResult({ TaskId: submitted.TaskId }, { runtime });
        pollError = null;
        break;
      } catch (err) {
        pollError = err;
        if (attempt < maxPollRetries) {
          console.warn(`轮询 NLS 任务失败（第 ${attempt + 1} 次），${Math.min(interval, 5_000)}ms 后重试：${(err && err.message || err).toString().split('\n')[0]}`);
          await sleep(Math.min(interval, 5_000));
        }
      }
    }
    if (pollError) throw new Error(`阿里云 NLS 轮询连续失败：${(pollError && pollError.message || pollError).toString().split('\n')[0]}`);
    if (response.StatusText === 'RUNNING' || response.StatusText === 'QUEUEING') continue;
    if (response.StatusText === 'SUCCESS' || response.StatusText === 'SUCCESS_WITH_NO_VALID_FRAGMENT') return normalizeNlsTranscript(response.Result);
    throw new Error(`阿里云录音文件识别失败：${response.StatusText || 'UNKNOWN'}`);
  }
  throw new Error('阿里云录音文件识别超时，可稍后用 --force 重试。');
}

// LLM 配置：默认使用智谱 GLM（通过 GLM_API_KEY）。可改为 OpenAI 兼容的任意服务。
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'glm-4-flash';
const LLM_ENABLED = LLM_API_KEY.length > 0 && (process.env.LLM_DISABLED || '').toLowerCase() !== '1';

async function summarizeWithLLM(text) {
  if (!LLM_ENABLED) return null;
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  const prompt = `你是A股投资观点提炼助手。下面是一段口语化的视频转写文本（含口水话、错别字、同音字）。请只提炼与投资分析直接相关的观点，要求：
0. 忽略一切与投资无关的内容：寒暄、自我吹捧、粉丝互动、人身评价、情感宣泄、生活琐事、求点赞关注、广告、引流、与个股/板块/行情无关的闲聊等。即便整段都在闲聊，也不要硬凑观点。
1. 每条要点必须是简短的核心结论，不超过25字，去掉所有口语水词、铺垫和重复。
2. 突出核心重点：板块/方向/时间/风险等关键信息。
3. 修正明显的同音错别字（结合A股语境，例如"中尉"应为"中位"、"生产队"指"神秘资金"等，仅在确信时修正，不确定就保留原意）。
4. 只输出要点列表，每行一条，不要编号、不要解释、不要前后缀。
5. 最多6条，合并重复内容；若无明显的投资观点，输出"无明确投资观点"。
6. 要点本身不得出现粉丝/铁粉/主播/点赞/关注我/进群/加微信等受众或引流词；只描述投资判断本身。

转写文本：
"""${trimmed}"""`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(15_000, Number(process.env.LLM_TIMEOUT_MS || 60_000)));
  try {
    const response = await fetch(`${LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${LLM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 500 })
    });
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}：${(await response.text()).slice(0, 200)}`);
    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    const lines = content.split('\n').map((line) => line.replace(/^\s*[\d·•\-－、)\]]+\.?\s*/, '').trim()).filter(Boolean);
    // 兑除仍混入的纯闲聊 / 引流句（函数声明会被提升，可安全调用）。
    const cleaned = lines.filter((line) => !isOffTopic(line));
    if (!cleaned.length && lines.some((line) => line.includes('无明确投资观点'))) return [];
    return cleaned.length ? cleaned.slice(0, 6) : [];
  } finally {
    clearTimeout(timer);
  }
}

function sentenceSplit(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[。！？!?；;])/).map((item) => item.trim()).filter(Boolean);
}

const SECTOR_WORDS = ['人工智能', '算力', '半导体', '芯片', '存储', '特气', '氦气', '燃气轮机', '中小盘', '科创', '机器人', '军工', '新能源', '光伏', '储能', '锂电', '汽车', '消费电子', '医药', '创新药', '证券', '银行', '保险', '地产', '有色', '黄金', '煤炭', '电力', '通信', '传媒', '游戏', '农业', '白酒', '稀土'];
const ADVICE_WORDS = ['看好', '关注', '买入', '加仓', '持有', '低吸', '减仓', '卖出', '回避', '止损', '风险', '机会', '主线', '布局', '反弹', '突破'];
const BULLISH_WORDS = ['看好', '关注', '买入', '加仓', '持有', '低吸', '机会', '主线', '布局', '反弹', '突破', '重估', '底部', '抄底', '止跌', '上涨', '行情', '主升浪', '爆发', '硬逻辑', '业绩'];
const BEARISH_WORDS = ['风险', '回避', '减仓', '卖出', '止损', '下跌', '套牢'];
// 与投资分析无关的话题关键词：命中且不含任何投资信号时，视为闲聊句子，从摘要与原文摘录中剔除。
const OFF_TOPIC_WORDS = ['点赞', '关注我', '铁粉', '粉丝', '加微信', '进群', '私我', '评论区', '点个', '转发', '收藏', '三连', '主播', '礼物', '谢谢大家', '拜拜', '下播', '直播间', '性格', '人品', '人格', '做人', '交往', '嫁祸', '听不懂人话', '猫', '狗', '家人', '老婆', '孩子', '吃饭', '睡觉', '旅游', '放假'];
// 强引流 / 纯互动词：只要命中即剔除，即使同句出现“涨/板块”等通用词也不保留（这类词几乎不会出现在真正的投资分析句中）。
const SPAM_WORDS = ['点赞', '关注我', '点个关注', '铁粉', '加微信', '进群', '私我', '三连', '主播', '礼物', '下播', '直播间', '收藏', '转发', '粉丝'];
// 命中强受众词时，只有同时出现以下“硬”投资信号才视为有效分析句（通用词如“涨/关注”不足以括救）。
const STRONG_INVESTMENT_WORDS = SECTOR_WORDS.concat(['加仓', '减仓', '买入', '卖出', '止损', '低吸', '持仓', '仓位', '补仓', '建仓']);
const TIME_HINTS = [
  ['长期', '长期'], ['中长期', '中长期'], ['短期', '短期'], ['近期', '近期'], ['这几天', '近期'],
  ['后面', '后续'], ['夏天', '夏季'], ['三伏天', '夏季'], ['一到两个月', '约 1-2 个月'], ['一个月', '约 1 个月'], ['两个月', '约 2 个月'], ['八月份', '八月'],
];

function unique(items) { return [...new Set(items)]; }

// 判断一个句子是否属于纯闲聊（命中无关话题且不含任何投资信号），用于在原文摘录中剔除噪声。
function isOffTopic(sentence) {
  if (SPAM_WORDS.some((word) => sentence.includes(word))) {
    // 命中强受众 / 引流词时，只有同时出现具体板块、个股代码或明确仓位动作才保留。
    const hasStrongSignal = STRONG_INVESTMENT_WORDS.some((word) => sentence.includes(word)) || /\d{6}/.test(sentence);
    return !hasStrongSignal;
  }
  if (!OFF_TOPIC_WORDS.some((word) => sentence.includes(word))) return false;
  const hasInvestmentSignal = ADVICE_WORDS.some((word) => sentence.includes(word))
    || SECTOR_WORDS.some((word) => sentence.includes(word))
    || /\d{6}/.test(sentence)
    || /涨|跌|仓位|大盘|个股|板块|市场|A股|牛市|熊市/.test(sentence);
  return !hasInvestmentSignal;
}

function extractInvestmentView(text) {
  const sentences = sentenceSplit(text);
  const sectors = unique(SECTOR_WORDS.filter((word) => text.includes(word)));
  // 股票简称没有可靠的通用正则：例如“这种科技”“这个电力”会被误识别为公司名。
  // 因此自动报告只列出可验证的 6 位股票代码；公司简称仍保留在原始转写中供人工核验。
  const stocks = unique([...text.matchAll(/(?<!\d)\d{6}(?!\d)/g)].map((match) => match[0]));
  const views = sentences.filter((sentence) => !isOffTopic(sentence) && ADVICE_WORDS.some((word) => sentence.includes(word))).slice(0, 30);
  const relevant = sentences.filter((sentence) => !isOffTopic(sentence) && (ADVICE_WORDS.some((word) => sentence.includes(word)) || SECTOR_WORDS.some((word) => sentence.includes(word)) || /\d{6}/.test(sentence))).slice(0, 40);
  const sectorViews = sectors.map((sector) => {
    const related = sentences.filter((sentence) => sentence.includes(sector) && !isOffTopic(sentence));
    const quotes = related.slice(0, 4);
    const joined = related.join(' ');
    const score = BULLISH_WORDS.reduce((total, word) => total + (joined.includes(word) ? 1 : 0), 0)
      - BEARISH_WORDS.reduce((total, word) => total + (joined.includes(word) ? 1 : 0), 0);
    const direction = score > 0 ? '看涨' : score < 0 ? '偏谨慎' : '观察';
    const time = unique(TIME_HINTS.filter(([needle]) => joined.includes(needle)).map(([, label]) => label));
    return { sector, direction, score, time, quotes };
  });
  return { sectors, stocks, views, relevant, sectorViews };
}

function markdownEscape(value) { return value.replace(/\|/g, '\\|').replace(/\n/g, ' '); }

// 展示前统一清洗精炼要点：剔除仍混入的纯闲聊 / 引流句，保证新旧缓存输出一致。
function sanitizeSummary(summary) {
  const points = Array.isArray(summary) ? summary : [];
  const cleaned = points.map((point) => String(point).trim()).filter((point) => point && !isOffTopic(point));
  return cleaned;
}

async function writeReports(records) {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'zh-CN'));
  // 为缺少 summary 的存量转写现场补充 LLM 精炼，并回写缓存。
  for (const record of sorted) {
    if (record.summary !== undefined) continue;
    try {
      const points = await summarizeWithLLM(record.transcript);
      record.summary = Array.isArray(points) ? points : [];
      console.log(`精炼：${record.name} → ${record.summary.length} 条`);
    } catch (error) {
      console.warn(`精炼失败（${record.name}）：${error.message}`);
      record.summary = [];
    }
    if (record.transcriptPath) await fsp.writeFile(record.transcriptPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8').catch(() => {});
  }
  const dayGroups = new Map();
  for (const record of sorted) dayGroups.set(record.date, [...(dayGroups.get(record.date) || []), record]);
  const lines = ['# A 股视频观点汇总', '', `生成时间：${new Date().toLocaleString('zh-CN')}`, '', '> 本报告自动提取转写文本中的投资表述，仅用于信息整理，不构成投资建议。请回听原视频核验语境。', ''];
  for (const [date, items] of dayGroups) {
    lines.push(`## ${date}`, '');
    for (const item of items) {
      const analysis = extractInvestmentView(item.transcript);
      const summary = sanitizeSummary(item.summary);
      lines.push(`### ${item.name}`, '');
      lines.push(`- 转写文件：[${path.basename(item.transcriptPath)}](../transcripts/${encodeURIComponent(path.basename(item.transcriptPath))})`);
      lines.push(`- 提及板块：${analysis.sectors.length ? analysis.sectors.join('、') : '未自动识别'}`);
      lines.push(`- 提及个股/代码：${analysis.stocks.length ? analysis.stocks.join('、') : '未自动识别'}`);
      lines.push('- 核心要点（AI 精炼）：');
      if (summary.length) summary.forEach((point) => lines.push(`  - ${point}`));
      else lines.push('  - 未生成精炼要点；请查看原文摘录或完整转写。');
      if (analysis.relevant.length) {
        lines.push('<details><summary>原文观点摘录（展开）</summary>', '');
        analysis.relevant.forEach((view) => lines.push(`  - ${view}`));
        lines.push('</details>', '');
      }
      lines.push('');
    }
  }
  await fsp.writeFile(path.join(REPORT_DIR, 'A股视频观点汇总.md'), `${lines.join('\n')}\n`, 'utf8');
  const index = ['# 视频转写索引', '', '| 日期 | 视频 | 转写状态 |', '| --- | --- | --- |', ...sorted.map((item) => `| ${item.date} | ${markdownEscape(item.name)} | 已转写 |`)];
  await fsp.writeFile(path.join(REPORT_DIR, '视频转写索引.md'), `${index.join('\n')}\n`, 'utf8');
  const dashboardTemplate = await fsp.readFile(path.join(ROOT, 'dashboard-template.html'), 'utf8');
  const dashboardRecords = [...records].sort((a, b) => b.date.localeCompare(a.date) || b.name.localeCompare(a.name, 'zh-CN')).map((item) => ({
    id: item.id,
    name: item.name,
    date: item.date,
    createdAt: item.createdAt,
    transcript: item.transcript,
    summary: sanitizeSummary(item.summary),
    analysis: extractInvestmentView(item.transcript),
  }));
  const dashboardData = { generatedAt: new Date().toISOString(), videos: dashboardRecords };
  // 数据外置：data.json 供看板运行时 fetch；HTML 保持静态模板，不再内联数据。
  await fsp.writeFile(path.join(REPORT_DIR, 'data.json'), `${JSON.stringify(dashboardData)}\n`, 'utf8');
  await fsp.writeFile(path.join(REPORT_DIR, 'A股视频看板.html'), dashboardTemplate, 'utf8');
}

async function loadExistingRecords() {
  const entries = await fsp.readdir(TRANSCRIPT_DIR, { withFileTypes: true }).catch(() => []);
  const result = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try { result.push(JSON.parse(await fsp.readFile(path.join(TRANSCRIPT_DIR, entry.name), 'utf8'))); } catch { console.warn(`忽略损坏的转写记录：${entry.name}`); }
  }
  return result;
}

async function main() {
  await Promise.all([fsp.mkdir(VIDEO_DIR, { recursive: true }), fsp.mkdir(AUDIO_DIR, { recursive: true }), fsp.mkdir(TRANSCRIPT_DIR, { recursive: true }), fsp.mkdir(REPORT_DIR, { recursive: true })]);
  let records = await loadExistingRecords();
  if (!args.has('--summarize-only')) {
    const videos = await listVideos();
    if (!videos.length) console.log('未发现带日期的视频。请将视频放入 videos/，文件名需包含 YYYY-MM-DD、YYYYMMDD 或 YYYY年MM月DD日。');
    for (const video of videos) {
      const id = stableId(video);
      const transcriptPath = path.join(TRANSCRIPT_DIR, `${video.date}_${id}.json`);
      if (fs.existsSync(transcriptPath) && !args.has('--force')) { console.log(`已转写，跳过：${video.name}`); continue; }
      const audioPath = await ensureAudio(video, id);
      console.log(`转写：${video.name}`);
      const transcript = await transcribeAudio(audioPath, id);
      if (!transcript) throw new Error(`${video.name} 未得到可用转写文本。`);
      let summary = [];
      try { summary = await summarizeWithLLM(transcript) || []; if (summary.length) console.log(`  精炼要点：${summary.length} 条`); }
      catch (error) { console.warn(`  LLM 精炼失败，将回退到关键词提炼：${error.message}`); }
      const record = { id, name: video.name, sourcePath: video.path, date: video.date, sampleRate: SAMPLE_RATE, createdAt: new Date().toISOString(), transcriptPath, transcript, summary };
      await fsp.writeFile(transcriptPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      records = records.filter((item) => item.id !== id);
      records.push(record);
    }
    records = await loadExistingRecords();
  }
  await writeReports(records);
  console.log(`完成：已生成 ${path.relative(ROOT, REPORT_DIR)}/A股视频观点汇总.md`);
}

main().catch((error) => fail(error.message || String(error)));
