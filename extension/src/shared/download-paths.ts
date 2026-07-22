/** Default base subfolder (under the default Downloads folder) for every download from this extension. */
export const DEFAULT_BASE_FOLDER = "Downloader";

export function suggestFilenameFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.substring(pathname.lastIndexOf("/") + 1);
    if (base) return decodeURIComponent(base);
  } catch {
    // fall through to fallback
  }
  return fallback;
}

export function sanitizeFolderName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, " ").trim().replace(/\s+/g, " ");
  return cleaned || "series";
}

/**
 * Builds the chrome.downloads filename: <baseFolder>/<file> or
 * <baseFolder>/<series>/<file>. Only called from the background worker
 * (which owns the configurable base folder setting) — other contexts send
 * raw filenames via messages and let the background worker apply this.
 */
export function buildDownloadPath(filename: string, baseFolder: string, seriesFolder?: string): string {
  const parts = [baseFolder];
  if (seriesFolder) parts.push(sanitizeFolderName(seriesFolder));
  parts.push(filename);
  return parts.join("/");
}
