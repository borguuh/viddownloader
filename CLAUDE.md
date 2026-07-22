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

   **Round 2 findings (real testing against course site, Twitter, LinkedIn):**
   - `Downloader/` subfolder still not applying per user report — code
     inspection shows `buildDownloadPath()` is wired correctly everywhere;
     first suspect is a stale unpacked-extension reload (MV3 service workers
     can keep running old code until the extension is explicitly reloaded
     in `chrome://extensions`, not just rebuilt). Needs a rebuild + hard
     reload + retest before treating this as a real bug.
   - Playlist detection still fails on the actual course site even after
     the M5 scoping fix — the lesson list apparently isn't a DOM ancestor
     of the `<video>` element on this site, so `findScopedContainer()`'s
     "walk up from the video" approach never reaches it. A blind DOM
     heuristic keeps being a dead end for this specific, real use case.
     **Planned fix — manual playlist picker**: add a "Pick playlist area"
     mode where the user clicks the actual sidebar/list container on the
     page (element-picker UX, like an ad-blocker's element chooser); the
     extension stores that container's selector per-origin in
     `chrome.storage.local` and prefers it over the blind heuristic on
     future visits to that site. Directly addresses the user's own framing
     of this ("a way to select the video such that it recognizes the next
     videos in a playlist").
   - Twitter: HLS variants are detected correctly (multiple resolutions
     listed), but clicking Download does nothing — no error, no download.
     `downloadHlsVariant()` is fired-and-forgotten from the message handler
     with no `try/catch` and no error surfaced to the popup, so any fetch
     failure (e.g. Twitter's CDN rejecting segment requests without the
     original page's `Referer`/`Origin`, which `fetch()` can't spoof — the
     `Referer` header can't be set manually via `fetch()`, only via
     `chrome.declarativeNetRequest` header-rewrite rules) fails completely
     silently. **Planned fix**: wrap the download flow in `try/catch` and
     surface failures via `chrome.notifications`, so at minimum the user
     sees *that* and roughly *why* it failed instead of nothing happening.
     Actually fixing CDN hotlink/referrer rejection (if that's the cause)
     is a separate, bigger follow-up via `declarativeNetRequest`.
   - LinkedIn: clicking Download on a detected "video" produces a
     `Failed - Network error` entry pointing at a `blob:` URL. Root cause:
     LinkedIn (like YouTube) feeds video through Media Source Extensions,
     so `video.currentSrc` is a `blob:` URL scoped to the page's own
     browsing context — it was never a real fetchable file, and
     `chrome.downloads.download()` can't resolve it from the extension.
     M2's direct-download path doesn't currently distinguish "real URL" vs
     "MSE blob URL" and just offers a Download button either way.
     **Planned fix**: detect `blob:` sources in `getDownloadableSources()`
     and don't offer a (guaranteed-to-fail) download button for them; show
     a short explanation instead ("this video streams in-page and can't be
     downloaded directly — check Adaptive stream below" if a matching HLS/
     DASH manifest was also detected, since some MSE sites are backed by a
     real HLS/DASH stream `M4` can already catch).
   - New feature request: when a page has multiple videos, add a small
     "Download this video" button overlaid directly on/near each `<video>`
     element on the page itself (IDM-style), not just a list in the popup —
     makes it unambiguous which one you're grabbing. Content script would
     position a floating button per detected `<video>`, wired to the same
     M2 download logic for that specific element's source. **Still open.**

   **Round 3 (status update after another real testing pass):**
   - ✅ **Folder bug — actually fixed, root cause found.** It wasn't a stale
     build. `chrome.downloads.download()`'s `filename` argument is silently
     ignored if *any* installed extension (not just this one) has
     registered a `chrome.downloads.onDeterminingFilename` listener —
     something else installed was almost certainly doing that. Fixed by
     registering our own listener in the background worker and enforcing
     the path there instead of trusting the initial argument (see extension
     `CLAUDE.md`, `downloadWithPath()`).
   - ✅ **LinkedIn blob: false positive — fixed** (the planned fix from round
     2, now shipped): blob: sources no longer offer a doomed Download
     button, with an explanation shown instead.
   - ✅ **Twitter HLS download did nothing — fixed the silent-failure part**,
     but uncovered a second, more fundamental bug in the process:
     `URL.createObjectURL()` doesn't exist in the MV3 service worker at all
     (no DOM there) — every HLS download was throwing immediately. Fixed
     with a hidden **offscreen document** (`chrome.offscreen`, new
     `offscreen` permission) that does the actual blob/object-URL creation,
     with the background worker relaying segment data to it as base64
     (messaging is JSON-only). Failures now also surface via
     `chrome.notifications` instead of vanishing.
   - ⏳ **Playlist detection — still the open item.** Confirmed unreliable on
     arbitrary sites too, not just the course site: on Twitter/X it picked
     up a "who to follow" sidebar (account names) as if it were a playlist.
     This is expected of a blind DOM heuristic and reinforces that the
     **manual playlist picker** (planned in round 2, not yet built) is the
     real fix, especially since the user's actual target site's lesson list
     isn't even a DOM ancestor of the `<video>` element, which is what the
     current heuristic depends on.
   - Also hardened: the content script now stops trying (and stops spamming
     the page's console with "Extension context invalidated") once its
     extension context is orphaned by a reload, instead of throwing
     uncaught on every DOM-mutation tick.
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
