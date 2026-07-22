import type { DetectedVideo, DownloadVideoRequest } from "../shared/types";
import { suggestFilenameFromUrl } from "../shared/download-paths";

export interface DownloadableSource {
  url: string;
  filename: string;
}

/**
 * Main src plus any <source> children, deduplicated, each given a
 * best-effort filename. Excludes blob: URLs — those are Media Source
 * Extensions handles scoped to the page's own browsing context (common on
 * YouTube, LinkedIn, etc.), not real fetchable files. chrome.downloads
 * can't resolve them from the extension side, so offering a Download
 * button for one would just fail with a network error.
 */
export function getDownloadableSources(video: DetectedVideo): DownloadableSource[] {
  const urls = [video.src, ...video.sources].filter((url) => url && !url.startsWith("blob:"));
  const unique = Array.from(new Set(urls));

  return unique.map((url, index) => ({
    url,
    filename: suggestFilenameFromUrl(url, `${video.id}-${index}.mp4`),
  }));
}

export function isBlobOnly(video: DetectedVideo): boolean {
  const urls = [video.src, ...video.sources].filter(Boolean);
  return urls.length > 0 && urls.every((url) => url.startsWith("blob:"));
}

export function startDownload(source: DownloadableSource): void {
  // Routed through the background worker (rather than calling
  // chrome.downloads.download directly here) so the single
  // onDeterminingFilename listener registered there — the reliable way to
  // enforce the configured base folder even if another installed extension
  // also hooks that event — applies to every download this extension makes.
  // filename here is raw; the background worker applies the base folder.
  const request: DownloadVideoRequest = {
    type: "download-video",
    url: source.url,
    filename: source.filename,
  };
  chrome.runtime.sendMessage(request);
}
