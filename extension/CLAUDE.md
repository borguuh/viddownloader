# Video Downloader Extension

Manifest V3 Chrome extension. Standalone package — run all commands from
inside this `extension/` directory (`npm install`, `npm run dev`, `npm run build`).

## Architecture

- **Content script** (`src/content/detect-videos.ts`): runs on every page,
  queries `<video>` elements (and their `<source>` children), sends a
  `videos-detected` message to the background worker whenever the DOM
  changes (debounced 300ms via `MutationObserver`) or a video's metadata
  loads. The whole body is wrapped in a `window.__videoDownloaderInjected`
  guard so it's safe to inject twice — needed because the popup injects
  this script on demand (see `ensure-injected.ts` below) rather than relying
  only on the manifest's automatic injection into freshly-navigated tabs.
  Also runs `collectPlaylistLinks()`, a heuristic that first narrows to
  `findScopedContainer()` — the nearest ancestor of the `<video>` element
  with ≥3 links, excluding `<nav>`/`<header>`/`<footer>` — then buckets
  same-origin links within that scope by their parent's tag+class signature
  and picks the largest bucket (≥3 distinct links) as the likely
  lesson/episode list, sent as `playlist-detected`. Scoping to the area
  around the player (rather than the whole page) is what keeps this from
  picking up sitewide nav menus as if they were playlist items. Still
  fuzzy by nature — works for typical course-site layouts, not guaranteed
  on arbitrary ones.
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
- **Popup** (`src/popup/`): React + TS UI. On open, first calls
  `ensureContentScriptInjected()` (`src/popup/ensure-injected.ts`) —
  reads the content script paths straight out of
  `chrome.runtime.getManifest()` and injects them into the active tab via
  `chrome.scripting.executeScript` if they aren't already running there —
  then asks the background worker for the active tab's videos/playlist/
  streams. Offers a download button per detected source (main `src` plus
  any `<source>` children, deduplicated; `blob:` sources are excluded, see
  below). Filename/source logic lives in `src/popup/downloads.ts`
  (`getDownloadableSources`, `isBlobOnly`) but **the actual download call
  is routed through the background worker** via a `download-video` message
  rather than calling `chrome.downloads.download()` directly from the
  popup — see Download paths below for why.
- **Shared types** (`src/shared/types.ts`): message/data contracts used by
  all three pieces above. Keep this the single source of truth for message
  shapes — don't inline ad-hoc message objects elsewhere.
- **Download paths** (`src/shared/download-paths.ts`): every download goes
  under `Downloader/` inside the default Downloads folder —
  `buildDownloadPath(filename)` for single videos/HLS,
  `buildDownloadPath(filename, seriesFolder)` for batch/playlist downloads
  (`Downloader/<series folder>/<filename>`). The series folder name comes
  from a text input in `PlaylistPanel` (defaults to the page title),
  carried through `EnqueueDownloadsRequest.folderName` and threaded through
  the background queue's `folderNameForTab` map per queued tab.
  **Important**: passing `filename` straight to `chrome.downloads.download()`
  is silently ignored if *any* installed extension (not just this one) has
  registered a `chrome.downloads.onDeterminingFilename` listener — a
  download manager, ad blocker, etc. can override it without erroring. The
  reliable fix is for this extension to register its own
  `onDeterminingFilename` listener and call `suggest()` with the desired
  path — that's what `downloadWithPath()` in `src/background/index.ts`
  does (tracking the desired path per URL in `pendingFilenames`, consumed
  the moment Chrome asks). **Every download in this codebase must go
  through `downloadWithPath()`** (in the background worker) rather than
  calling `chrome.downloads.download()` directly — that's why the popup
  sends a `download-video` message instead of downloading itself.

## Permissions

