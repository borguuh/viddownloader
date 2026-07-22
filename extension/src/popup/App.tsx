import { useEffect, useState } from "react";
import type { DetectedVideo, GetVideosRequest, GetVideosResponse } from "../shared/types";
import { getDownloadableSources, startDownload } from "./downloads";

export default function App() {
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        setLoading(false);
        return;
      }

      const request: GetVideosRequest = { type: "get-videos", tabId: tab.id };
      chrome.runtime.sendMessage(request, (response: GetVideosResponse) => {
        setVideos(response?.videos ?? []);
        setLoading(false);
      });
    });
  }, []);

  if (loading) return <p>Scanning page for video…</p>;

  if (videos.length === 0) {
    return <p>No video detected on this page yet.</p>;
  }

  return (
    <div>
      <h3 style={{ margin: "0 0 8px" }}>Detected video</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {videos.map((video) => (
          <li key={video.id} style={{ marginBottom: 12, fontSize: 13 }}>
            <div style={{ marginBottom: 4 }}>
              {video.width}×{video.height}
            </div>
            <VideoSources video={video} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function VideoSources({ video }: { video: DetectedVideo }) {
  const sources = getDownloadableSources(video);

  if (sources.length === 0) {
    return <div style={{ color: "#888" }}>(no src detected yet)</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {sources.map((source) => (
        <div key={source.url} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flex: 1, wordBreak: "break-all", fontSize: 12 }}>{source.filename}</span>
          <button onClick={() => startDownload(source)}>Download</button>
        </div>
      ))}
    </div>
  );
}
