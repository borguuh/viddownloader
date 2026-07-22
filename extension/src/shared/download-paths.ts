/** Every download from this extension lands under this subfolder of the default Downloads folder. */
export const BASE_FOLDER = "Downloader";

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

/** Builds the chrome.downloads filename: Downloader/<file> or Downloader/<series>/<file>. */
export function buildDownloadPath(filename: string, seriesFolder?: string): string {
  const parts = [BASE_FOLDER];
  if (seriesFolder) parts.push(sanitizeFolderName(seriesFolder));
  parts.push(filename);
  return parts.join("/");
}
