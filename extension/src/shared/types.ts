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
}

export interface QueueStatusMessage {
  type: "queue-status";
  remaining: number;
  current: PlaylistItem | null;
}
