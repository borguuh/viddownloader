import type { DetectedVideo } from "../shared/types";
import { buildDownloadPath, suggestFilenameFromUrl } from "../shared/download-paths";

export interface DownloadableSource {
  url: string;
  filename: string;
}

/** Main src plus any <source> children, deduplicated, each given a best-effort filename. */
export function getDownloadableSources(video: DetectedVideo): DownloadableSource[] {
  const urls = [video.src, ...video.sources].filter(Boolean);
  const unique = Array.from(new Set(urls));

  return unique.map((url, index) => ({
    url,
    filename: suggestFilenameFromUrl(url, `${video.id}-${index}.mp4`),
  }));
}

export function startDownload(source: DownloadableSource): void {
  chrome.downloads.download({ url: source.url, filename: buildDownloadPath(source.filename) });
}
