import type { DetectedVideo, VideosDetectedMessage } from "../shared/types";

function collectVideos(): DetectedVideo[] {
  const videos = Array.from(document.querySelectorAll("video"));

  return videos.map((video, index) => {
    const sources = Array.from(video.querySelectorAll("source"))
      .map((s) => s.src)
      .filter(Boolean);

    return {
      id: `video-${index}`,
      src: video.currentSrc || video.src,
      width: video.videoWidth,
      height: video.videoHeight,
      sources,
    };
  });
}

function reportVideos() {
  const videos = collectVideos();
  const message: VideosDetectedMessage = { type: "videos-detected", videos };
  chrome.runtime.sendMessage(message);
}

reportVideos();

const observer = new MutationObserver(() => reportVideos());
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("loadedmetadata", reportVideos, true);
