# Video Downloader — Root

Personal, single-user toolset for downloading videos playing on screen, across
browser and (eventually) mobile. No backend — everything runs locally on-device.
JS/TS throughout.

## Repo layout

- `extension/` — Chrome extension (Manifest V3). **Standalone**: own
  `package.json`, own `node_modules`/`dist`. Always `cd extension` before
  running its tooling — dependencies are not hoisted to the root.
- `mobile-android/` — reserved for a future milestone (see roadmap).
- `mobile-ios/` — reserved for a future milestone (see roadmap).

There is no shared package between extension and mobile — the platforms don't
have enough in common (browser DOM/extension APIs vs. native app APIs) to
justify one. Android and iOS may end up sharing code with each other later
(e.g. via React Native), decided when that work starts.

## Principles

- No telemetry, no analytics, no backend service. Everything stays local.
- Prefer platform-local storage (`chrome.storage` in the extension) over any
  network calls.
- Single-user tooling — skip auth, multi-tenancy, or anything built for
  serving other people.
- Don't over-build ahead of the milestone actually in progress.

## Roadmap

1. **M1 — Extension skeleton** *(done)*: MV3 scaffold; content script detects
   `<video>` elements on a page and reports them to the popup.
2. **M2 — Direct-file download**: popup lists detected videos, user picks
   one, download via `chrome.downloads.download()`; handle multiple
   `<source>` resolution variants where present.
3. **M3 — Series/batch detection**: heuristics to find "related videos" in a
   playlist/course-site layout (siblings of the current player sharing a DOM
   pattern), multi-select UI, queued sequential downloads.
4. **M4 — Adaptive streaming (HLS/DASH)**: intercept `.m3u8`/`.mpd` requests
   via `chrome.webRequest`, parse manifest for resolution variants, fetch +
   concat segments (likely `ffmpeg.wasm` for muxing) since no single
   downloadable file exists for these.
5. **M5 — Polish + real-world bug fixes** *(in progress)*: fixes found from
   testing M1–M4 against an actual course site:
   - All downloads from this extension land under a single `Downloader/`
     subfolder of the default Downloads folder (never loose in the
     Downloads root). Single videos: `Downloader/<filename>`. Series
     batches: `Downloader/<series folder name>/<filename>`, where the
     series folder name is entered by the user when hitting "Download
     selected" (defaults to the page title). `chrome.downloads.download()`
     only accepts a `filename` relative to the default Downloads folder —
     no native OS folder-picker dialog — so this is implemented as a path
     prefix, not an actual directory chooser.
   - Content script required a manual page reload to start detecting video
     after the extension loaded/reloaded (normal Chrome behavior: content
     scripts only auto-inject into tabs navigated *after* the extension is
     loaded). Fixed by having the popup inject the content script on-demand
     via `chrome.scripting.executeScript` when it doesn't find it already
     running, instead of relying solely on the manifest's automatic
     injection.
   - Playlist/series detection was over-triggering: the heuristic scanned
     the *entire page* for the largest bucket of same-parent links, which
     often caught sitewide nav/header/footer menus instead of the actual
     lesson list, and offered non-video links as if they were downloadable.
     Fixed by scoping the search to the nearest ancestor of the detected
     `<video>` element that contains enough links, and excluding
     `<nav>`/`<header>`/`<footer>` regions.
   - Options page, download history, and further error handling for
     blocked/CORS edge cases are still open for this milestone.
6. **M6 — YouTube support**: explicitly out of scope for M1–M5. YouTube
   doesn't serve a plain downloadable file or a standard `.m3u8`/`.mpd`
   manifest for regular (non-live) video — it delivers separate video/audio
   streams via its own internal player API (`googlevideo.com` URLs, often
   behind signature/cipher logic embedded in page JS). Supporting it
   properly means: extracting stream info from the page's player response,
   handling signature deciphering, downloading video+audio separately, and
   muxing them (needs bundling `ffmpeg.wasm`, a real dependency addition).
   It's also brittle — YouTube changes this periodically, so it can break
   and need maintenance. Treated as its own milestone, scoped in detail when
   we get to it, deliberately after M5 is solid. Livestream HLS may
   partially work already via the M4 HLS path — worth checking once M6
   starts, before building bespoke extraction.
7. **M7+ — Mobile**: Android app (Kotlin or React Native — decide when this
   starts), iOS afterward.

## Working agreement

- Commit at the end of each milestone (or a meaningful sub-step within one),
  not more granularly than that.
- DRM-protected platforms (Netflix, YouTube Premium, etc.) are explicitly out
  of scope — not something this tool attempts to defeat.
