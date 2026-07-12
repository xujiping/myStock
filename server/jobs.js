import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { all, get, run as queryRun, touchEntry } from "./db.js";

const videoQueue = [];
const queuedVideoIds = new Set();
const activeVideoIds = new Set();
const videoProcessConcurrency = Math.max(1, Number(process.env.VIDEO_PROCESS_CONCURRENCY || 1) || 1);

function userError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

async function commandExists(command) {
  try {
    await run("which", [command]);
    return true;
  } catch {
    return false;
  }
}

function drainVideoQueue() {
  while (activeVideoIds.size < videoProcessConcurrency && videoQueue.length) {
    const videoId = videoQueue.shift();
    queuedVideoIds.delete(videoId);
    activeVideoIds.add(videoId);

    processVideo(videoId)
      .catch((error) => console.error(`processVideo failed for ${videoId}:`, error))
      .finally(() => {
        activeVideoIds.delete(videoId);
        drainVideoQueue();
      });
  }
}

export function enqueueVideoProcessing(videoId) {
  if (!videoId || queuedVideoIds.has(videoId) || activeVideoIds.has(videoId)) return;
  queuedVideoIds.add(videoId);
  videoQueue.push(videoId);
  drainVideoQueue();
}

export async function enqueuePendingVideoProcessing() {
  const videos = await all(`
    SELECT id
    FROM ms_videos
    WHERE status IN ('uploaded', 'extracting_audio', 'audio_ready', 'transcribing')
      AND (transcript IS NULL OR transcript = '')
    ORDER BY created_at
  `);
  videos.forEach((video) => enqueueVideoProcessing(video.id));
  return videos.length;
}

