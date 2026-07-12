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
