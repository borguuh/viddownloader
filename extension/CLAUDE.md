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

- `activeTab`, `scripting`, `downloads`, `storage`, `webRequest`, plus
  `host_permissions: ["<all_urls>"]` — the last two exist specifically for
  HLS/DASH manifest interception and cross-origin manifest/segment fetches
  (see Adaptive streaming below).

## Build tooling

Vite + `@crxjs/vite-plugin`, which reads `manifest.json` at the extension
root and bundles the popup (React), content script, and background worker
from a single `vite.config.ts`. Output goes to `dist/` (gitignored) — load
that folder via `chrome://extensions` → "Load unpacked" for manual testing.

No automated test framework yet. Manual verification = load unpacked +
open the popup on a page with a `<video>` element.

## Adaptive streaming (HLS/DASH)

- **Detection** (`src/background/index.ts`, `chrome.webRequest.onBeforeRequest`):
  watches network requests for `.m3u8`/`.mpd` URLs per tab, fetches and
  parses each manifest once (`src/background/streams.ts`), caches the
  result in `streamsByTab`. Requires the `webRequest` permission and
  `host_permissions: ["<all_urls>"]` (added in M4) — extension-context
  fetches with a matching host permission aren't subject to the page's CORS
  restrictions, which is what lets us fetch cross-origin manifests/segments.
- **HLS parsing** (`parseHlsMaster`): regex over `#EXT-X-STREAM-INF` lines
  for `RESOLUTION`/`BANDWIDTH`, paired with the following URI line. If the
  manifest has no `STREAM-INF` lines it's already a media (segment)
  playlist, not a master — treated as a single "unknown" resolution variant.
- **DASH parsing** (`parseDashMpd`): regex over `<Representation>` tags for
  `width`/`height`/`bandwidth` attributes. This is **detection/display
  only** — `StreamManifest.downloadable` is `false` for DASH, so the popup
  shows variants but disables the download button. A real implementation
  needs proper `BaseURL` inheritance and segment template resolution, which
  regex-matching can't do reliably; revisit with a real XML parse if DASH
  download support becomes worth the effort (service workers have no
  `DOMParser`, so that'll mean pulling in a small XML parsing dependency).
- **HLS download** (`downloadHlsVariant`): fetches the chosen variant
  playlist, resolves every segment URL, fetches segments **sequentially**
  (no parallelism, no progress UI — both worth adding later), concatenates
  them into one `Blob`, and downloads via a `URL.createObjectURL()` handed
  to `chrome.downloads.download()`.

## Known limitations to revisit

- Playlist detection is a generic DOM heuristic, not per-site. If a
  particular course site doesn't get picked up, the fix is almost always in
  `collectPlaylistLinks()` (e.g. adjust the minimum bucket size, or the
  signature used to group anchors) rather than the queue/download logic.
- The batch queue downloads the *first* video found with a `src` on each
  opened page — it doesn't yet handle pages with multiple videos or let you
  pick a resolution per queued item. Fine for now since most course lesson
  pages have exactly one player.
- HLS download concatenates segments as-is: works for MPEG-TS segments and
  most fMP4/CMAF in practice, but **encrypted streams (`#EXT-X-KEY`) will
  download without decryption** and likely won't play. Not handled — this
  tool doesn't attempt DRM/encryption bypass by design (see root
  `CLAUDE.md`).
- Long HLS downloads (many sequential segment fetches) risk the MV3 service
  worker being reclaimed mid-download on very long videos. Not yet
  mitigated (e.g. with a keep-alive alarm) — revisit if it turns out to be
  a real problem in practice.
- No download progress indicator for streams or the batch queue — you only
  see the result once it lands in Downloads.

## Roadmap position

Milestones 1–4 are done — see root `CLAUDE.md`. Next up (M5) is polish:
options page, download history, and error handling for blocked/CORS edge
cases.
