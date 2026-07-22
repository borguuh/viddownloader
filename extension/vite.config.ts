import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: {
      // The offscreen document isn't referenced anywhere in manifest.json
      // (chrome.offscreen.createDocument() loads it by path at runtime), so
      // it needs to be added as an explicit build entry to get bundled.
      input: {
        offscreen: "src/offscreen/offscreen.html",
      },
    },
  },
});