export async function processVideo(videoId) {
  const video = await get("SELECT * FROM ms_videos WHERE id = ?", [videoId]);
  if (!video) return;

  try {
    await queryRun("UPDATE ms_videos SET status = 'extracting_audio', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [videoId]);

    const audioDir = path.resolve("uploads/audio");
    fs.mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, `${video.id}.wav`);

    await run("ffmpeg", [
      "-y",
      "-i",
      video.video_path,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      audioPath,
    ]);

    await queryRun("UPDATE ms_videos SET audio_path = ?, status = 'audio_ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [audioPath, videoId]);

    const whisperCmd = process.env.WHISPER_CMD || "";
    if (!whisperCmd && !(await commandExists("whisper"))) {
      await queryRun("UPDATE ms_videos SET status = 'needs_transcription', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [videoId]);
      await touchEntry(video.entry_id);
      return;
    }

    await queryRun("UPDATE ms_videos SET status = 'transcribing', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [videoId]);
    const cmd = whisperCmd || "whisper";
    const outputDir = path.resolve("uploads/audio");
    await run(cmd, [audioPath, "--language", "Chinese", "--model", process.env.WHISPER_MODEL || "small", "--output_format", "txt", "--output_dir", outputDir]);

    const transcriptPath = path.join(outputDir, `${path.basename(audioPath, ".wav")}.txt`);
    const transcript = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8").trim() : "";

    await queryRun("UPDATE ms_videos SET transcript = ?, status = 'transcribed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [transcript, videoId]);
    await queryRun("UPDATE ms_entries SET ai_summary = NULL, key_points = NULL, status = 'collecting', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [video.entry_id]);
  } catch (error) {
    await queryRun("UPDATE ms_videos SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [String(error.message || error), videoId]);
    await touchEntry(video.entry_id);
  }
}

export async function summarizeEntry(entryId) {
  const videos = await all("SELECT transcript FROM ms_videos WHERE entry_id = ? AND transcript IS NOT NULL AND transcript != '' ORDER BY created_at", [entryId]);
  const notes = await all("SELECT title, content FROM ms_text_notes WHERE entry_id = ? AND content != '' ORDER BY created_at", [entryId]);
  const materials = [
    ...videos.map((video, index) => `视频转写 ${index + 1}：\n${video.transcript}`),
    ...notes.map((note, index) => `手动文本 ${index + 1}${note.title ? `（${note.title}）` : ""}：\n${note.content}`),
  ];
  if (!materials.length) {
    return { summary: "", points: [] };
  }
  const digest = await llmDigest(materials);

  await queryRun(`
    UPDATE ms_entries
    SET ai_summary = ?, key_points = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [digest.summary, JSON.stringify(digest.points), materials.length ? "summarized" : "collecting", entryId]);

  return digest;
}

function buildSummaryPrompt(materials) {
  return [
    "你是一个帮助用户复盘博主观点的中文助理。",
    "请基于下面同一位博主同一天的视频转写和手动文本资料，输出 JSON。",
    "JSON 格式：{\"summary\":\"不超过180字的每日总述\",\"points\":[\"观点1\",\"观点2\",\"观点3\"]}。",
    "要求：提炼观点，不要编造；合并零散和重复观点；保留可复盘的判断、理由和行动启发。",
    "",
    materials.join("\n\n---\n\n"),
  ].join("\n");
}

function parseJsonText(text) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : cleaned);
  return {
    summary: String(parsed.summary || "").trim(),
    points: Array.isArray(parsed.points) ? parsed.points.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : [],
  };
}

async function llmDigest(materials) {
  if (!materials.length) return null;
  const prompt = buildSummaryPrompt(materials);

  if (process.env.OLLAMA_MODEL) {
    const response = await fetch(`${process.env.OLLAMA_URL || "http://localhost:11434"}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL,
        prompt,
        stream: false,
        format: "json",
      }),
    });
    if (!response.ok) throw new Error(`Ollama 总结失败：HTTP ${response.status} ${await response.text()}`);
    const data = await response.json();
    return parseJsonText(data.response || "");
  }

  if (process.env.OPENAI_COMPATIBLE_BASE_URL && process.env.OPENAI_COMPATIBLE_API_KEY && process.env.OPENAI_COMPATIBLE_MODEL) {
    const response = await fetch(`${process.env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_COMPATIBLE_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你只输出合法 JSON。" },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) throw new Error(`大模型总结失败：HTTP ${response.status} ${await response.text()}`);
    const data = await response.json();
    return parseJsonText(data.choices?.[0]?.message?.content || "");
  }

  throw userError("未配置 AI 总结模型。请在 .env 中配置 OLLAMA_MODEL，或配置 OPENAI_COMPATIBLE_BASE_URL、OPENAI_COMPATIBLE_API_KEY、OPENAI_COMPATIBLE_MODEL。");
}

function parseDashboardHorizon(text, expectedKey) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : cleaned);
  if (String(parsed.key || "").trim() !== expectedKey) {
    throw new Error(`首页投资分析返回了错误周期：期望 ${expectedKey}`);
  }
  return {
    key: expectedKey,
    focus: String(parsed.focus || "").trim(),
    suggestion: String(parsed.suggestion || "").trim(),
    cautions: Array.isArray(parsed.cautions)
      ? parsed.cautions.map((caution) => String(caution).trim()).filter(Boolean).slice(0, 3)
      : [],
    creator_views: Array.isArray(parsed.creator_views)
      ? parsed.creator_views.map((view) => ({
        creator_name: String(view?.creator_name || "").trim(),
        views: Array.isArray(view?.views)
          ? view.views.map((point) => String(point).trim()).filter(Boolean).slice(0, 3)
          : [],
      })).filter((view) => view.creator_name && view.views.length)
      : [],
    disagreements: Array.isArray(parsed.disagreements)
      ? parsed.disagreements.map((item) => ({
        topic: String(item?.topic || "").trim(),
        viewpoints: Array.isArray(item?.viewpoints)
          ? item.viewpoints.map((viewpoint) => String(viewpoint).trim()).filter(Boolean).slice(0, 3)
          : [],
      })).filter((item) => item.topic && item.viewpoints.length >= 2).slice(0, 2)
      : [],
    strategy_status: ["new", "maintain", "adjust", "reverse"].includes(parsed.strategy_status)
      ? parsed.strategy_status
      : "new",
    adjustment_note: String(parsed.adjustment_note || "").trim(),
  };
}

function parseDirection(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatDirection(direction) {
  if (!direction) return "尚无上一版策略，首次建立方向。";
  return [
    `关注方向：${direction.focus || "未记录"}`,
    `执行建议：${direction.suggestion || "未记录"}`,
    `注意事项：${Array.isArray(direction.cautions) ? direction.cautions.join("；") : "未记录"}`,
  ].join("\n");
}

function formatStrategyHistory(revisions) {
  if (!revisions?.length) return "暂无更早修订记录。";
  return revisions.map((revision) => [
    `[${revision.created_at}] ${revision.strategy_status || "历史版本"}`,
    `关注方向：${revision.direction?.focus || "未记录"}`,
    `调整说明：${revision.adjustment_note || revision.direction?.adjustment_note || "未记录"}`,
  ].join("\n")).join("\n\n");
}

function buildDashboardPrompt({ horizon, previousDirection, strategyHistory }) {
  const latestDate = horizon.items[0]?.entry_date || "暂无";
  const cards = horizon.items.map((item) => [
    `[${item.entry_date}] ${item.creator_name}`,
    `总述：${String(item.ai_summary || "").slice(0, 420)}`,
    `要点：${item.key_points.slice(0, 4).join("；")}`,
  ].join("\n")).join("\n\n");

  const commonRules = [
    "你是审慎的中国市场投资研究助理。只能基于提供的每日观点卡分析，不得补充事实、预测具体价格、承诺收益或给出个股买卖指令。",
    `本次判断截至 ${latestDate}。每日观点卡按日期、同日更新时间从新到旧排列，第一张卡是当前最新信息。`,
    "时间顺序是裁决规则，不是一般权重：先根据最新卡片形成当前判断，再用较早卡片验证、解释或识别已被推翻的旧判断；不得把新旧相反观点简单平均、投票或拼接成折中结论。",
    "同一博主对同一主题前后观点相反时，最新日期的明确观点代表该博主当前立场，旧观点只可作为变化背景。不同博主对同一主题相反时，保留真实分歧；当前策略应优先采纳日期更新且证据更直接的一方，同时在注意事项中说明仍待验证的分歧，不得伪造共识。",
    "creator_views 是策略卡内按博主聚合的序号列表：同一博主多日观点必须合并，不得按日期拆分；只能使用资料中出现的博主名。短期可列出相关博主。中长期仅列具备明确持续性证据的博主，没有则输出空数组，不能为了完整性凑齐每位博主。",
    "disagreements 只记录对同一主题存在实质相反判断的真实分歧，并且必须写清各博主的不同立场；只是关注点不同不算分歧。没有真实分歧就输出空数组，禁止编造。",
    "每项都应保留核心观点；注意事项应优先覆盖样本不足、验证条件、流动性、波动与风险控制。",
  ];
  const outputShape = JSON.stringify({
    key: horizon.key,
    focus: "不超过55字的关注方向",
    suggestion: "不超过90字的执行建议",
    cautions: ["注意事项1", "注意事项2"],
    creator_views: [{ creator_name: "博主名", views: ["合并后的观点1", "观点2"] }],
    disagreements: [{ topic: "分歧主题", viewpoints: ["博主甲：观点", "博主乙：相反观点"] }],
    strategy_status: "new|maintain|adjust|reverse",
    adjustment_note: "不超过60字，说明本次依据或调整原因",
  });

  const horizonRules = horizon.key === "short"
    ? [
      "本次只分析短期，目标持有周期为未来 10-15 天。只根据近 7 天观点给出交易环境、触发条件和仓位纪律。",
      "最新观点若明确改变了市场环境、主线或风险判断，应直接覆盖较早的短期判断；较早信号不能因为数量更多而抵消最新变化。",
      "不要引用或推断中长期策略，也不要把短期信号包装成中长期结论。strategy_status 固定输出 new。",
    ]
    : [
      `本次只分析${horizon.title}，目标周期为${horizon.period}。这不是近 7 天观点的直接总结，而是持续积累的全局策略：以上一版策略和该周期自身的历史修订过程为基础，用近 7 天信息校准。`,
      "每日观点卡只是博主的短期信号，不代表每位博主、每张卡都具备中长期判断。只有最新卡片揭示政策落地、产业趋势、宏观变量或重大风险等具有持续性的明确证据，才允许 adjust 或 reverse；一旦满足，应以最新证据优先修正甚至推翻旧策略，并在 adjustment_note 写明触发变化的最新日期和原因。",
      "若最新观点只是情绪、估值、资金或技术面波动，不能推翻中长期策略，应 maintain 并明确其只影响短期执行。证据不足时不得因为观点更新而机械调整。",
      `\n上一版${horizon.title}策略：\n${formatDirection(parseDirection(previousDirection))}`,
      `\n${horizon.title}历史修订过程（新到旧）：\n${formatStrategyHistory(strategyHistory)}`,
    ];

  return [
    ...commonRules,
    ...horizonRules,
    "输出简洁、专业、可执行的 JSON，不要 Markdown。只能返回一个当前周期的对象，不能返回 horizons 数组：",
    outputShape,
    "\n以下是本次用于更新的近 7 天每日观点卡：\n",
    cards || "暂无可用观点卡",
  ].join("\n");
}

export async function analyzeDashboard({ horizons, previousDirections, strategyHistory }) {
  if (!process.env.OPENAI_COMPATIBLE_BASE_URL || !process.env.OPENAI_COMPATIBLE_API_KEY) {
    throw userError("未配置首页投资分析模型。请在 .env 中配置 OPENAI_COMPATIBLE_BASE_URL 与 OPENAI_COMPATIBLE_API_KEY。", 503);
  }

  const model = process.env.DASHBOARD_MODEL || "deepseek-v4-pro";
  const analyzeHorizon = async (horizon) => {
    const response = await fetch(`${process.env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你只输出合法 JSON。" },
          {
            role: "user",
            content: buildDashboardPrompt({
              horizon,
              previousDirection: previousDirections[horizon.key],
              strategyHistory: strategyHistory[horizon.key],
            }),
          },
        ],
      }),
    });
    if (!response.ok) throw userError(`${horizon.title}投资分析失败：HTTP ${response.status} ${await response.text()}`, 502);
    const content = (await response.json()).choices?.[0]?.message?.content || "";
    return parseDashboardHorizon(content, horizon.key);
  };

  const analyzedHorizons = await Promise.all(horizons.map((horizon) => analyzeHorizon(horizon)));
  return { model, analysis: { horizons: analyzedHorizons } };
}

