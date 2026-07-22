import { useEffect, useState } from "react";
import type { DownloadProgress, GetProgressRequest, GetProgressResponse } from "../shared/types";

export default function ProgressBar({ tabId }: { tabId: number }) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  useEffect(() => {
    const poll = () => {
      const request: GetProgressRequest = { type: "get-progress", tabId };
      chrome.runtime.sendMessage(request, (response: GetProgressResponse) => {
        setProgress(response?.progress ?? null);
      });
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [tabId]);

  if (!progress || progress.total === 0) return null;

  const pct = Math.round((progress.completed / progress.total) * 100);

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #ddd", paddingTop: 8 }}>
      <div style={{ fontSize: 12, marginBottom: 4 }}>
        {progress.active
          ? `Downloading ${progress.completed}/${progress.total}${progress.currentTitle ? `: ${progress.currentTitle}` : "…"}`
          : `Done: ${progress.completed}/${progress.total}`}
      </div>
      <div style={{ background: "#eee", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            background: progress.active ? "#2684ff" : "#4caf50",
            height: "100%",
            transition: "width 0.2s",
          }}
        />
      </div>
    </div>
  );
}
