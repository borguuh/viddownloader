import type { StreamManifest, StreamVariant } from "../shared/types";

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

/**
 * Parses an HLS master playlist's #EXT-X-STREAM-INF lines into resolution
 * variants. If the playlist has no STREAM-INF lines it's already a media
 * (segment) playlist rather than a master — treated as a single variant.
 */
export function parseHlsMaster(text: string, masterUrl: string): StreamVariant[] {
  const lines = text.split(/\r?\n/);
  const variants: StreamVariant[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;

    const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
    const uriLine = lines[i + 1]?.trim();
    if (!uriLine || uriLine.startsWith("#")) continue;

    variants.push({
      resolution: resolutionMatch?.[1] ?? "unknown",
      bandwidth: bandwidthMatch ? Number(bandwidthMatch[1]) : 0,
      url: resolveUrl(uriLine, masterUrl),
    });
  }

  if (variants.length === 0) {
    // Not a master playlist — already the media playlist itself.
    variants.push({ resolution: "unknown", bandwidth: 0, url: masterUrl });
  }

  return variants.sort((a, b) => b.bandwidth - a.bandwidth);
}

/**
 * Minimal, regex-based DASH MPD parser — good enough to list resolution
 * variants for display. Not a full XML parser (service workers have no
 * DOMParser), so this is approximate and doesn't resolve BaseURL
 * inheritance rules precisely. Download support for DASH is not wired up
 * yet (see StreamManifest.downloadable).
 */
export function parseDashMpd(text: string, mpdUrl: string): StreamVariant[] {
  const variants: StreamVariant[] = [];
  const representationRegex = /<Representation\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = representationRegex.exec(text))) {
    const attrs = match[1];
    const width = attrs.match(/width="(\d+)"/i)?.[1];
    const height = attrs.match(/height="(\d+)"/i)?.[1];
    const bandwidth = attrs.match(/bandwidth="(\d+)"/i)?.[1];
    const id = attrs.match(/id="([^"]+)"/i)?.[1] ?? "";

    variants.push({
      resolution: width && height ? `${width}x${height}` : "unknown",
      bandwidth: bandwidth ? Number(bandwidth) : 0,
      url: resolveUrl(id, mpdUrl),
    });
  }

  return variants.sort((a, b) => b.bandwidth - a.bandwidth);
}

export function detectKindFromUrl(url: string): "hls" | "dash" | null {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".m3u8")) return "hls";
  if (path.endsWith(".mpd")) return "dash";
  return null;
}

export async function buildManifest(url: string): Promise<StreamManifest | null> {
  const kind = detectKindFromUrl(url);
  if (!kind) return null;

  const response = await fetch(url);
  if (!response.ok) return null;
  const text = await response.text();

  const variants = kind === "hls" ? parseHlsMaster(text, url) : parseDashMpd(text, url);
  if (variants.length === 0) return null;

  return { kind, masterUrl: url, variants, downloadable: kind === "hls" };
}

/** Parses an HLS media (segment) playlist into absolute segment URLs. */
export function parseHlsSegments(text: string, playlistUrl: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => resolveUrl(line, playlistUrl));
}
