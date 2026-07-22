export interface DetectedVideo {
  id: string;
  src: string;
  width: number;
  height: number;
  sources: string[];
}

export interface PlaylistItem {
  title: string;
  url: string;
}

export interface VideosDetectedMessage {
  type: "videos-detected";
  videos: DetectedVideo[];
}

export interface PlaylistDetectedMessage {
  type: "playlist-detected";
  items: PlaylistItem[];
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
}

export interface EnqueueDownloadsRequest {
  type: "enqueue-downloads";
  items: PlaylistItem[];
  /** Series subfolder name, e.g. "MyCourse" -> Downloader/MyCourse/lesson-01.mp4 */
  folderName: string;
}

export interface QueueStatusMessage {
  type: "queue-status";
  remaining: number;
  current: PlaylistItem | null;
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
  filename: string;
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
