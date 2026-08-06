#!/usr/bin/env node
/*
 * A 股市场环境 AI 分析：基于已采集的原始行情（metrics_json / current_value / observed_at），
 * 调用 .env 中配置的 LLM 生成 score / risk_level / opportunity_level / strategy / rationale。
 *
 * 边界（与 AGENTS.md 数据采集规范一致）：
 *   - 只读取原始数据字段，绝不修改 metrics_json / current_value / change_note / observed_at / status。
 *   - 判断类字段写入后记录 analysis_source / analyzed_at，看板可展示「被分析的原始数据 + 分析结果」并重新分析。
 *   - 未采集到行情数据时拒绝分析，不把缺失包装成结论。
 *   - 分析不联网采集新数据，只使用数据库内已有记录。
 *
 * 用法：
 *   node scripts/analyze-market.cjs            # 分析并写回判断字段
 *   node scripts/analyze-market.cjs --dry-run  # 只打印 LLM 输出，不写库
 *
 * 依赖：.env 中配置 LLM_API_KEY（或 GLM_API_KEY / ZHIPU_API_KEY / OPENAI_API_KEY）。
 */
require('dotenv').config();

const { InvestmentStore } = require('../investment-store.cjs');
const { installOperationLogger } = require('../operation-log.cjs');
installOperationLogger({ category: 'analysis', operationKey: 'analyze-market', title: '市场环境 AI 分析' });

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
  const prompt = `你是个人投资决策记录助手，不预测涨停，不承诺收益。请只依据下面的「原始行情数据」生成对 A 股市场环境的整体判断。

要求：
1. 只能使用输入中出现的字段；任何缺失或为空的指标必须如实说明「缺失」，不得编造或补全。
2. risk_level（风险等级）、opportunity_level（机会等级）、score（综合评分）均为 0-5 的数值（可保留一位小数）。评分是数据观察的压缩，不是买卖指令。
3. strategy 是可复核的市场应对策略（从仓位、方向、节奏层面），2-4 句，不承诺收益。
4. rationale 是分析依据，必须引用具体数字（如指数涨跌幅、两市成交额、主力净流入、涨跌家数、市场情绪），逐条说明为什么给出该等级；数据缺失时写明缺了什么。
5. 北向资金净流入自 2024 年起已停止披露：若输入中只有说明文字，不得据此得出资金流入/流出结论。
6. 只返回 JSON，不要 Markdown。结构：
{"score":3,"risk_level":3,"opportunity_level":3,"strategy":"...","rationale":"..."}

原始行情数据：
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
        max_tokens: 1200,
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
  const score = Number(result?.score);
  const risk = Number(result?.risk_level);
  const opp = Number(result?.opportunity_level);
  if (![score, risk, opp].every((value) => Number.isFinite(value) && value >= 0 && value <= 5)) {
    throw new Error('模型返回的评分不合法（score / risk_level / opportunity_level 必须是 0-5 的数值）');
  }
  if (!result.strategy || !String(result.strategy).trim()) throw new Error('模型未返回 strategy（应对策略）');
  if (!result.rationale || !String(result.rationale).trim()) throw new Error('模型未返回 rationale（分析依据）');
  return {
    score: clamp(score, 0, 5),
    risk_level: clamp(risk, 0, 5),
    opportunity_level: clamp(opp, 0, 5),
    strategy: String(result.strategy).trim(),
    rationale: String(result.rationale).trim(),
  };
}

async function analyze() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const store = new InvestmentStore();
  try {
    const records = store.list('market', { record_type: 'market' });
    const target = records.find((r) => r.name === 'A股市场环境');
    if (!target) throw new Error('未找到「A股市场环境」记录，请先采集市场行情');
    const metrics = target.metrics || {};
    const hasData = Boolean(
      target.status && target.status !== '待更新'
      && (metrics.indexTrend || metrics.turnover || (target.current_value && target.current_value !== '待录入')),
    );
    if (!hasData) {
      throw new Error('市场环境尚未采集行情数据（status=待更新）。请先在看板点击「采集市场」或运行 npm run collect:market。');
    }
    if (!target.observed_at) throw new Error('缺少数据日期 observed_at，请先采集或补录数据日期');

    // 只取原始数据字段作为分析输入，判断字段（score/risk/strategy 等）不参与输入，避免「用结论生成结论」
    const rawData = {
      observed_at: target.observed_at,
      current_value: target.current_value || '',
      change_note: target.change_note || '',
      metrics: {
        indexTrend: metrics.indexTrend || null,
        turnover: metrics.turnover || null,
        mainFunds: metrics.mainFunds || null,
        advanceDecline: metrics.advanceDecline || null,
        sentiment: metrics.sentiment || '',
        themePersistence: metrics.themePersistence || '',
        northbound: metrics.northbound || '',
      },
      data_source_note: target.rationale || '',
    };

    console.log('▶ 调用模型分析原始行情…');
    console.log(`  输入：observed_at=${target.observed_at} · 原始数据 ${JSON.stringify(rawData).length} 字符`);
    const model = process.env.LLM_MODEL || 'glm-4-flash';
    const result = await requestAnalysis(rawData);
    const normalized = validateResult(result);

    console.log(`  模型（${model}）返回：风险 ${normalized.risk_level}/5 · 机会 ${normalized.opportunity_level}/5 · 综合 ${normalized.score}/5`);

    if (dryRun) {
      console.log('\n[DRY-RUN] 将写入判断字段（原始数据字段不会改动）：');
      console.log(JSON.stringify({ ...normalized, analysis_source: `AI · ${model}`, analyzed_at: new Date().toISOString() }, null, 2));
      return;
    }

    const updated = store.update('market', target.id, {
      ...normalized,
      analysis_source: `AI · ${model}`,
      analyzed_at: new Date().toISOString(),
    }, { source: 'analyze' });
    console.log(`\n✓ 已写入市场环境分析结果（id=${updated.id}，observed_at=${updated.observed_at}）`);
    console.log(`  风险 ${updated.risk_level}/5 · 机会 ${updated.opportunity_level}/5 · 综合 ${updated.score}/5`);
    console.log(`  来源：${updated.analysis_source} · ${updated.analyzed_at}`);
    console.log('  原始行情数据未被修改；可运行 npm run serve 后到「市场环境」页查看。');
  } finally {
    store.close();
  }
}

analyze().catch((err) => {
  console.error(`\n✗ 市场环境分析失败：${err.message}`);
  process.exit(1);
});
