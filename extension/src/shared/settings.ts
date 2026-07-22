// chrome.storage.local keys shared across contexts. Settings are read/written
// directly via chrome.storage (available in every extension context —
// background, popup, options, content scripts) rather than via messages.

export const BASE_FOLDER_NAME_KEY = "baseFolderName";
export const OVERLAY_BUTTONS_ENABLED_KEY = "overlayButtonsEnabled";
export const DOWNLOAD_HISTORY_KEY = "downloadHistory";
export const PLAYLIST_SELECTOR_PREFIX = "playlistSelector:";

export const MAX_HISTORY_ENTRIES = 200;

export interface HistoryEntry {
  filename: string;
  url: string;
  timestamp: number;
}
