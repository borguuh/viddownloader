import type { ClearPlaylistSelectorRequest, StartPickingRequest } from "../shared/types";

export default function PlaylistPicker({ tabId }: { tabId: number }) {
  const pick = async () => {
    const request: StartPickingRequest = { type: "start-picking" };
    await chrome.tabs.sendMessage(tabId, request);
    // Close the popup so the user can click the actual element on the page.
    window.close();
  };

  const clear = () => {
    const request: ClearPlaylistSelectorRequest = { type: "clear-playlist-selector" };
    chrome.tabs.sendMessage(tabId, request);
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #ddd", paddingTop: 8 }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
        If the playlist above is wrong (or missing), click the actual lesson-list area on the
        page directly:
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={pick}>Pick playlist area on page</button>
        <button onClick={clear}>Clear saved area</button>
      </div>
    </div>
  );
}