// ===== 航天图谱：视频转写 + AI 抽取 + 累加合并 =====

const aerospaceVideoQueue = [];
const queuedAerospaceIds = new Set();
const activeAerospaceIds = new Set();

function drainAerospaceQueue() {
  while (activeAerospaceIds.size < videoProcessConcurrency && aerospaceVideoQueue.length) {
    const sourceId = aerospaceVideoQueue.shift();
    queuedAerospaceIds.delete(sourceId);
    activeAerospaceIds.add(sourceId);

    processAerospaceVideo(sourceId)
      .catch((error) => console.error(`processAerospaceVideo failed for ${sourceId}:`, error))
      .finally(() => {
        activeAerospaceIds.delete(sourceId);
        drainAerospaceQueue();
      });
  }
}

export function enqueueAerospaceVideoProcessing(sourceId) {
  if (!sourceId || queuedAerospaceIds.has(sourceId) || activeAerospaceIds.has(sourceId)) return;
  queuedAerospaceIds.add(sourceId);
  aerospaceVideoQueue.push(sourceId);
  drainAerospaceQueue();
}

export async function enqueuePendingAerospaceProcessing() {
  const sources = await all(`
    SELECT id
    FROM ms_aerospace_sources
    WHERE source_type = 'video'
      AND status IN ('uploaded', 'extracting_audio', 'audio_ready', 'transcribing')
      AND (transcript IS NULL OR transcript = '')
    ORDER BY created_at
  `);
  sources.forEach((source) => enqueueAerospaceVideoProcessing(source.id));
  return sources.length;
}

