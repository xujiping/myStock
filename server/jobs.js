import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, touchEntry } from "./db.js";

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

export async function processVideo(videoId) {
  const video = db.prepare("SELECT * FROM ms_videos WHERE id = ?").get(videoId);
  if (!video) return;

  try {
    db.prepare("UPDATE ms_videos SET status = 'extracting_audio', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(videoId);

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

    db.prepare("UPDATE ms_videos SET audio_path = ?, status = 'audio_ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(audioPath, videoId);

    const whisperCmd = process.env.WHISPER_CMD || "";
    if (!whisperCmd && !(await commandExists("whisper"))) {
      db.prepare("UPDATE ms_videos SET status = 'needs_transcription', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(videoId);
      touchEntry(video.entry_id);
      return;
    }

    db.prepare("UPDATE ms_videos SET status = 'transcribing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(videoId);
    const cmd = whisperCmd || "whisper";
    const outputDir = path.resolve("uploads/audio");
    await run(cmd, [audioPath, "--language", "Chinese", "--model", process.env.WHISPER_MODEL || "small", "--output_format", "txt", "--output_dir", outputDir]);

    const transcriptPath = path.join(outputDir, `${path.basename(audioPath, ".wav")}.txt`);
    const transcript = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8").trim() : "";

    db.prepare("UPDATE ms_videos SET transcript = ?, status = 'transcribed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(transcript, videoId);
    touchEntry(video.entry_id);
    await summarizeEntry(video.entry_id);
  } catch (error) {
    db.prepare("UPDATE ms_videos SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(String(error.message || error), videoId);
    touchEntry(video.entry_id);
  }
}

function localDigest(transcripts) {
  const text = transcripts.join("\n").replace(/\s+/g, " ").trim();
  if (!text) return { summary: "", points: [] };
  const sentences = text.split(/[。！？!?]/).map((item) => item.trim()).filter(Boolean);
  const points = sentences.slice(0, 6).map((item) => (item.length > 80 ? `${item.slice(0, 80)}...` : item));
  const summary = sentences.slice(0, 3).join("。") + (sentences.length ? "。" : "");
  return { summary, points };
}

export async function summarizeEntry(entryId) {
  const videos = db.prepare("SELECT transcript FROM ms_videos WHERE entry_id = ? AND transcript IS NOT NULL AND transcript != '' ORDER BY created_at").all(entryId);
  const transcripts = videos.map((video) => video.transcript);
  let digest = await llmDigest(transcripts).catch(() => null);
  if (!digest) digest = localDigest(transcripts);

  db.prepare(`
    UPDATE ms_entries
    SET ai_summary = ?, key_points = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(digest.summary, JSON.stringify(digest.points), transcripts.length ? "summarized" : "collecting", entryId);

  return digest;
}

function buildSummaryPrompt(transcripts) {
  return [
    "你是一个帮助用户复盘博主观点的中文助理。",
    "请基于下面同一位博主同一天多个短视频的转写内容，输出 JSON。",
    "JSON 格式：{\"summary\":\"不超过180字的每日总述\",\"points\":[\"观点1\",\"观点2\",\"观点3\"]}。",
    "要求：提炼观点，不要编造；合并重复观点；保留可复盘的判断、理由和行动启发。",
    "",
    transcripts.join("\n\n---\n\n"),
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

async function llmDigest(transcripts) {
  if (!transcripts.length) return null;
  const prompt = buildSummaryPrompt(transcripts);

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
    if (!response.ok) throw new Error(`Ollama summary failed: ${response.status}`);
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
    if (!response.ok) throw new Error(`OpenAI-compatible summary failed: ${response.status}`);
    const data = await response.json();
    return parseJsonText(data.choices?.[0]?.message?.content || "");
  }

  return null;
}
