# 观点复盘台

个人使用的视频观点整理网站。支持把抖音等平台下载的 mp4 上传到指定博主和日期下，系统会抽取音频并优先尝试本地转写；同一天同一博主的多个视频会合并成一张每日观点卡。

## 运行

```bash
npm run dev
```

前端默认地址：`http://localhost:5173`

后端默认地址：`http://localhost:5174`

## 本地转写

系统会先用 `ffmpeg` 从 mp4 抽取 16k 单声道 wav。若本机安装了 `whisper` 命令，会自动执行：

```bash
whisper uploads/audio/xxx.wav --language Chinese --model small --output_format txt --output_dir uploads/audio
```

也可以通过环境变量指定命令和模型：

```bash
WHISPER_CMD=whisper WHISPER_MODEL=medium npm run dev
```

没有安装 Whisper 时，视频会停留在“待转写”，可以在网页里手动粘贴转写文本并生成总结。

## 数据表

SQLite 数据库位于 `data/mystock.sqlite`，表名均使用项目前缀：

- `ms_creators`
- `ms_entries`
- `ms_videos`

## 后续可接入

- 本地更高质量转写：`faster-whisper`、Whisper.cpp、FunASR
- 第三方转写：通义听悟、阿里云智能语音交互
- AI 总结：本地 Ollama、OpenAI-compatible API、通义千问等

## AI 总结配置

默认会使用本地兜底摘要。若要接入本地 Ollama：

```bash
OLLAMA_MODEL=qwen2.5:7b npm run dev
```

若要接入任意兼容 `/chat/completions` 的模型服务：

```bash
OPENAI_COMPATIBLE_BASE_URL=https://api.example.com/v1 \
OPENAI_COMPATIBLE_API_KEY=你的密钥 \
OPENAI_COMPATIBLE_MODEL=qwen-plus \
npm run dev
```
