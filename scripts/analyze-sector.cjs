#!/usr/bin/env node
/*
 * 板块池 AI 参考分析：基于已采集的板块行情（indicators / updated_note），
 * 调用 LLM 生成参考分析，写入 kai_invest_sector 的 analysis_source / analyzed_at / analysis_note。
 *
 * 边界（严格遵守 AGENTS.md）：rating/status/logic/risks 属于人工投资判断，
 * 本脚本绝不改动这些字段；AI 结果只作为「AI 参考分析」展示，是否采纳由用户自行编辑决定。
 *
 * 用法：
 *   node scripts/analyze-sector.cjs                # 分析全部板块
 *   node scripts/analyze-sector.cjs --name 黄金    # 只分析指定板块
 *   node scripts/analyze-sector.cjs --dry-run      # 只打印不写库
 *
 * 依赖：.env 中配置 LLM_API_KEY（或 GLM_API_KEY / ZHIPU_API_KEY / OPENAI_API_KEY）。
 */
require('dotenv').config();

const { InvestmentStore } = require('../investment-store.cjs');
const { installOperationLogger } = require('../operation-log.cjs');
installOperationLogger({ category: 'analysis', operationKey: 'analyze-sector', title: '板块 AI 参考分析' });

function extractJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('模型没有返回 JSON');
    return JSON.parse(match[0]);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function requestAnalysis(rawData) {
  const apiKey = process.env.LLM_API_KEY || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
  const disabled = String(process.env.LLM_DISABLED || '').toLowerCase() === '1';
  if (!apiKey || disabled) {
    throw new Error('未配置模型服务：请在 .env 中设置 LLM_API_KEY（或 GLM_API_KEY / ZHIPU_API_KEY / OPENAI_API_KEY），且 LLM_DISABLED 不为 1');
  }
  const baseUrl = (process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'glm-4-flash';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(15_000, Number(process.env.LLM_TIMEOUT_MS || 60_000)));
  const prompt = `你是个人投资研究助手，不预测涨停、不承诺收益。请只依据下面的「最新行情」对给定板块给出参考分析。

输入包含两部分：
- humanJudgment：用户自己记录的判断（周期/状态/评级/逻辑/风险），仅作背景理解，不得被行情覆盖或改写。
- latestQuote：最近一次采集的板块行情（概念/行业板块涨跌幅、龙头个股涨跌）。

要求：
1. 只能使用输入中出现的数据；缺失的指标如实说明「缺失」，不得编造。
2. summary：用一句话概括板块当前状态。
3. signals：2-4 条关键信号，必须引用具体数字（板块涨跌幅、龙头个股涨跌等）。
4. attention：需要关注的验证点或风险，可结合 humanJudgment.risks，但不夸大。
5. suggestedRating：0-5 的参考评级（仅供用户参考，绝不等于要覆盖用户自己的评级）。
6. suggestedStatus：参考状态（如「重点跟踪」「观察」「等待资金回流」），同样仅供参考。
7. 只返回 JSON，不要 Markdown：
{"summary":"","signals":[""],"attention":"","suggestedRating":3,"suggestedStatus":""}

输入：
${JSON.stringify(rawData, null, 2)}`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 900,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`模型请求失败（HTTP ${response.status}）：${errorBody.slice(0, 180)}`);
    }
    const body = await response.json();
    return extractJson(body.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timer);
  }
}

function validateResult(result) {
  const suggestedRating = Number(result?.suggestedRating);
  if (!Number.isFinite(suggestedRating) || suggestedRating < 0 || suggestedRating > 5) {
    throw new Error('模型返回的 suggestedRating 不合法（必须是 0-5 的数值）');
  }
  if (!result.summary || !String(result.summary).trim()) throw new Error('模型未返回 summary');
  if (!Array.isArray(result.signals) || !result.signals.length) throw new Error('模型未返回 signals');
  if (!result.suggestedStatus || !String(result.suggestedStatus).trim()) throw new Error('模型未返回 suggestedStatus');
  return {
    summary: String(result.summary).trim(),
    signals: result.signals.map((s) => String(s).trim()).filter(Boolean).slice(0, 4),
    attention: String(result.attention || '').trim(),
    suggestedRating: clamp(suggestedRating, 0, 5),
    suggestedStatus: String(result.suggestedStatus).trim().slice(0, 40),
  };
}

async function analyze() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const nameIdx = args.indexOf('--name');
  const onlyName = nameIdx >= 0 ? args[nameIdx + 1] : '';

  const store = new InvestmentStore();
  try {
    const records = store.list('sectors').filter((r) => !onlyName || r.name === onlyName);
    if (!records.length) throw new Error(onlyName ? `未找到板块「${onlyName}」` : '板块池为空');

    const model = process.env.LLM_MODEL || 'glm-4-flash';
    let skipped = 0;
    for (const record of records) {
      let indicators = {};
      try {
        indicators = JSON.parse(record.indicators || '{}');
      } catch {
        indicators = {};
      }
      const hasData = Object.keys(indicators).length > 0;
      if (!hasData) {
        console.warn(`  ⚠ ${record.name}：暂无行情数据（indicators 为空），跳过。请先运行 npm run collect:sector 或看板「采集板块行情」。`);
        skipped += 1;
        continue;
      }
      const rawData = {
        sector: record.name,
        humanJudgment: {
          cycle: record.cycle || '',
          status: record.status || '',
          rating: record.rating || 0,
          logic: record.logic || '',
          risks: record.risks || '',
        },
        latestQuote: {
          updatedNote: record.updated_note || '',
          indicators,
        },
      };
      console.log(`▶ 分析「${record.name}」…`);
      const result = await requestAnalysis(rawData);
      const normalized = validateResult(result);
      console.log(`  参考评级 ${normalized.suggestedRating}/5 · 状态建议「${normalized.suggestedStatus}」`);

      if (dryRun) {
        console.log(`\n[DRY-RUN] ${record.name} 将写入（评级/逻辑不会被改动）：`);
        console.log(JSON.stringify(normalized, null, 2));
        continue;
      }
      store.update('sectors', record.id, {
        analysis_source: `AI · ${model}`,
        analyzed_at: new Date().toISOString(),
        analysis_note: JSON.stringify(normalized),
      }, { source: 'analyze' });
      console.log(`  ✓ ${record.name} 已写入 AI 参考分析（rating/status/logic/risks 未改动）`);
    }
    if (dryRun) return;
    if (skipped) console.log(`\n${skipped} 个板块跳过（暂无行情数据）`);
    console.log('\n✓ 板块 AI 参考分析完成，可刷新看板到「关注板块」页查看。');
  } finally {
    store.close();
  }
}

analyze().catch((err) => {
  console.error(`\n✗ 板块分析失败：${err.message}`);
  process.exit(1);
});
