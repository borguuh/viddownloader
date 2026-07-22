import { useEffect, useState } from "react";
import type {
  DetectedVideo,
  GetPlaylistRequest,
  GetPlaylistResponse,
  GetStreamsRequest,
  GetStreamsResponse,
  GetVideosRequest,
  GetVideosResponse,
  PlaylistItem,
  StreamManifest,
} from "../shared/types";
import { getDownloadableSources, isBlobOnly, startDownload } from "./downloads";
import { ensureContentScriptInjected } from "./ensure-injected";
import PlaylistPanel from "./PlaylistPanel";
import StreamPanel from "./StreamPanel";

export default function App() {
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [streams, setStreams] = useState<StreamManifest[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [defaultFolderName, setDefaultFolderName] = useState("series");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab?.id) {
        setLoading(false);
        return;
      }
      setTabId(tab.id);
      setDefaultFolderName(tab.title ?? "series");

      await ensureContentScriptInjected(tab.id);

      const videosRequest: GetVideosRequest = { type: "get-videos", tabId: tab.id };
      chrome.runtime.sendMessage(videosRequest, (response: GetVideosResponse) => {
        setVideos(response?.videos ?? []);
        setLoading(false);
      });

      const playlistRequest: GetPlaylistRequest = { type: "get-playlist", tabId: tab.id };
      chrome.runtime.sendMessage(playlistRequest, (response: GetPlaylistResponse) => {
        setPlaylist(response?.items ?? []);
      });

      const streamsRequest: GetStreamsRequest = { type: "get-streams", tabId: tab.id };
      chrome.runtime.sendMessage(streamsRequest, (response: GetStreamsResponse) => {
        setStreams(response?.manifests ?? []);
      });
    });
  }, []);

  if (loading) return <p>Scanning page for video…</p>;

  return (
    <div>
      {videos.length === 0 ? (
        <p>No video detected on this page yet.</p>
      ) : (
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
      )}
      {tabId !== null && <StreamPanel manifests={streams} tabId={tabId} />}
      <PlaylistPanel items={playlist} defaultFolderName={defaultFolderName} />
    </div>
  );
}

function VideoSources({ video }: { video: DetectedVideo }) {
  const sources = getDownloadableSources(video);

  if (sources.length === 0) {
    if (isBlobOnly(video)) {
      return (
        <div style={{ color: "#888" }}>
          This video streams in-page (blob:) and can't be downloaded directly — check "Adaptive
          stream detected" below if one showed up.
        </div>
      );
    }
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
