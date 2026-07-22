import type {
  DetectedVideo,
  DownloadStreamRequest,
  EnqueueDownloadsRequest,
  GetPlaylistRequest,
  GetPlaylistResponse,
  GetStreamsRequest,
  GetStreamsResponse,
  GetVideosRequest,
  GetVideosResponse,
  PlaylistDetectedMessage,
  PlaylistItem,
  StreamManifest,
  VideosDetectedMessage,
} from "../shared/types";
import { buildManifest, detectKindFromUrl, parseHlsSegments } from "./streams";
import { buildDownloadPath, suggestFilenameFromUrl } from "../shared/download-paths";

const videosByTab = new Map<number, DetectedVideo[]>();
const playlistByTab = new Map<number, PlaylistItem[]>();
const streamsByTab = new Map<number, Map<string, StreamManifest>>();

chrome.tabs.onRemoved.addListener((tabId) => {
  videosByTab.delete(tabId);
  playlistByTab.delete(tabId);
  streamsByTab.delete(tabId);
});

// --- Adaptive stream (HLS/DASH) manifest detection ------------------------
// Watch network requests for .m3u8/.mpd manifests, fetch + parse each one
// (once per tab+URL) into resolution variants for the popup to display.

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!detectKindFromUrl(details.url)) return;

    const tabId = details.tabId;
    const seen = streamsByTab.get(tabId) ?? new Map<string, StreamManifest>();
    streamsByTab.set(tabId, seen);
    if (seen.has(details.url)) return;

    buildManifest(details.url)
      .then((manifest) => {
        if (manifest) seen.set(details.url, manifest);
      })
      .catch(() => {
        // Manifest fetch/parse failed (CORS, transient network error, etc.) — skip it.
      });
  },
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] },
);

// --- Batch download queue ---------------------------------------------
// For playlist items: open each URL in a background tab, wait for the
// content script to report a video with a usable src, download it, close
// the tab, move on. Fully sequential to avoid hammering the target site.

const TAB_LOAD_TIMEOUT_MS = 20_000;

interface QueueEntry {
  item: PlaylistItem;
  folderName: string;
}

const queue: QueueEntry[] = [];
const queueTabIds = new Set<number>();
const downloadedForTab = new Set<number>();
const folderNameForTab = new Map<number, string>();
const tabTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
let processing = false;

function enqueue(items: PlaylistItem[], folderName: string) {
  queue.push(...items.map((item) => ({ item, folderName })));
  if (!processing) processNext();
}

function processNext() {
  const entry = queue.shift();
  if (!entry) {
    processing = false;
    return;
  }
  processing = true;

  chrome.tabs.create({ url: entry.item.url, active: false }, (tab) => {
    if (!tab?.id) {
      processNext();
      return;
    }
    const tabId = tab.id;
    queueTabIds.add(tabId);
    folderNameForTab.set(tabId, entry.folderName);
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
  folderNameForTab.delete(tabId);
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
  const folderName = folderNameForTab.get(tabId);
  const filename = suggestFilenameFromUrl(video.src, `${tabId}.mp4`);
  chrome.downloads.download({ url: video.src, filename: buildDownloadPath(filename, folderName) }, () =>
    finishTab(tabId),
  );
}

// --- HLS variant download --------------------------------------------------
// No single downloadable file exists for adaptive streams. For HLS we fetch
// the chosen variant's media playlist, pull every segment (sequentially, to
// keep memory/network sane), and concatenate them into one blob — valid for
// MPEG-TS segments, and works for most fMP4/CMAF segments too since they
// share a common init segment structure. Encrypted (#EXT-X-KEY) streams will
// download but likely won't play; that's a known limitation, not handled yet.

async function downloadHlsVariant(variantUrl: string) {
  const playlistResponse = await fetch(variantUrl);
  const playlistText = await playlistResponse.text();
  const segmentUrls = parseHlsSegments(playlistText, variantUrl);
  if (segmentUrls.length === 0) return;

  const chunks: BlobPart[] = [];
  for (const segmentUrl of segmentUrls) {
    const segmentResponse = await fetch(segmentUrl);
    chunks.push(await segmentResponse.blob());
  }

  const blob = new Blob(chunks, { type: "video/mp2t" });
  const objectUrl = URL.createObjectURL(blob);

  chrome.downloads.download({ url: objectUrl, filename: buildDownloadPath("video.ts") }, () => {
    // Revoke once the download has had time to read the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  });
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
    const { items, folderName } = message as EnqueueDownloadsRequest;
    enqueue(items, folderName);
    return;
  }

  if (message?.type === "get-streams") {
    const { tabId: queryTabId } = message as GetStreamsRequest;
    const manifests = Array.from(streamsByTab.get(queryTabId)?.values() ?? []);
    const response: GetStreamsResponse = { manifests };
    sendResponse(response);
    return true;
  }

  if (message?.type === "download-stream") {
    const { variant, kind } = message as DownloadStreamRequest;
    if (kind === "hls") downloadHlsVariant(variant.url);
    return;
  }
});
