import type {
  ClickSeriesProgressMessage,
  DetectedVideo,
  DownloadProgress,
  DownloadStreamRequest,
  DownloadVideoRequest,
  EnqueueDownloadsRequest,
  GetPlaylistRequest,
  GetPlaylistResponse,
  GetProgressRequest,
  GetProgressResponse,
  GetStreamsRequest,
  GetStreamsResponse,
  GetVideosRequest,
  GetVideosResponse,
  OffscreenCreateBlobRequest,
  OffscreenCreateBlobResponse,
  OffscreenRevokeRequest,
  PlaylistDetectedMessage,
  PlaylistItem,
  StreamManifest,
  VideosDetectedMessage,
} from "../shared/types";
import { buildManifest, detectKindFromUrl, parseHlsSegments } from "./streams";
import { buildDownloadPath, DEFAULT_BASE_FOLDER, suggestFilenameFromUrl } from "../shared/download-paths";
import { blobToBase64 } from "../shared/base64";
import { BASE_FOLDER_NAME_KEY, DOWNLOAD_HISTORY_KEY, MAX_HISTORY_ENTRIES } from "../shared/settings";
import type { HistoryEntry } from "../shared/settings";

const videosByTab = new Map<number, DetectedVideo[]>();
const playlistByTab = new Map<number, GetPlaylistResponse>();
const streamsByTab = new Map<number, Map<string, StreamManifest>>();
const clickSeriesProgressByTab = new Map<number, DownloadProgress>();

chrome.tabs.onRemoved.addListener((tabId) => {
  videosByTab.delete(tabId);
  playlistByTab.delete(tabId);
  streamsByTab.delete(tabId);
  clickSeriesProgressByTab.delete(tabId);
});

// Configurable via the options page; defaults to DEFAULT_BASE_FOLDER until
// (and unless) the user changes it there.
let baseFolderName = DEFAULT_BASE_FOLDER;
chrome.storage.local.get(BASE_FOLDER_NAME_KEY).then((result) => {
  if (result[BASE_FOLDER_NAME_KEY]) baseFolderName = result[BASE_FOLDER_NAME_KEY];
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[BASE_FOLDER_NAME_KEY]) {
    baseFolderName = changes[BASE_FOLDER_NAME_KEY].newValue || DEFAULT_BASE_FOLDER;
  }
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

// Tracks download ids this extension initiated, so chrome.downloads.onChanged
// (which fires for every download in the browser, not just ours) knows which
// ones to record into history.
const ourDownloadIds = new Set<number>();

function downloadWithPath(url: string, filename: string, callback?: (id?: number) => void) {
  pendingFilenames.set(url, filename);
  chrome.downloads.download({ url, filename }, (id) => {
    // If the download failed outright, onDeterminingFilename never fires for
    // it — clean up so we don't leak the entry.
    if (id === undefined) {
      pendingFilenames.delete(url);
    } else {
      ourDownloadIds.add(id);
    }
    callback?.(id);
  });
}

async function recordHistory(entry: HistoryEntry) {
  const result = await chrome.storage.local.get(DOWNLOAD_HISTORY_KEY);
  const history: HistoryEntry[] = result[DOWNLOAD_HISTORY_KEY] ?? [];
  history.unshift(entry);
  history.length = Math.min(history.length, MAX_HISTORY_ENTRIES);
  chrome.storage.local.set({ [DOWNLOAD_HISTORY_KEY]: history });
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!ourDownloadIds.has(delta.id)) return;

  if (delta.state?.current === "complete") {
    ourDownloadIds.delete(delta.id);
    chrome.downloads.search({ id: delta.id }).then(([item]) => {
      if (!item) return;
      recordHistory({ filename: item.filename, url: item.url, timestamp: Date.now() });
    });
  } else if (delta.state?.current === "interrupted") {
    ourDownloadIds.delete(delta.id);
  }
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

// Only one navigate-queue batch runs at a time, so this is a single global
// (not per-tab like clickSeriesProgressByTab, since the queue spans
// multiple background tabs over its lifetime, not one).
let navigateQueueProgress: DownloadProgress | null = null;

function enqueue(items: PlaylistItem[], folderName: string) {
  navigateQueueProgress = {
    total: (navigateQueueProgress?.total ?? 0) + items.length,
    completed: navigateQueueProgress?.completed ?? 0,
    currentTitle: navigateQueueProgress?.currentTitle ?? null,
    active: true,
  };
  queue.push(...items.map((item) => ({ item, folderName })));
  if (!processing) processNext();
}

function processNext() {
  const entry = queue.shift();
  if (!entry) {
    processing = false;
    if (navigateQueueProgress) navigateQueueProgress.active = false;
    return;
  }
  processing = true;
  if (navigateQueueProgress) navigateQueueProgress.currentTitle = entry.item.title;

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
  if (navigateQueueProgress) navigateQueueProgress.completed++;
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
  downloadWithPath(video.src, buildDownloadPath(filename, baseFolderName, folderName), () => finishTab(tabId));
}

// --- HLS variant download --------------------------------------------------
// No single downloadable file exists for adaptive streams. For HLS we fetch
// the chosen variant's media playlist, pull every segment (sequentially, to
// keep memory/network sane), and concatenate them into one blob — valid for
// MPEG-TS segments, and works for most fMP4/CMAF segments too since they
// share a common init segment structure. Encrypted (#EXT-X-KEY) streams will
// download but likely won't play; that's a known limitation, not handled yet.

let offscreenReady: Promise<void> | null = null;

// The service worker has no DOM, so URL.createObjectURL() isn't available
// here — offload blob creation to a hidden offscreen document, which does
// have it. See src/offscreen/offscreen.ts.
function ensureOffscreenDocument(): Promise<void> {
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen
      .createDocument({
        url: "src/offscreen/offscreen.html",
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: "Create a Blob object URL for a downloaded video (unavailable in the service worker)",
      })
      .catch((error) => {
        // Already exists (e.g. a prior call raced this one) — fine, ignore.
        if (!String(error).includes("single offscreen document")) throw error;
      });
  }
  return offscreenReady;
}

