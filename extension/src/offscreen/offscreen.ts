import type {
  OffscreenCreateBlobRequest,
  OffscreenCreateBlobResponse,
  OffscreenRevokeRequest,
} from "../shared/types";
import { base64ToUint8Array } from "../shared/base64";

// Exists solely because the background service worker has no DOM and can't
// call URL.createObjectURL() itself — this hidden extension page can.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "offscreen-create-blob") {
    const { base64Chunks, mimeType } = message as OffscreenCreateBlobRequest;
    const parts = base64Chunks.map(base64ToUint8Array);
    const blob = new Blob(parts as BlobPart[], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const response: OffscreenCreateBlobResponse = { url };
    sendResponse(response);
    return;
  }

  if (message?.type === "offscreen-revoke") {
    const { url } = message as OffscreenRevokeRequest;
    URL.revokeObjectURL(url);
    return;
  }
});
