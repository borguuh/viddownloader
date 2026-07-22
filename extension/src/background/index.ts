import type {
  DetectedVideo,
  EnqueueDownloadsRequest,
  GetPlaylistRequest,
  GetPlaylistResponse,
  GetVideosRequest,
  GetVideosResponse,
  PlaylistDetectedMessage,
  PlaylistItem,
  VideosDetectedMessage,
} from "../shared/types";

const videosByTab = new Map<number, DetectedVideo[]>();
const playlistByTab = new Map<number, PlaylistItem[]>();

chrome.tabs.onRemoved.addListener((tabId) => {
  videosByTab.delete(tabId);
  playlistByTab.delete(tabId);
});

// --- Batch download queue ---------------------------------------------
// For playlist items: open each URL in a background tab, wait for the
// content script to report a video with a usable src, download it, close
// the tab, move on. Fully sequential to avoid hammering the target site.

const TAB_LOAD_TIMEOUT_MS = 20_000;

const queue: PlaylistItem[] = [];
const queueTabIds = new Set<number>();
const downloadedForTab = new Set<number>();
const tabTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
let processing = false;

function enqueue(items: PlaylistItem[]) {
  queue.push(...items);
  if (!processing) processNext();
}

function processNext() {
  const item = queue.shift();
  if (!item) {
    processing = false;
    return;
  }
  processing = true;

  chrome.tabs.create({ url: item.url, active: false }, (tab) => {
    if (!tab?.id) {
      processNext();
      return;
    }
    const tabId = tab.id;
    queueTabIds.add(tabId);
    tabTimeouts.set(
      tabId,
      setTimeout(() => finishTab(tabId), TAB_LOAD_TIMEOUT_MS),
    );
  });
}

function finishTab(tabId: number) {
  const timeout = tabTimeouts.get(tabId);
  if (timeout) clearTimeout(timeout);
  tabTimeouts.delete(tabId);
  queueTabIds.delete(tabId);
  downloadedForTab.delete(tabId);
  videosByTab.delete(tabId);
  playlistByTab.delete(tabId);
  chrome.tabs.remove(tabId).catch(() => {});
  processNext();
}

function tryDownloadFromQueueTab(tabId: number, videos: DetectedVideo[]) {
  if (downloadedForTab.has(tabId)) return;
  const video = videos.find((v) => v.src);
  if (!video) return;

  downloadedForTab.add(tabId);
  chrome.downloads.download({ url: video.src }, () => finishTab(tabId));
}

// --- Messaging -----------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message?.type === "videos-detected" && tabId !== undefined) {
    const { videos } = message as VideosDetectedMessage;
    videosByTab.set(tabId, videos);
    if (queueTabIds.has(tabId)) tryDownloadFromQueueTab(tabId, videos);
    return;
  }

  if (message?.type === "playlist-detected" && tabId !== undefined) {
    const { items } = message as PlaylistDetectedMessage;
    playlistByTab.set(tabId, items);
    return;
  }

  if (message?.type === "get-videos") {
    const { tabId: queryTabId } = message as GetVideosRequest;
    const response: GetVideosResponse = { videos: videosByTab.get(queryTabId) ?? [] };
    sendResponse(response);
    return true;
  }

  if (message?.type === "get-playlist") {
    const { tabId: queryTabId } = message as GetPlaylistRequest;
    const response: GetPlaylistResponse = { items: playlistByTab.get(queryTabId) ?? [] };
    sendResponse(response);
    return true;
  }

  if (message?.type === "enqueue-downloads") {
    const { items } = message as EnqueueDownloadsRequest;
    enqueue(items);
    return;
  }
});