async function downloadBlobParts(parts: Blob[], mimeType: string, filename: string): Promise<void> {
  await ensureOffscreenDocument();
  const base64Chunks = await Promise.all(parts.map(blobToBase64));

  const request: OffscreenCreateBlobRequest = { type: "offscreen-create-blob", base64Chunks, mimeType };
  const response = (await chrome.runtime.sendMessage(request)) as OffscreenCreateBlobResponse;

  downloadWithPath(response.url, filename, () => {
    // Revoke once the download has had time to read the blob.
    setTimeout(() => {
      const revoke: OffscreenRevokeRequest = { type: "offscreen-revoke", url: response.url };
      chrome.runtime.sendMessage(revoke);
    }, 60_000);
  });
}

async function downloadHlsVariant(variantUrl: string) {
  try {
    const playlistResponse = await fetch(variantUrl);
    if (!playlistResponse.ok) throw new Error(`Playlist fetch failed: HTTP ${playlistResponse.status}`);
    const playlistText = await playlistResponse.text();
    const segmentUrls = parseHlsSegments(playlistText, variantUrl);
    if (segmentUrls.length === 0) throw new Error("Playlist had no segments");

    const chunks: Blob[] = [];
    for (const segmentUrl of segmentUrls) {
      const segmentResponse = await fetch(segmentUrl);
      if (!segmentResponse.ok) throw new Error(`Segment fetch failed: HTTP ${segmentResponse.status}`);
      chunks.push(await segmentResponse.blob());
    }

    await downloadBlobParts(chunks, "video/mp2t", buildDownloadPath("video.ts", baseFolderName));
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
    const { items, kind } = message as PlaylistDetectedMessage;
    playlistByTab.set(tabId, { items, kind });
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
    const response: GetPlaylistResponse = playlistByTab.get(queryTabId) ?? { items: [], kind: "navigate" };
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
    const { url, filename, seriesFolder } = message as DownloadVideoRequest;
    downloadWithPath(url, buildDownloadPath(filename, baseFolderName, seriesFolder));
    return;
  }

  if (message?.type === "click-series-progress" && tabId !== undefined) {
    const { progress } = message as ClickSeriesProgressMessage;
    clickSeriesProgressByTab.set(tabId, progress);
    return;
  }

  if (message?.type === "get-progress") {
    const { tabId: queryTabId } = message as GetProgressRequest;
    // The navigate queue isn't tied to whichever tab the popup happens to be
    // viewing (it opens/closes its own background tabs), so show it
    // whenever it's actively running; once it's done, prefer this tab's own
    // click-series progress if there is one, falling back to the finished
    // navigate summary otherwise.
    const progress = navigateQueueProgress?.active
      ? navigateQueueProgress
      : (clickSeriesProgressByTab.get(queryTabId) ?? navigateQueueProgress);
    const response: GetProgressResponse = { progress };
    sendResponse(response);
    return true;
  }
});
