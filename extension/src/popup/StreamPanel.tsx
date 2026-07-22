import type { DownloadStreamRequest, StreamManifest } from "../shared/types";

export default function StreamPanel({
  manifests,
  tabId,
}: {
  manifests: StreamManifest[];
  tabId: number;
}) {
  if (manifests.length === 0) return null;

  const download = (manifest: StreamManifest, variantUrl: string) => {
    const variant = manifest.variants.find((v) => v.url === variantUrl);
    if (!variant) return;
    const request: DownloadStreamRequest = {
      type: "download-stream",
      tabId,
      variant,
      kind: manifest.kind,
    };
    chrome.runtime.sendMessage(request);
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #ddd", paddingTop: 8 }}>
      <h3 style={{ margin: "0 0 8px" }}>Adaptive stream detected</h3>
      {manifests.map((manifest) => (
        <div key={manifest.masterUrl} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
            {manifest.kind.toUpperCase()}
            {!manifest.downloadable && " — download not supported yet"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {manifest.variants.map((variant) => (
              <div
                key={variant.url}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
              >
                <span style={{ flex: 1 }}>
                  {variant.resolution}
                  {variant.bandwidth > 0 && ` · ${Math.round(variant.bandwidth / 1000)} kbps`}
                </span>
                <button
                  disabled={!manifest.downloadable}
                  onClick={() => download(manifest, variant.url)}
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
