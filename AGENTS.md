# Repository Guidelines

## Project Structure & Module Organization

This repository is a local-first video review web app.

- `src/`: React frontend. `main.jsx` contains the main UI flow; `styles.css` contains the responsive timeline and upload styles.
- `server/`: Express backend. `index.js` defines API routes, `db.js` initializes SQLite, and `jobs.js` handles audio extraction, transcription, and AI summaries.
- `data/`: Local SQLite database files. Do not commit this directory.
- `uploads/`: Uploaded videos and extracted audio. Do not commit this directory.
- `dist/`: Vite production build output. Generated only.
- `.env.example`: Configuration template. `.env` contains secrets and must stay local.

## Build, Test, and Development Commands

- `npm run dev`: Start backend and Vite frontend together.
- `npm run dev:server`: Start the Express API at `http://localhost:5174`.
- `npm run dev:web`: Start the Vite app at `http://localhost:5173`.
- `npm run build`: Build the frontend into `dist/`.
- `npm run start`: Run the backend in production mode and serve `dist/` when present.
- `npm run preview`: Preview the Vite production build.

There is currently no automated test command configured.

## Coding Style & Naming Conventions

Use ES modules, React functional components, and two-space indentation. Prefer clear function names such as `loadEntries`, `summarizeEntry`, and `processVideo`. Keep backend route handlers small and move reusable work into helpers.

Database tables must use the project-specific `ms_` prefix. Existing examples: `ms_creators`, `ms_entries`, and `ms_videos`.

Use CSS custom properties from `src/styles.css` for spacing and colors. Avoid one-off hard-coded layout values unless they are component-specific.

## Testing Guidelines

Until a test framework is added, verify changes manually:

- Run `npm run build`.
- Check `curl http://localhost:5174/api/health`.
- Test upload, multi-file selection, transcription status, and timeline rendering in the browser.
- For responsive work, test desktop and mobile widths and ensure there is no horizontal scrolling.

If tests are added later, place frontend tests near `src/` components and backend tests near `server/` modules.

## Commit & Pull Request Guidelines

This repository currently has no git history, so use concise conventional-style commits going forward, for example:

- `feat: add multi-file upload queue`
- `fix: preserve Chinese upload filenames`
- `style: improve mobile timeline layout`

Pull requests should include a short summary, manual verification steps, screenshots for UI changes, and notes about any database or environment changes.

## Security & Configuration Tips

Never commit `.env`, `data/`, `uploads/`, or API keys. Use `.env.example` when documenting configuration. AI summary providers should be configured through environment variables such as `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, and `OPENAI_COMPATIBLE_MODEL`.
