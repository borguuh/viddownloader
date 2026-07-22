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
5. **M5 — Polish**: options page, download history, error handling for
   blocked/CORS cases and other edge-case sites.
6. **M6+ — Mobile**: Android app (Kotlin or React Native — decide when this
   starts), iOS afterward.

## Working agreement

- Commit at the end of each milestone (or a meaningful sub-step within one),
  not more granularly than that.
- DRM-protected platforms (Netflix, YouTube Premium, etc.) are explicitly out
  of scope — not something this tool attempts to defeat.
