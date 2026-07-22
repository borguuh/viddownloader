import { useEffect, useState } from "react";
import type {
  EnqueueDownloadsRequest,
  PlaylistItem,
  PlaylistKind,
  RunClickSeriesRequest,
} from "../shared/types";

function parseClickIndex(url: string): number | null {
  const match = url.match(/^#item-(\d+)$/);
  return match ? Number(match[1]) : null;
}

export default function PlaylistPanel({
  items,
  kind,
  tabId,
  defaultFolderName,
}: {
  items: PlaylistItem[];
  kind: PlaylistKind;
  tabId: number;
  defaultFolderName: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folderName, setFolderName] = useState(defaultFolderName);

  useEffect(() => setFolderName(defaultFolderName), [defaultFolderName]);

  if (items.length === 0) return null;

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(items.map((i) => i.url)));
  const selectNone = () => setSelected(new Set());

  const downloadSelected = () => {
    const chosen = items.filter((item) => selected.has(item.url));
    if (chosen.length === 0) return;
    const resolvedFolderName = folderName.trim() || "series";

    if (kind === "click") {
      // No separate URL per item on this site — clicking each one swaps the
      // page's own <video>, so the content script has to do this in the
      // same tab rather than opening background tabs.
      const indices = chosen.map((item) => parseClickIndex(item.url)).filter((i): i is number => i !== null);
      const request: RunClickSeriesRequest = {
        type: "run-click-series",
        indices,
        folderName: resolvedFolderName,
      };
      chrome.tabs.sendMessage(tabId, request);
    } else {
      const request: EnqueueDownloadsRequest = {
        type: "enqueue-downloads",
        items: chosen,
        folderName: resolvedFolderName,
      };
      chrome.runtime.sendMessage(request);
    }

    setSelected(new Set());
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #ddd", paddingTop: 8 }}>
      <h3 style={{ margin: "0 0 8px" }}>Playlist ({items.length} found)</h3>
      {kind === "click" && (
        <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
          This site loads lessons in place (no separate page per lesson) — downloading will click
          through your selection in this tab, one at a time.
        </div>
      )}
      <div style={{ marginBottom: 6, display: "flex", gap: 8 }}>
        <button onClick={selectAll}>Select all</button>
        <button onClick={selectNone}>Clear</button>
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0 0 8px",
          maxHeight: 160,
          overflowY: "auto",
        }}
      >
        {items.map((item) => (
          <li key={item.url} style={{ fontSize: 12, marginBottom: 4 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={selected.has(item.url)}
                onChange={() => toggle(item.url)}
              />
              <span style={{ wordBreak: "break-word" }}>{item.title}</span>
            </label>
          </li>
        ))}
      </ul>
      <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
        Folder name (under Downloads/Downloader/)
        <input
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          style={{ display: "block", width: "100%", marginTop: 2, boxSizing: "border-box" }}
        />
      </label>
      <button disabled={selected.size === 0} onClick={downloadSelected}>
        Download selected ({selected.size})
      </button>
    </div>
  );
}