- `activeTab`, `scripting`, `downloads`, `storage`, `webRequest`,
  `notifications`, `offscreen`, plus `host_permissions: ["<all_urls>"]` —
  `webRequest`/`host_permissions` exist specifically for HLS/DASH manifest
  interception and cross-origin manifest/segment fetches (see Adaptive
  streaming below); `notifications` is for surfacing download failures
  (`notifyFailure()` in the background worker) instead of failing silently;
  `offscreen` is for the hidden document that creates Blob object URLs the
  service worker itself can't (see HLS download below).

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
  (no parallelism, no progress UI — both worth adding later) as `Blob`s.
  **`URL.createObjectURL()` doesn't exist in the MV3 service worker** (no
  DOM there), so blob assembly is offloaded to a hidden **offscreen
  document** (`src/offscreen/`, `chrome.offscreen.createDocument`, the
  `offscreen` permission): the background worker base64-encodes each
  segment `Blob` (`blobToBase64` in `src/shared/base64.ts` — messaging is
  JSON-only, so raw `Blob`/`ArrayBuffer` can't cross that boundary),
  sends them to the offscreen document via `offscreen-create-blob`, which
  decodes them back, builds the real `Blob`, calls
  `URL.createObjectURL()`, and returns the resulting URL. The background
  worker then downloads that URL via the normal `downloadWithPath()` path
  and tells the offscreen document to `URL.revokeObjectURL()` it a minute
  later. The offscreen document is created once and kept alive
  (`offscreenReady`), not recreated per download.

## Known limitations to revisit

- Playlist detection is a generic DOM heuristic, not per-site. If a
  particular course site doesn't get picked up, the fix is almost always in
  `collectPlaylistLinks()`/`findScopedContainer()` (e.g. adjust the minimum
  bucket size, the scoping walk-up logic, or the signature used to group
  anchors) rather than the queue/download logic.
- There's a small race in the popup: `ensureContentScriptInjected` resolves
  once the script has run synchronously, but the `videos-detected` message
  it sends is still an async dispatch to the background worker, so a
  freshly-injected tab's very first popup open can occasionally miss the
  video list. Reopening the popup immediately after works. Not worth adding
  artificial delays for until it proves to be a real annoyance.
- The batch queue downloads the *first* video found with a `src` on each
  opened page — it doesn't yet handle pages with multiple videos or let you
  pick a resolution per queued item. Fine for now since most course lesson
  pages have exactly one player.
- HLS download concatenates segments as-is: works for MPEG-TS segments and
  most fMP4/CMAF in practice, but **encrypted streams (`#EXT-X-KEY`) will
  download without decryption** and likely won't play. Not handled — this
  tool doesn't attempt DRM/encryption bypass by design (see root
  `CLAUDE.md`). `downloadHlsVariant()` now surfaces fetch failures via
  `chrome.notifications` instead of failing silently, but a CDN rejecting
  segment requests for lacking the original page's `Referer` (hotlink
  protection) will still show as a failure notification, not a working
  download — `fetch()` can't set `Referer` manually; fixing that for real
  would mean `chrome.declarativeNetRequest` header-rewrite rules, not
  attempted yet.
- `blob:` video sources (MSE playback — YouTube, LinkedIn, etc.) are
  filtered out of the direct-download list in the popup (`isBlobOnly` /
  `getDownloadableSources` in `src/popup/downloads.ts`) since they're
  scoped to the page's own context and can never be fetched by the
  extension. If the same page's underlying stream also happens to be HLS/
  DASH, M4's Adaptive stream panel may still catch it — otherwise there's
  currently no way to download it (this is most of what makes YouTube/M6
  hard).
- Long HLS downloads (many sequential segment fetches) risk the MV3 service
  worker being reclaimed mid-download on very long videos. Not yet
  mitigated (e.g. with a keep-alive alarm) — revisit if it turns out to be
  a real problem in practice.
- No download progress indicator for streams or the batch queue — you only
  see the result once it lands in Downloads.

## Roadmap position

Milestones 1–4 are done, M5 is in progress (folder structure + the reload/
playlist-scope/YouTube-not-supported bugs found in real testing — see root
`CLAUDE.md`). Still open for M5: options page, download history, better
error handling for blocked/CORS edge cases. YouTube support is its own
milestone (M6), deliberately not attempted yet.
