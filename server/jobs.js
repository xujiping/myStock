import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

