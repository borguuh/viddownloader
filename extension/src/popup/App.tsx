import { useEffect, useState } from "react";
import type { DetectedVideo, GetVideosRequest, GetVideosResponse } from "../shared/types";

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
          <li key={video.id} style={{ marginBottom: 8, fontSize: 13, wordBreak: "break-all" }}>
            <div>{video.width}×{video.height}</div>
            <div>{video.src || "(no src detected yet)"}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
