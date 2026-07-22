import type {
  DetectedVideo,
  PlaylistDetectedMessage,
  PlaylistItem,
  VideosDetectedMessage,
} from "../shared/types";

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
 * Heuristic playlist detection: group same-origin links by their parent's
 * tag+class "signature", then pick the largest group with enough distinct,
 * non-trivial entries to plausibly be a lesson/episode list. Site-specific
 * and imperfect by nature — good enough for typical course-site sidebars.
 */
function collectPlaylistLinks(): PlaylistItem[] {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const buckets = new Map<string, HTMLAnchorElement[]>();

  for (const anchor of anchors) {
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

function reportVideos() {
  const videos = collectVideos();
  const message: VideosDetectedMessage = { type: "videos-detected", videos };
  chrome.runtime.sendMessage(message);
}

function reportPlaylist() {
  const items = collectPlaylistLinks();
  if (items.length === 0) return;
  const message: PlaylistDetectedMessage = { type: "playlist-detected", items };
  chrome.runtime.sendMessage(message);
}

reportVideos();
reportPlaylist();

let debounceHandle: number | undefined;
const observer = new MutationObserver(() => {
  window.clearTimeout(debounceHandle);
  debounceHandle = window.setTimeout(() => {
    reportVideos();
    reportPlaylist();
  }, 300);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("loadedmetadata", reportVideos, true);
