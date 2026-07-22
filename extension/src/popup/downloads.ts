import type { DetectedVideo } from "../shared/types";

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
    filename: suggestFilename(url, video.id, index),
  }));
}

function suggestFilename(url: string, videoId: string, index: number): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.substring(pathname.lastIndexOf("/") + 1);
    if (base) return decodeURIComponent(base);
  } catch {
    // fall through to generated name
  }
  return `${videoId}-${index}.mp4`;
}

export function startDownload(source: DownloadableSource): void {
  chrome.downloads.download({ url: source.url, filename: source.filename });
}
