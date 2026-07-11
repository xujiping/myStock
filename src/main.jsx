import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, CheckCircle2, FileVideo, RefreshCw, Search, Sparkles, Trash2, Upload, UserRound, X } from "lucide-react";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:5174";

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function api(path, options) {
  const response = await fetch(`${apiBase}${path}`, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }
  return response.json();
}

function statusText(status) {
  return {
    uploaded: "已上传",
    extracting_audio: "抽取音频",
    audio_ready: "音频就绪",
    needs_transcription: "待转写",
    transcribing: "转写中",
    transcribed: "已转写",
    failed: "失败",
  }[status] || status;
}

function fileKey(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatFileSize(size) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function UploadPanel({ creators, onUploaded }) {
  const [creatorName, setCreatorName] = useState("");
  const [entryDate, setEntryDate] = useState(today());
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const fileInputRef = useRef(null);

  function addFiles(nextFiles) {
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      const merged = [...current];
      nextFiles.forEach((file) => {
        if (!seen.has(fileKey(file))) {
          seen.add(fileKey(file));
          merged.push(file);
        }
      });
      return merged;
    });
  }

  function removeFile(key) {
    setFiles((current) => current.filter((file) => fileKey(file) !== key));
  }

  function clearFiles() {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit(event) {
    event.preventDefault();
    setNotice(null);
    if (!files.length) {
      setNotice({ type: "error", text: "请选择至少一个 mp4 视频" });
      return;
    }
    const form = new FormData();
    form.append("creatorName", creatorName);
    form.append("entryDate", entryDate);
    files.forEach((file) => form.append("videos", file));
    setBusy(true);
    try {
      const result = await api("/api/upload", { method: "POST", body: form });
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNotice({
        type: "success",
        text: `上传成功：${result.videos.length} 个视频已加入 ${result.creator.name} / ${result.entry.entry_date} 的处理队列`,
      });
      onUploaded();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="upload-panel" onSubmit={submit}>
      <div className="upload-heading">
        <p className="eyebrow">上传入口</p>
        <h1>把零散短视频整理成每日观点卡</h1>
      </div>

      <label className="field">
        <span><UserRound size={16} /> 博主</span>
        <input
          value={creatorName}
          onChange={(event) => setCreatorName(event.target.value)}
          placeholder="搜索或新建博主"
          list="creator-options"
          autoComplete="off"
        />
        <datalist id="creator-options">
          {creators.map((creator) => (
            <option value={creator.name} key={creator.id} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span><CalendarDays size={16} /> 日期</span>
        <input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
      </label>

      <label className="drop-zone">
        <Upload size={22} />
        <strong>{files.length ? `已选择 ${files.length} 个视频` : "选择 mp4 视频"}</strong>
        <small>可一次选择多个，也可以分多次追加；同一天同一博主会合并成一张归档卡</small>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mp4"
          multiple
          onChange={(event) => {
            addFiles(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
      </label>

      <button className="submit-button" type="submit" disabled={busy}>
        {busy ? <RefreshCw className="spin" size={18} /> : <Upload size={18} />}
        {busy ? "上传中" : "上传并处理"}
      </button>
      {notice && (
        <div className={`form-notice ${notice.type}`} role="status">
          {notice.type === "success" && <CheckCircle2 size={18} />}
          <span>{notice.text}</span>
        </div>
      )}
      {files.length > 0 && (
        <section className="selected-files" aria-label="已选择的视频文件">
          <header>
            <span>{files.length} 个待上传视频</span>
            <button type="button" className="text-button" onClick={clearFiles}>
              <Trash2 size={15} />
              清空
            </button>
          </header>
          <div className="selected-file-list">
            {files.map((file) => (
              <div className="selected-file" key={fileKey(file)}>
                <FileVideo size={16} />
                <span>{file.name}</span>
                <small>{formatFileSize(file.size)}</small>
                <button type="button" aria-label={`移除 ${file.name}`} onClick={() => removeFile(fileKey(file))}>
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </form>
  );
}

function Filters({ date, setDate, query, setQuery, refresh }) {
  return (
    <section className="filters">
      <div className="filter-input">
        <CalendarDays size={17} />
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <button className="ghost-button" onClick={() => setDate("")}>全部日期</button>
      <div className="filter-input search">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索博主、总结或观点" />
      </div>
      <button className="ghost-button" onClick={refresh}>
        <RefreshCw size={17} />
        刷新
      </button>
    </section>
  );
}

function EntryCard({ entry, onRefresh }) {
  const [openVideo, setOpenVideo] = useState(null);
  const [manualText, setManualText] = useState("");

  async function saveTranscript(videoId) {
    await api(`/api/videos/${videoId}/transcript`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: manualText }),
    });
    setManualText("");
    setOpenVideo(null);
    onRefresh();
  }

  async function summarize() {
    await api(`/api/entries/${entry.id}/summarize`, { method: "POST" });
    onRefresh();
  }

  return (
    <article className="entry-card">
      <header>
        <div>
          <p className="eyebrow">{entry.entry_date}</p>
          <h2>{entry.creator_name}</h2>
        </div>
        <span className={`entry-status ${entry.status}`}>{entry.status === "summarized" ? "已总结" : "整理中"}</span>
      </header>

      <section className="summary-block">
        <div className="summary-title">
          <Sparkles size={17} />
          <span>注意 / 关注</span>
        </div>
        <p>{entry.ai_summary || "上传视频后会先抽取音频；配置本地 Whisper 后可自动转写。也可以先手动粘贴转写文本生成总结。"}</p>
      </section>

      {!!entry.key_points?.length && (
        <section className="core-points">
          <div className="section-label">核心观点</div>
          <ul className="points">
            {entry.key_points.map((point, index) => (
              <li key={`${point}-${index}`}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="video-list">
        {entry.videos.map((video) => (
          <div className="video-row" key={video.id}>
            <div>
              <FileVideo size={17} />
              <span>{video.original_name}</span>
            </div>
            <button className="tiny-button" onClick={() => {
              setOpenVideo(openVideo === video.id ? null : video.id);
              setManualText(video.transcript || "");
            }}>
              {statusText(video.status)}
            </button>
            {openVideo === video.id && (
              <div className="transcript-editor">
                {video.error && <p className="error-text">{video.error}</p>}
                <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="本地转写未配置或效果不佳时，可把转写文本粘贴在这里" />
                <button onClick={() => saveTranscript(video.id)}>保存转写</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <footer>
        <span>{entry.videos.length} 个视频</span>
        <button className="ghost-button" onClick={summarize}>
          <Sparkles size={16} />
          重新总结
        </button>
      </footer>
    </article>
  );
}

function TimelineDay({ date, entries, onRefresh }) {
  return (
    <section className="timeline-day">
      <div className="timeline-marker">
        <span>{date.slice(5)}</span>
      </div>
      <div className="timeline-content">
        <header className="day-header">
          <div>
            <p className="eyebrow">Daily Review</p>
            <h2>{date}</h2>
          </div>
          <span>{entries.length} 位博主</span>
        </header>
        <div className="creator-stack">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} onRefresh={onRefresh} />
          ))}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [entries, setEntries] = useState([]);
  const [creators, setCreators] = useState([]);
  const [date, setDate] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadCreators() {
    const data = await api("/api/creators");
    setCreators(data);
  }

  async function loadEntries() {
    setLoading(true);
    try {
      const data = await api(`/api/entries${date ? `?date=${date}` : ""}`);
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEntries();
    loadCreators();
    const timer = setInterval(loadEntries, 7000);
    return () => clearInterval(timer);
  }, [date]);

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter((entry) => {
      const haystack = [entry.creator_name, entry.ai_summary, ...(entry.key_points || [])].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [entries, query]);

  const timelineDays = useMemo(() => {
    const groups = new Map();
    visibleEntries.forEach((entry) => {
      if (!groups.has(entry.entry_date)) groups.set(entry.entry_date, []);
      groups.get(entry.entry_date).push(entry);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([groupDate, groupEntries]) => ({
        date: groupDate,
        entries: groupEntries.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
      }));
  }, [visibleEntries]);

  return (
    <main className="app-shell">
      <aside className="side-rail">
        <div className="brand-mark">观</div>
        <div>
          <p className="eyebrow">Creator Review</p>
          <h2>观点复盘台</h2>
        </div>
      </aside>

      <section className="workspace">
        <UploadPanel creators={creators} onUploaded={() => {
          loadEntries();
          loadCreators();
        }} />
        <Filters date={date} setDate={setDate} query={query} setQuery={setQuery} refresh={loadEntries} />

        <section className="timeline">
          {loading && <div className="empty-state">正在读取归档...</div>}
          {!loading && timelineDays.length === 0 && <div className="empty-state">还没有归档。上传几个视频后，这里会按日期倒序生成时间线。</div>}
          {timelineDays.map((day) => (
            <TimelineDay key={day.date} date={day.date} entries={day.entries} onRefresh={loadEntries} />
          ))}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
