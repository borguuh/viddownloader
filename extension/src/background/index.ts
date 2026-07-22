import type {
  DetectedVideo,
  DownloadStreamRequest,
  DownloadVideoRequest,
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

// --- Centralized download path enforcement ---------------------------------
// Passing `filename` directly to chrome.downloads.download() is ignored if
// ANY installed extension (not just this one) has registered an
// onDeterminingFilename listener — a download manager, ad blocker, etc. can
// silently override it. Registering our own listener and calling suggest()
// is the API's actual mechanism for reliably controlling the save path, so
// every download this extension makes goes through downloadWithPath() below
// instead of calling chrome.downloads.download({ filename }) directly.

const pendingFilenames = new Map<string, string>();

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const desired = pendingFilenames.get(item.url);
  if (desired) {
    pendingFilenames.delete(item.url);
    suggest({ filename: desired, conflictAction: "uniquify" });
  } else {
    suggest();
  }
});

function downloadWithPath(url: string, filename: string, callback?: (id?: number) => void) {
  pendingFilenames.set(url, filename);
  chrome.downloads.download({ url, filename }, (id) => {
    // If the download failed outright, onDeterminingFilename never fires for
    // it — clean up so we don't leak the entry.
    if (id === undefined) pendingFilenames.delete(url);
    callback?.(id);
  });
}

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
  downloadWithPath(video.src, buildDownloadPath(filename, folderName), () => finishTab(tabId));
}

// --- HLS variant download --------------------------------------------------
// No single downloadable file exists for adaptive streams. For HLS we fetch
// the chosen variant's media playlist, pull every segment (sequentially, to
// keep memory/network sane), and concatenate them into one blob — valid for
// MPEG-TS segments, and works for most fMP4/CMAF segments too since they
// share a common init segment structure. Encrypted (#EXT-X-KEY) streams will
// download but likely won't play; that's a known limitation, not handled yet.

async function downloadHlsVariant(variantUrl: string) {
  try {
    const playlistResponse = await fetch(variantUrl);
    if (!playlistResponse.ok) throw new Error(`Playlist fetch failed: HTTP ${playlistResponse.status}`);
    const playlistText = await playlistResponse.text();
    const segmentUrls = parseHlsSegments(playlistText, variantUrl);
    if (segmentUrls.length === 0) throw new Error("Playlist had no segments");

    const chunks: BlobPart[] = [];
    for (const segmentUrl of segmentUrls) {
      const segmentResponse = await fetch(segmentUrl);
      if (!segmentResponse.ok) throw new Error(`Segment fetch failed: HTTP ${segmentResponse.status}`);
      chunks.push(await segmentResponse.blob());
    }

    const blob = new Blob(chunks, { type: "video/mp2t" });
    const objectUrl = URL.createObjectURL(blob);

    downloadWithPath(objectUrl, buildDownloadPath("video.ts"), () => {
      // Revoke once the download has had time to read the blob.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    });
  } catch (error) {
    notifyFailure("Stream download failed", error);
  }
}

function notifyFailure(title: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  chrome.notifications.create({
    type: "basic",
    iconUrl: "public/icons/icon128.png",
    title,
    message,
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

  if (message?.type === "download-video") {
    const { url, filename } = message as DownloadVideoRequest;
    downloadWithPath(url, filename);
    return;
  }
});
