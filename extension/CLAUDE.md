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
  Playlist detection (`collectPlaylistLinks()`) has two paths, tried in
  order:
  1. **A manually-picked selector** (`storedSelector`, loaded from
     `chrome.storage.local` under `playlistSelector:<origin>`) — if the user
     has run the picker for this origin (see below), its saved container is
     queried directly (`extractLinksFromContainer`) and used as-is. This is
     the reliable path.
  2. **A blind DOM heuristic fallback** (`collectPlaylistLinksHeuristic`),
     used only when no selector is stored yet: narrows to
     `findScopedContainer()` — the nearest ancestor of the `<video>` element
     with ≥3 links, excluding `<nav>`/`<header>`/`<footer>` — then buckets
     same-origin links within that scope by their parent's tag+class
     signature and picks the largest bucket (≥3 distinct links). Confirmed
     unreliable in practice on real sites (misses lesson lists that aren't a
     DOM ancestor of the video; picks up unrelated link clusters like a
     "who to follow" sidebar on other sites) — it's a best-effort guess, not
     something to keep tuning indefinitely. The manual picker is the actual
     fix.
  - **Manual playlist picker**: triggered by a `start-picking` message from
    the popup. Adds a capturing `mouseover` listener that outlines whatever
    element is under the cursor, and a capturing `click` listener
    (`preventDefault`/`stopPropagation`, so it doesn't navigate) that
    computes a selector for the clicked element via `buildSelector()` —
    prefers `id`, otherwise walks up building a `tag.class` path until
    `document.querySelectorAll(selector).length === 1` confirms uniqueness
    — then saves it to `chrome.storage.local` and re-runs detection
    immediately. A `clear-playlist-selector` message removes the saved
    selector and falls back to the heuristic again.
  - **`navigate` vs `click` playlists** (`classifyAnchors()`): some course
    sites have no real per-lesson URL at all — every item is `<a href="#">`
    (or similar) whose click handler swaps the page's own `<video>` in
    place, single-page-app style, rather than navigating anywhere. If every
    candidate anchor's raw `href` attribute is a pseudo-link (`#`, empty, or
    `javascript:`), the whole group is classified `"click"` instead of
    `"navigate"`; the actual `<a>` elements are kept in module-level
    `playlistClickElements` (there's no distinct URL to key them by), and
    each `PlaylistItem.url` becomes a synthetic `#item-N` placeholder
    encoding its index into that array. This `kind` is threaded through
    `playlist-detected`/`get-playlist` to the popup, which branches its
    download flow accordingly (see `PlaylistPanel.tsx` below) — `"navigate"`
    keeps using the background's open-tab queue (see below); `"click"`
    instead sends `run-click-series` back to *this* content script, which
    clicks each selected item in turn, polls `document.querySelector(
    "video")?.currentSrc` for a change (`waitForNewVideoSrc`, 8s timeout —
    items that never produce a video, e.g. quizzes mixed into the same
    list, just time out and get skipped, no need to special-case them),
    and sends a `download-video` message per one it finds — all
    sequentially, with an 800ms pause between clicks to avoid hammering the
    page. Progress is reported via `click-series-progress` messages
    (`{ total, completed, currentTitle, active }`) sent before/after each
    click — see Progress indicator below.
  - **Per-video overlay button** (`syncOverlays()`): a small floating
    "Download" button positioned over each `<video>` that has a real
    (non-`blob:`) src, so pages with multiple videos have an unambiguous
    per-video download action (not just a list in the popup). Positioned
    with `position: fixed` and synced to `video.getBoundingClientRect()`
    on scroll/resize (rAF-throttled via `scheduleReposition`) rather than
    inserted into the page's own layout, so it can't disturb site CSS.
    Runs on every `reportVideos()` call. Toggleable via the
    `overlayButtonsEnabled` storage key (see Options page below), read
    once at startup and live-updated via `chrome.storage.onChanged`. Sends
    a `download-video` message directly, same as the popup's per-source
    buttons.
- **Background service worker** (`src/background/index.ts`): caches the
  last-known video list and `{ items, kind }` playlist per tab id, answers
  `get-videos`/`get-playlist` requests from the popup. Also owns the
  **`navigate`-style batch download queue**: on `enqueue-downloads`, it
  opens each playlist URL in a background tab (`active: false`), waits for
  that tab's content script to report a video with a usable `src`,
  downloads it, closes the tab, and moves to the next item — fully
  sequential, with a 20s per-tab timeout (`TAB_LOAD_TIMEOUT_MS`) in case a
  page never surfaces a video. Tabs spawned this way are tracked in
  `queueTabIds` so their `videos-detected` messages are treated differently
  from normal browsing tabs (auto-download instead of just caching for the
  popup). **This queue only applies to `"navigate"` playlists** — `"click"`
  playlists (see content script above) never touch the background worker
  for orchestration, only for the final `download-video` call per item,
  since there's no separate tab/URL involved at all.
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
  popup — see Download paths below for why. `PlaylistPicker.tsx` renders
  "Pick playlist area on page" / "Clear saved area" buttons — shown
  unconditionally (unlike `PlaylistPanel`, which hides itself when nothing's
  detected yet), since picking is exactly what you need when detection comes
  up empty or wrong. Clicking "Pick" sends `start-picking` to the content
  script and closes the popup so the user can click the actual page.
- **Shared types** (`src/shared/types.ts`): message/data contracts used by
  all three pieces above. Keep this the single source of truth for message
  shapes — don't inline ad-hoc message objects elsewhere.
- **Download paths** (`src/shared/download-paths.ts`): every download goes
  under a base subfolder (`DEFAULT_BASE_FOLDER = "Downloader"`, user
  -configurable in the options page — see below) of the default Downloads
  folder — `buildDownloadPath(filename, baseFolder)` for single
  videos/HLS, `buildDownloadPath(filename, baseFolder, seriesFolder)` for
  batch/playlist downloads (`<baseFolder>/<series folder>/<filename>`).
  **Only the background worker calls `buildDownloadPath()`** — it's the
  sole owner of the `baseFolderName` setting (cached in memory, reloaded
  live via `chrome.storage.onChanged`). Every other context (popup,
  content script) sends a **raw, unprefixed filename** in a
  `download-video` message, plus an optional `seriesFolder`; the
  background worker's `download-video` handler applies the prefix. This
  keeps the base-folder setting effective everywhere without needing to
  sync it into three separate contexts.
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
  `PlaylistPanel.tsx` branches "Download selected" on `kind`: `"navigate"`
  sends `enqueue-downloads` to the background worker (unchanged, series
  folder name comes from a text input there, defaults to the page title);
  `"click"` parses each selected item's `#item-N` placeholder back into an
  index and sends `run-click-series` to the content script via
  `chrome.tabs.sendMessage(tabId, ...)` instead — that message has to reach
  the content script specifically (not the background worker), since only
  the content script has the live DOM elements to click. `ProgressBar.tsx`
  polls `get-progress` every second (starting immediately on mount, so
  reopening the popup mid-download shows current state right away rather
  than waiting a full second) and renders a simple percentage bar; renders
  nothing when there's no batch in flight (`progress.total === 0`).

## Progress indicator

Both batch download flows report progress so the popup can show a bar,
since a 30+ item series otherwise runs with zero feedback for minutes:

- **`"navigate"` queue**: the background worker owns a single global
  `navigateQueueProgress` (only one such queue runs at a time — it's not
  per-tab, since it spans multiple background tabs over its lifetime).
  `enqueue()` grows `total` by however many items were just added (so
  queuing more mid-batch just extends it rather than resetting); each
  `finishTab()` (whether it downloaded something or just timed out)
  increments `completed`; `processNext()` sets `currentTitle` to whichever
  item is about to be opened. Marked inactive once the queue drains.
- **`"click"` series**: the content script sends `click-series-progress`
  messages as `runClickSeries()` runs; the background worker stores the
  latest one per tab id in `clickSeriesProgressByTab`.
- **`get-progress`** (background handler): while the navigate queue is
  active, it always wins (it isn't tied to whichever tab the popup happens
  to be showing). Otherwise, prefers the querying tab's own click-series
  progress, falling back to the last navigate summary if there is one —
  simple, not perfectly precise about "whose" progress is being shown if
  you've run both kinds in the same session, but good enough for a
  single-user tool.
- **`ProgressBar.tsx`**: polls `get-progress` every second the popup is
  open; renders nothing when `progress` is `null` or `total === 0`.

## Options page

`src/options/` — a small React page (`options_ui.page` in `manifest.json`,
`open_in_tab: true` so it gets real screen space rather than the tiny
embedded panel Chrome shows by default). Not referenced by the popup or
background — it's reached via the extension's details page or right-click
menu in `chrome://extensions`. Settings are read/written directly via
`chrome.storage.local` (every extension context has access — no messages
needed) using the shared keys in `src/shared/settings.ts`:

- **Base folder name** (`BASE_FOLDER_NAME_KEY`): text input, defaults to
  `DEFAULT_BASE_FOLDER`. Picked up live by the background worker via
  `chrome.storage.onChanged` (see Download paths above) — no reload needed.
- **Overlay buttons toggle** (`OVERLAY_BUTTONS_ENABLED_KEY`): checkbox,
  defaults on. Read by the content script (see per-video overlay button
  above), also live via `chrome.storage.onChanged`.
- **Saved playlist areas**: lists every `playlistSelector:<origin>` key
  (via `chrome.storage.local.get(null)`, filtered by prefix) with a
  "Forget" button per entry — the same effect as clicking "Clear saved
  area" in the popup, but reachable for sites you're not currently on.
- **Download history**: the background worker tracks every download id it
  initiates (`ourDownloadIds`, set inside `downloadWithPath()`), and
  `chrome.downloads.onChanged` records an entry (`{ filename, url,
  timestamp }`, most-recent-first, capped at `MAX_HISTORY_ENTRIES`) once
  that download's `state` reaches `"complete"` — deliberately *not* at
  initiation time, so failed/cancelled downloads don't pollute history.
  `chrome.downloads.search({ id })` supplies the final on-disk `filename`
  (an absolute path — the options page shows just the basename via
  `basename()`, for display only). Stored under `DOWNLOAD_HISTORY_KEY`;
  "Clear history" just removes that key.

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
  (no parallelism, and no progress reporting — unlike the two batch/series
  flows, see Progress indicator below — both worth adding later) as
  `Blob`s.
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

- Playlist detection now prefers a manually-picked per-origin selector over
  the blind heuristic (see Architecture above) — if a site still doesn't
  work, pick its playlist container directly rather than tuning
  `collectPlaylistLinksHeuristic()`/`findScopedContainer()` further; that
  heuristic is a last-resort fallback, not something worth perfecting.
- `buildSelector()`'s uniqueness check (`querySelectorAll(selector).length
  === 1`) can produce a selector that stops matching after the page
  re-renders with different generated class names (common in some frontend
  frameworks) — if a picked selector "stops working" after a while, the fix
  is re-picking, not chasing selector robustness indefinitely for a
  personal tool.
- There's a small race in the popup: `ensureContentScriptInjected` resolves
  once the script has run synchronously, but the `videos-detected` message
  it sends is still an async dispatch to the background worker, so a
  freshly-injected tab's very first popup open can occasionally miss the
  video list. Reopening the popup immediately after works. Not worth adding
  artificial delays for until it proves to be a real annoyance.
- The `"navigate"` batch queue downloads the *first* video found with a
  `src` on each opened page — it doesn't yet handle pages with multiple
  videos or let you pick a resolution per queued item. Fine for now since
  most course lesson pages have exactly one player.
- If the page's video briefly shows a stale/cached `currentSrc` before
  swapping to the real one, `waitForNewVideoSrc`'s "differs from the src
  captured right before clicking" check could resolve too early on an
  intermediate value — not observed yet, but worth knowing if a
  click-series download grabs the wrong video.
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
- The HLS stream download (`downloadHlsVariant`) still has no progress
  reporting — only the two batch/series flows do (see Progress indicator
  above). Worth adding the same pattern there if long stream downloads
  turn out to need it too.

## Roadmap position

Milestones 1–4 are done, M5 is in progress (folder structure ✅, blob-URL
guard ✅, HLS crash + error notifications ✅, manual playlist picker ✅,
click-driven ("single-page", no per-lesson URL) playlist support ✅,
progress indicator for both batch flows ✅, per-video overlay download
buttons ✅, options page ✅, download history ✅ — see root `CLAUDE.md` for
the full round-by-round history). Still open for M5: better error
handling for blocked/CORS edge cases. M6 (MSE/blob-based platforms —
YouTube, X/Twitter, LinkedIn) is confirmed non-negotiable long-term but
deliberately deferred until M5 is solid.
