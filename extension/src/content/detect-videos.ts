import type {
  ClearPlaylistSelectorRequest,
  DetectedVideo,
  PlaylistDetectedMessage,
  PlaylistItem,
  StartPickingRequest,
  VideosDetectedMessage,
} from "../shared/types";

declare global {
  interface Window {
    __videoDownloaderInjected?: boolean;
  }
}

// Guards against duplicate MutationObservers/listeners when the popup
// injects this script on-demand into a tab where it's already running
// (see ensureContentScriptInjected in the popup) rather than relying only
// on the manifest's automatic injection into newly-navigated tabs.
if (!window.__videoDownloaderInjected) {
  window.__videoDownloaderInjected = true;

  const isChromeUi = (el: Element) => el.closest("nav, header, footer") !== null;
  const storageKey = `playlistSelector:${location.origin}`;

  function collectVideos(): DetectedVideo[] {
    const videos = Array.from(document.querySelectorAll("video"));

    return videos.map((video, index) => {
      const sources = Array.from(video.querySelectorAll("source"))
        .map((s) => s.src)
        .filter(Boolean);

      return {
        id: `video-${index}`,
        src: video.currentSrc || video.src,
        width: video.videoWidth,
        height: video.videoHeight,
        sources,
      };
    });
  }

  /**
   * Finds the nearest ancestor of the primary <video> element that contains
   * at least a few links — narrows the playlist search to "the area around
   * the player" instead of the whole page, so it doesn't pick up sitewide
   * nav/header/footer menus. Falls back to <body> if there's no video yet.
   */
  function findScopedContainer(): Element {
    const video = document.querySelector("video");
    if (!video) return document.body;

    let el: Element | null = video.parentElement;
    while (el && el !== document.body) {
      if (!isChromeUi(el) && el.querySelectorAll("a[href]").length >= 3) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  function extractLinksFromContainer(container: Element): PlaylistItem[] {
    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const seen = new Set<string>();
    const items: PlaylistItem[] = [];

    for (const anchor of anchors) {
      const text = anchor.textContent?.trim() ?? "";
      if (!text || text.length > 200) continue;

      let href: URL;
      try {
        href = new URL(anchor.href, document.baseURI);
      } catch {
        continue;
      }
      if (href.origin !== location.origin) continue;
      if (seen.has(anchor.href)) continue;

      seen.add(anchor.href);
      items.push({ title: text, url: anchor.href });
    }

    return items;
  }

  /**
   * Heuristic playlist detection, scoped to findScopedContainer(): group
   * same-origin links (excluding nav/header/footer) by their parent's
   * tag+class "signature", then pick the largest group with enough
   * distinct, non-trivial entries to plausibly be a lesson/episode list.
   * Site-specific and imperfect by nature — good enough for typical
   * course-site sidebars, but not guaranteed on arbitrary layouts. This is
   * only the fallback: see storedSelector below for the reliable path.
   */
  function collectPlaylistLinksHeuristic(): PlaylistItem[] {
    const scope = findScopedContainer();
    const anchors = Array.from(scope.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const buckets = new Map<string, HTMLAnchorElement[]>();

    for (const anchor of anchors) {
      if (isChromeUi(anchor)) continue;

      const text = anchor.textContent?.trim() ?? "";
      if (!text || text.length > 200) continue;
      if (!anchor.parentElement) continue;

      let href: URL;
      try {
        href = new URL(anchor.href, document.baseURI);
      } catch {
        continue;
      }
      if (href.origin !== location.origin) continue;

      const parent = anchor.parentElement;
      const signature = `${parent.tagName}.${parent.className}`;
      const bucket = buckets.get(signature) ?? [];
      bucket.push(anchor);
      buckets.set(signature, bucket);
    }

    let best: HTMLAnchorElement[] = [];
    for (const bucket of buckets.values()) {
      if (bucket.length > best.length) best = bucket;
    }

    if (best.length < 3) return [];

    const seen = new Set<string>();
    const items: PlaylistItem[] = [];
    for (const anchor of best) {
      const url = anchor.href;
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ title: anchor.textContent!.trim(), url });
    }

    return items;
  }

  // The blind heuristic above can't reliably find every site's playlist
  // (e.g. when the lesson list isn't a DOM ancestor of the <video>, or when
  // it picks up an unrelated link cluster like a "who to follow" sidebar).
  // storedSelector is a manually-picked override (see startPicking below),
  // persisted per-origin, that takes precedence when present.
  let storedSelector: string | null = null;

  chrome.storage.local.get(storageKey).then((result) => {
    storedSelector = result[storageKey] ?? null;
    if (storedSelector) reportPlaylist();
  });

  function collectPlaylistLinks(): PlaylistItem[] {
    if (storedSelector) {
      const container = document.querySelector(storedSelector);
      if (container) return extractLinksFromContainer(container);
    }
    return collectPlaylistLinksHeuristic();
  }

  // --- Manual playlist picker ---------------------------------------------
  // Triggered from the popup ("Pick playlist area"). Highlights whatever
  // element is under the cursor; clicking one records a CSS selector for it
  // (preferring an id, else a short, verified-unique tag+class path) and
  // stores it per-origin so future visits use it directly instead of
  // guessing.

  let pickerActive = false;
  let hoveredEl: HTMLElement | null = null;

  function buildSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== document.body && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (typeof current.className === "string" && current.className.trim()) {
        const classes = current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (classes.length) part += "." + classes.map((c) => CSS.escape(c)).join(".");
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      if (document.querySelectorAll(selector).length === 1) return selector;
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function onPickerMouseOver(e: MouseEvent) {
    if (hoveredEl) hoveredEl.style.outline = "";
    hoveredEl = e.target as HTMLElement;
    hoveredEl.style.outline = "2px solid #2684ff";
  }

  function onPickerClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as Element;
    const selector = buildSelector(target);
    storedSelector = selector;
    chrome.storage.local.set({ [storageKey]: selector });
    stopPicking();
    reportPlaylist();
  }

  function startPicking() {
    if (pickerActive) return;
    pickerActive = true;
    document.addEventListener("mouseover", onPickerMouseOver, true);
    document.addEventListener("click", onPickerClick, true);
    document.body.style.cursor = "crosshair";
  }

  function stopPicking() {
    pickerActive = false;
    document.removeEventListener("mouseover", onPickerMouseOver, true);
    document.removeEventListener("click", onPickerClick, true);
    document.body.style.cursor = "";
    if (hoveredEl) {
      hoveredEl.style.outline = "";
      hoveredEl = null;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if ((message as StartPickingRequest)?.type === "start-picking") {
      startPicking();
      return;
    }
    if ((message as ClearPlaylistSelectorRequest)?.type === "clear-playlist-selector") {
      storedSelector = null;
      chrome.storage.local.remove(storageKey);
      reportPlaylist();
      return;
    }
  });

  let observer: MutationObserver | undefined;

  // Reloading the extension invalidates any content script instance still
  // running in already-open tabs — chrome.runtime.sendMessage then throws
  // "Extension context invalidated" on every call. That instance is dead
  // and can't be revived short of reloading the page, so once it happens,
  // stop trying (avoids repeat console spam every debounce tick) instead of
  // leaving it as an uncaught error.
  function sendIfContextValid(message: VideosDetectedMessage | PlaylistDetectedMessage) {
    if (!chrome.runtime?.id) {
      observer?.disconnect();
      return;
    }
    try {
      chrome.runtime.sendMessage(message);
    } catch {
      observer?.disconnect();
    }
  }

  const reportVideos = () => {
    const videos = collectVideos();
    sendIfContextValid({ type: "videos-detected", videos });
  };

  const reportPlaylist = () => {
    const items = collectPlaylistLinks();
    if (items.length === 0) return;
    sendIfContextValid({ type: "playlist-detected", items });
  };

  reportVideos();
  reportPlaylist();

  let debounceHandle: number | undefined;
  observer = new MutationObserver(() => {
    window.clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(() => {
      reportVideos();
      reportPlaylist();
    }, 300);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("loadedmetadata", reportVideos, true);
}
