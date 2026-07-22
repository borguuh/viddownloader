# Video Downloader Extension

Manifest V3 Chrome extension. Standalone package — run all commands from
inside this `extension/` directory (`npm install`, `npm run dev`, `npm run build`).

## Architecture

- **Content script** (`src/content/detect-videos.ts`): runs on every page,
  queries `<video>` elements (and their `<source>` children), sends a
  `videos-detected` message to the background worker whenever the DOM
  changes (debounced 300ms via `MutationObserver`) or a video's metadata
  loads. Also runs `collectPlaylistLinks()`, a heuristic that buckets
  same-origin `<a href>` elements by their parent's tag+class signature and
  picks the largest bucket (≥3 distinct links) as the likely lesson/episode
  list, sent as `playlist-detected`. This is inherently fuzzy — it works for
  typical course-site sidebars but isn't guaranteed on arbitrary layouts.
- **Background service worker** (`src/background/index.ts`): caches the
  last-known video list and playlist per tab id, answers `get-videos`/
  `get-playlist` requests from the popup. Also owns the **batch download
  queue**: on `enqueue-downloads`, it opens each playlist URL in a background
  tab (`active: false`), waits for that tab's content script to report a
  video with a usable `src`, downloads it, closes the tab, and moves to the
  next item — fully sequential, with a 20s per-tab timeout
  (`TAB_LOAD_TIMEOUT_MS`) in case a page never surfaces a video. Tabs
  spawned this way are tracked in `queueTabIds` so their `videos-detected`
  messages are treated differently from normal browsing tabs (auto-download
  instead of just caching for the popup).
- **Popup** (`src/popup/`): React + TS UI. On open, asks the background
  worker for the active tab's videos, lists them, and offers a download
  button per detected source (main `src` plus any `<source>` children,
  deduplicated). Download logic lives in `src/popup/downloads.ts`
  (`getDownloadableSources`, `startDownload`) — call `chrome.downloads`
  directly from the popup rather than round-tripping through the background
  worker, since popup pages already have full extension API access.
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

Milestones 1–3 are done — see root `CLAUDE.md`. Next up (M4) is adaptive
streaming (HLS/DASH) support, since the queue/download path so far assumes
a directly downloadable file URL per video.

## Known limitations to revisit

- Playlist detection is a generic DOM heuristic, not per-site. If a
  particular course site doesn't get picked up, the fix is almost always in
  `collectPlaylistLinks()` (e.g. adjust the minimum bucket size, or the
  signature used to group anchors) rather than the queue/download logic.
- The batch queue downloads the *first* video found with a `src` on each
  opened page — it doesn't yet handle pages with multiple videos or let you
  pick a resolution per queued item. Fine for now since most course lesson
  pages have exactly one player.