export async function processAerospaceVideo(sourceId) {
  const source = await get("SELECT * FROM ms_aerospace_sources WHERE id = ?", [sourceId]);
  if (!source) return;

  try {
    await queryRun("UPDATE ms_aerospace_sources SET status = 'extracting_audio', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sourceId]);

    const audioDir = path.resolve("uploads/audio");
    fs.mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, `${source.id}.wav`);

    await run("ffmpeg", ["-y", "-i", source.video_path, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audioPath]);
    await queryRun("UPDATE ms_aerospace_sources SET audio_path = ?, status = 'audio_ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [audioPath, sourceId]);

    const whisperCmd = process.env.WHISPER_CMD || "";
    if (!whisperCmd && !(await commandExists("whisper"))) {
      await queryRun("UPDATE ms_aerospace_sources SET status = 'needs_transcription', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sourceId]);
      return;
    }

    await queryRun("UPDATE ms_aerospace_sources SET status = 'transcribing', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sourceId]);
    const cmd = whisperCmd || "whisper";
    const outputDir = path.resolve("uploads/audio");
    await run(cmd, [audioPath, "--language", "Chinese", "--model", process.env.WHISPER_MODEL || "small", "--output_format", "txt", "--output_dir", outputDir]);

    const transcriptPath = path.join(outputDir, `${path.basename(audioPath, ".wav")}.txt`);
    const transcript = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8").trim() : "";

    await queryRun("UPDATE ms_aerospace_sources SET transcript = ?, status = 'transcribed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [transcript, sourceId]);

    if (transcript) {
      await extractAerospace(sourceId);
    }
  } catch (error) {
    await queryRun("UPDATE ms_aerospace_sources SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [String(error.message || error), sourceId]);
  }
}

function buildAerospacePrompt(material) {
  return [
    "你是一个航天产业链研究助理。基于下面这份资料（视频转写或文本），抽取结构化的产业链信息，输出 JSON。",
    "抽取原则：资料里提到的才抽取，不要编造；公司名、零部件名用资料中出现的名称；占比为资料中的数字；资料里没有的字段输出空数组。",
    'JSON 格式：{"components":[{"code":"编号或空","name":"零部件名","description":"一句话说明","cost_share":"如 30-35% 或空","companies":["相关公司名"]}],"companies":[{"name":"公司名","ticker":"股票代码或空","role":"业务定位一句话","business_mix":[["业务名",占比]]}],"cost_breakdown":[{"name":"成本类目如推进系统","share":占比数字}],"stages":[{"code":"编号","name":"分段名","description":"一句话说明"}]}。',
    "business_mix 的占比为 0-100 的数字；每项都要来自资料。如果资料整体与航天产业链无关，四个字段都输出空数组。",
    "",
    "资料内容：",
    material,
  ].join("\n");
}

function parseAerospaceExtraction(text) {
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : cleaned);

  const cleanArr = (value) => (Array.isArray(value) ? value : []);
  const cleanStr = (value) => String(value ?? "").trim();
  const cleanNum = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 && num <= 100 ? num : null;
  };

  return {
    components: cleanArr(parsed.components).map((item) => ({
      code: cleanStr(item?.code),
      name: cleanStr(item?.name),
      description: cleanStr(item?.description),
      cost_share: cleanStr(item?.cost_share),
      companies: cleanArr(item?.companies).map(cleanStr).filter(Boolean),
    })).filter((item) => item.name),
    companies: cleanArr(parsed.companies).map((item) => {
      const mix = cleanArr(item?.business_mix)
        .map((entry) => (Array.isArray(entry) ? [cleanStr(entry[0]), cleanNum(entry[1])] : null))
        .filter((entry) => entry && entry[0]);
      return {
        name: cleanStr(item?.name),
        ticker: cleanStr(item?.ticker),
        role: cleanStr(item?.role),
        business_mix: mix,
      };
    }).filter((item) => item.name),
    cost_breakdown: cleanArr(parsed.cost_breakdown).map((item) => ({
      name: cleanStr(item?.name),
      share: cleanNum(item?.share),
    })).filter((item) => item.name),
    stages: cleanArr(parsed.stages).map((item) => ({
      code: cleanStr(item?.code),
      name: cleanStr(item?.name),
      description: cleanStr(item?.description),
    })).filter((item) => item.code || item.name),
  };
}

export async function extractAerospace(sourceId) {
  const source = await get("SELECT * FROM ms_aerospace_sources WHERE id = ?", [sourceId]);
  if (!source) throw userError("资料不存在", 404);

  const material = String(source.transcript || "").trim();
  if (!material) {
    await queryRun("UPDATE ms_aerospace_sources SET status = 'needs_transcription', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sourceId]);
    throw userError("资料还没有可抽取的文本内容", 400);
  }

  await queryRun("UPDATE ms_aerospace_sources SET status = 'extracting', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sourceId]);

  const model = process.env.OPENAI_COMPATIBLE_MODEL || process.env.DASHBOARD_MODEL || "deepseek-v4-pro";
  const response = await fetch(`${process.env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你只输出合法 JSON。" },
        { role: "user", content: buildAerospacePrompt(material) },
      ],
    }),
  });
  if (!response.ok) throw userError(`航天图谱抽取失败：HTTP ${response.status} ${await response.text()}`, 502);

  const content = (await response.json()).choices?.[0]?.message?.content || "";
  const extraction = parseAerospaceExtraction(content);

  await queryRun("UPDATE ms_aerospace_sources SET extraction = ?, status = 'extracted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [JSON.stringify(extraction), sourceId]);

  await mergeExtraction(sourceId, extraction, source.category || "rocket");
  return extraction;
}

function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendSourceId(existingIds, newId) {
  const ids = parseJsonArray(existingIds);
  if (!ids.includes(newId)) ids.push(newId);
  return JSON.stringify(ids);
}

async function mergeCompany(sourceId, category, company) {
  const existing = await get("SELECT * FROM ms_aerospace_companies WHERE category = ? AND name = ?", [category, company.name]);
  const nextSourceIds = await appendSourceId(existing?.source_ids, sourceId);

  if (existing) {
    if (existing.manual_override) {
      // 手动修正过：只追加 source_id，不覆盖字段
      await queryRun("UPDATE ms_aerospace_companies SET source_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextSourceIds, existing.id]);
      return existing.id;
    }
    const nextTicker = company.ticker || existing.ticker;
    const nextRole = company.role || existing.role;
    const nextMix = company.business_mix?.length ? JSON.stringify(company.business_mix) : existing.business_mix;
    await queryRun("UPDATE ms_aerospace_companies SET ticker = ?, role = ?, business_mix = ?, source_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextTicker, nextRole, nextMix, nextSourceIds, existing.id]);
    return existing.id;
  }

  const id = nanoid();
  await queryRun("INSERT INTO ms_aerospace_companies (id, category, name, ticker, role, business_mix, source_ids) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    id, category, company.name, company.ticker || null, company.role || null,
    company.business_mix?.length ? JSON.stringify(company.business_mix) : null, nextSourceIds,
  ]);
  return id;
}

async function mergeComponent(sourceId, category, component, companyIds) {
  const existing = await get("SELECT * FROM ms_aerospace_components WHERE category = ? AND name = ?", [category, component.name]);
  const nextSourceIds = await appendSourceId(existing?.source_ids, sourceId);

  if (existing) {
    if (existing.manual_override) {
      await queryRun("UPDATE ms_aerospace_components SET source_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextSourceIds, existing.id]);
    } else {
      await queryRun("UPDATE ms_aerospace_components SET code = COALESCE(?, code), description = COALESCE(NULLIF(?, ''), description), cost_share = COALESCE(NULLIF(?, ''), cost_share), source_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
        component.code || null, component.description, component.cost_share, nextSourceIds, existing.id,
      ]);
    }
    const componentId = existing.id;
    for (const companyId of companyIds) await ensureCompanyLink(sourceId, category, componentId, companyId);
    return componentId;
  }

  const id = nanoid();
  await queryRun("INSERT INTO ms_aerospace_components (id, category, code, name, description, cost_share, source_ids) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    id, category, component.code || null, component.name, component.description || null, component.cost_share || null, nextSourceIds,
  ]);
  for (const companyId of companyIds) await ensureCompanyLink(sourceId, category, id, companyId);
  return id;
}

async function ensureCompanyLink(sourceId, category, componentId, companyId) {
  const existing = await get("SELECT * FROM ms_aerospace_company_links WHERE component_id = ? AND company_id = ?", [componentId, companyId]);
  const nextSourceIds = await appendSourceId(existing?.source_ids, sourceId);
  if (existing) {
    await queryRun("UPDATE ms_aerospace_company_links SET source_ids = ? WHERE id = ?", [nextSourceIds, existing.id]);
    return;
  }
  await queryRun("INSERT INTO ms_aerospace_company_links (id, category, component_id, company_id, source_ids) VALUES (?, ?, ?, ?, ?)", [nanoid(), category, componentId, companyId, nextSourceIds]);
}

export async function mergeExtraction(sourceId, extraction, category) {
  // 1. 公司先入库（合并语义：填充而非覆盖空字段）
  const companyNameToId = new Map();
  for (const company of extraction.companies || []) {
    const companyId = await mergeCompany(sourceId, category, company);
    companyNameToId.set(company.name, companyId);
  }

  // 2. 零部件入库，并建立公司关联
  for (const component of extraction.components || []) {
    const companyIds = [];
    for (const name of component.companies || []) {
      let companyId = companyNameToId.get(name);
      if (!companyId) {
        companyId = await mergeCompany(sourceId, category, { name, ticker: "", role: "", business_mix: [] });
        companyNameToId.set(name, companyId);
      }
      companyIds.push(companyId);
    }
    await mergeComponent(sourceId, category, component, companyIds);
  }

  // 3. 成本结构
  for (const item of extraction.cost_breakdown || []) {
    const existing = await get("SELECT * FROM ms_aerospace_cost_breakdown WHERE category = ? AND name = ?", [category, item.name]);
    const nextSourceIds = await appendSourceId(existing?.source_ids, sourceId);
    if (existing) {
      if (!existing.manual_override && item.share != null) {
        await queryRun("UPDATE ms_aerospace_cost_breakdown SET share = ?, source_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.share, nextSourceIds, existing.id]);
      } else {
        await queryRun("UPDATE ms_aerospace_cost_breakdown SET source_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextSourceIds, existing.id]);
      }
    } else {
      await queryRun("INSERT INTO ms_aerospace_cost_breakdown (id, category, name, share, source_ids) VALUES (?, ?, ?, ?, ?)", [nanoid(), category, item.name, item.share, nextSourceIds]);
    }
  }

  // 4. 分段
  for (const item of extraction.stages || []) {
    const code = item.code || item.name;
    const existing = await get("SELECT * FROM ms_aerospace_stages WHERE category = ? AND code = ?", [category, code]);
    const nextSourceIds = await appendSourceId(existing?.source_ids, sourceId);
    if (existing) {
      if (!existing.manual_override) {
        await queryRun("UPDATE ms_aerospace_stages SET name = COALESCE(NULLIF(?, ''), name), description = COALESCE(NULLIF(?, ''), description), source_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.name, item.description, nextSourceIds, existing.id]);
      } else {
        await queryRun("UPDATE ms_aerospace_stages SET source_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextSourceIds, existing.id]);
      }
    } else {
      await queryRun("INSERT INTO ms_aerospace_stages (id, category, code, name, description, source_ids) VALUES (?, ?, ?, ?, ?, ?)", [nanoid(), category, code, item.name || code, item.description || null, nextSourceIds]);
    }
  }
}
