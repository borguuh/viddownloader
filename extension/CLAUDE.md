# Video Downloader Extension

Manifest V3 Chrome extension. Standalone package — run all commands from
inside this `extension/` directory (`npm install`, `npm run dev`, `npm run build`).

## Architecture

- **Content script** (`src/content/detect-videos.ts`): runs on every page,
  queries `<video>` elements (and their `<source>` children), sends a
  `videos-detected` message to the background worker whenever the DOM
  changes (via `MutationObserver`) or a video's metadata loads.
- **Background service worker** (`src/background/index.ts`): caches the
  last-known video list per tab id. Answers `get-videos` requests from the
  popup with the current tab's cached list.
- **Popup** (`src/popup/`): React + TS UI. On open, asks the background
  worker for the active tab's videos and lists them. Download controls come
  in M2.
- **Shared types** (`src/shared/types.ts`): message/data contracts used by
  all three pieces above. Keep this the single source of truth for message
  shapes — don't inline ad-hoc message objects elsewhere.

## Permissions

- `activeTab`, `scripting`, `downloads`, `storage` — current milestone.
- `webRequest`/`declarativeNetRequest` will be added in M4 for HLS/DASH
  manifest interception — don't add until that milestone actually needs it.

## Build tooling

Vite + `@crxjs/vite-plugin`, which reads `manifest.json` at the extension
root and bundles the popup (React), content script, and background worker
from a single `vite.config.ts`. Output goes to `dist/` (gitignored) — load
that folder via `chrome://extensions` → "Load unpacked" for manual testing.

No automated test framework yet. Manual verification = load unpacked +
open the popup on a page with a `<video>` element.

## Roadmap position

This is Milestone 1 (detection only — see root `CLAUDE.md`). Next up (M2) is
wiring `chrome.downloads.download()` to the detected `src`/`sources`.
