import type {
  DetectedVideo,
  GetVideosRequest,
  GetVideosResponse,
  VideosDetectedMessage,
} from "../shared/types";

const videosByTab = new Map<number, DetectedVideo[]>();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "videos-detected" && sender.tab?.id !== undefined) {
    const { videos } = message as VideosDetectedMessage;
    videosByTab.set(sender.tab.id, videos);
    return;
  }

  if (message?.type === "get-videos") {
    const { tabId } = message as GetVideosRequest;
    const response: GetVideosResponse = { videos: videosByTab.get(tabId) ?? [] };
    sendResponse(response);
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  videosByTab.delete(tabId);
});
