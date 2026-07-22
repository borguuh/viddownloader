import { useEffect, useState } from "react";
import { DEFAULT_BASE_FOLDER } from "../shared/download-paths";
import { BASE_FOLDER_NAME_KEY, OVERLAY_BUTTONS_ENABLED_KEY, PLAYLIST_SELECTOR_PREFIX } from "../shared/settings";

export default function App() {
  return (
    <div>
      <h1>Video Downloader — Settings</h1>
      <BaseFolderSetting />
      <OverlayToggleSetting />
      <PlaylistSelectors />
    </div>
  );
}

function BaseFolderSetting() {
  const [value, setValue] = useState(DEFAULT_BASE_FOLDER);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(BASE_FOLDER_NAME_KEY).then((result) => {
      setValue(result[BASE_FOLDER_NAME_KEY] || DEFAULT_BASE_FOLDER);
    });
  }, []);

  const save = () => {
    const trimmed = value.trim() || DEFAULT_BASE_FOLDER;
    setValue(trimmed);
    chrome.storage.local.set({ [BASE_FOLDER_NAME_KEY]: trimmed });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section>
      <h2>Download folder</h2>
      <p style={{ fontSize: 13, color: "#555" }}>
        Every download from this extension goes under this subfolder of your default Downloads
        folder (Chrome doesn't support an arbitrary folder-picker for extension downloads).
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ flex: 1, padding: 6 }}
        />
        <button onClick={save}>Save</button>
        {saved && <span style={{ fontSize: 12, color: "#4caf50" }}>Saved</span>}
      </div>
    </section>
  );
}

function OverlayToggleSetting() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    chrome.storage.local.get(OVERLAY_BUTTONS_ENABLED_KEY).then((result) => {
      setEnabled(result[OVERLAY_BUTTONS_ENABLED_KEY] ?? true);
    });
  }, []);

  const toggle = (next: boolean) => {
    setEnabled(next);
    chrome.storage.local.set({ [OVERLAY_BUTTONS_ENABLED_KEY]: next });
  };

  return (
    <section>
      <h2>Per-video download buttons</h2>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
        Show a floating "Download" button over each video on a page
      </label>
    </section>
  );
}

function PlaylistSelectors() {
  const [entries, setEntries] = useState<{ origin: string; selector: string }[]>([]);

  const load = () => {
    chrome.storage.local.get(null).then((all) => {
      const items = Object.entries(all)
        .filter(([key]) => key.startsWith(PLAYLIST_SELECTOR_PREFIX))
        .map(([key, selector]) => ({ origin: key.slice(PLAYLIST_SELECTOR_PREFIX.length), selector: String(selector) }));
      setEntries(items);
    });
  };

  useEffect(load, []);

  const forget = (origin: string) => {
    chrome.storage.local.remove(`${PLAYLIST_SELECTOR_PREFIX}${origin}`).then(load);
  };

  return (
    <section>
      <h2>Saved playlist areas</h2>
      <p style={{ fontSize: 13, color: "#555" }}>
        Sites where you've used "Pick playlist area" in the popup. Forget one if it stops
        matching (e.g. after a site redesign) and you want to re-pick.
      </p>
      {entries.length === 0 ? (
        <p style={{ fontSize: 13, color: "#888" }}>None saved yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {entries.map((entry) => (
            <li
              key={entry.origin}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                padding: "4px 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <div style={{ overflow: "hidden" }}>
                <div>{entry.origin}</div>
                <div style={{ color: "#888", fontSize: 11, wordBreak: "break-all" }}>{entry.selector}</div>
              </div>
              <button onClick={() => forget(entry.origin)}>Forget</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
