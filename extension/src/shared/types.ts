export interface DetectedVideo {
  id: string;
  src: string;
  width: number;
  height: number;
  sources: string[];
}

export interface VideosDetectedMessage {
  type: "videos-detected";
  videos: DetectedVideo[];
}

export interface GetVideosRequest {
  type: "get-videos";
  tabId: number;
}

export interface GetVideosResponse {
  videos: DetectedVideo[];
}
