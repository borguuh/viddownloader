/**
 * Content scripts only auto-inject into tabs navigated *after* the extension
 * loaded — a tab that was already open won't have it until reloaded. Rather
 * than requiring that reload, inject it on demand here; the content script
 * itself guards against double-injection (see window.__videoDownloaderInjected).
 */
export async function ensureContentScriptInjected(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  } catch {
    // Fails on chrome:// pages, the Web Store, etc. — nothing to do there anyway.
  }
}
