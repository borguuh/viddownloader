import { useEffect, useState } from "react";
import type { EnqueueDownloadsRequest, PlaylistItem } from "../shared/types";

export default function PlaylistPanel({
  items,
  defaultFolderName,
}: {
  items: PlaylistItem[];
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
    const request: EnqueueDownloadsRequest = {
      type: "enqueue-downloads",
      items: chosen,
      folderName: folderName.trim() || "series",
    };
    chrome.runtime.sendMessage(request);
    setSelected(new Set());
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #ddd", paddingTop: 8 }}>
      <h3 style={{ margin: "0 0 8px" }}>Playlist ({items.length} found)</h3>
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
