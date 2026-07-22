export interface DetectedVideo {
  id: string;
  src: string;
  width: number;
  height: number;
  sources: string[];
}

export interface PlaylistItem {
  title: string;
  /** A real navigable URL for "navigate" playlists; a synthetic "#item-N" placeholder for "click" playlists. */
  url: string;
}

/**
 * "navigate": each item is a distinct real URL — open it in a background
 * tab, wait for a video, download, close (the original design).
 * "click": items are JS-driven pseudo-links (all href="#" or identical) —
 * there's no separate URL per lesson at all, so downloading means clicking
 * each one in this same tab and watching the page's own <video> element
 * swap its source, entirely orchestrated by the content script.
 */
export type PlaylistKind = "navigate" | "click";

export interface VideosDetectedMessage {
  type: "videos-detected";
  videos: DetectedVideo[];
}

export interface PlaylistDetectedMessage {
  type: "playlist-detected";
  items: PlaylistItem[];
  kind: PlaylistKind;
}

export interface GetVideosRequest {
  type: "get-videos";
  tabId: number;
}

export interface GetVideosResponse {
  videos: DetectedVideo[];
}

export interface GetPlaylistRequest {
  type: "get-playlist";
  tabId: number;
}

export interface GetPlaylistResponse {
  items: PlaylistItem[];
  kind: PlaylistKind;
}

export interface EnqueueDownloadsRequest {
  type: "enqueue-downloads";
  items: PlaylistItem[];
  /** Series subfolder name, e.g. "MyCourse" -> Downloader/MyCourse/lesson-01.mp4 */
  folderName: string;
}

/** Progress for a batch/series download in flight — either the navigate queue or a click series. */
export interface DownloadProgress {
  total: number;
  completed: number;
  currentTitle: string | null;
  active: boolean;
}

/** Sent from the content script to the background worker as a click series runs. */
export interface ClickSeriesProgressMessage {
  type: "click-series-progress";
  progress: DownloadProgress;
}

export interface GetProgressRequest {
  type: "get-progress";
  tabId: number;
}

export interface GetProgressResponse {
  progress: DownloadProgress | null;
}

export type StreamKind = "hls" | "dash";

export interface StreamVariant {
  /** e.g. "1920x1080", or "unknown" if the manifest didn't declare one */
  resolution: string;
  bandwidth: number;
  url: string;
}

export interface StreamManifest {
  kind: StreamKind;
  masterUrl: string;
  variants: StreamVariant[];
  /** true once we've confirmed this extension can actually download this kind (HLS only, for now) */
  downloadable: boolean;
}

export interface GetStreamsRequest {
  type: "get-streams";
  tabId: number;
}

export interface GetStreamsResponse {
  manifests: StreamManifest[];
}

export interface DownloadStreamRequest {
  type: "download-stream";
  tabId: number;
  variant: StreamVariant;
  kind: StreamKind;
}

export interface DownloadVideoRequest {
  type: "download-video";
  url: string;
  /** Raw filename — the background worker applies the configured base folder (and optional series folder). */
  filename: string;
  seriesFolder?: string;
}

export interface OffscreenCreateBlobRequest {
  type: "offscreen-create-blob";
  base64Chunks: string[];
  mimeType: string;
}

export interface OffscreenCreateBlobResponse {
  url: string;
}

export interface OffscreenRevokeRequest {
  type: "offscreen-revoke";
  url: string;
}

/** Tells the content script to enter element-picker mode: hover-highlight, click to confirm. */
export interface StartPickingRequest {
  type: "start-picking";
}

/** Tells the content script to forget the picked playlist container for the current origin. */
export interface ClearPlaylistSelectorRequest {
  type: "clear-playlist-selector";
}

/**
 * For "click" playlists only: tells the content script to click each
 * selected item (by its index into the last-detected click-item list, in
 * order), wait for the page's own <video> to swap to a new src, and
 * download it — all within the same tab, since there's no separate URL to
 * open for each one.
 */
export interface RunClickSeriesRequest {
  type: "run-click-series";
  indices: number[];
  folderName: string;
}
