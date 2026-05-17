// Manifest V3 definition. Mirrors PRD §6.5 verbatim.
//
// Icons are generated from assets/icon-source.png (a 1280×1280 center crop
// of the source illustration). To regenerate at different sizes:
//   sips -z 128 128 assets/icon-source.png --out icons/icon-128.png
//   sips -z  48  48 assets/icon-source.png --out icons/icon-48.png
// For the 16/32 sizes a tighter crop of the original was used so the line
// art remains visible after downsampling — see docs/WORK_LOG.md for the
// exact pipeline.
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "TabSwirl",
  version: "0.3.0",
  description:
    "AI-powered automatic tab classification with consume-on-restore Pouches.",
  permissions: ["tabs", "tabGroups", "storage", "unlimitedStorage"],
  host_permissions: [
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*",
  ],
  action: {
    default_popup: "src/popup/index.html",
    default_title: "TabSwirl",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
    },
  },
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  options_page: "src/options/index.html",
  commands: {
    "open-stash": {
      suggested_key: {
        default: "Ctrl+Shift+P",
        mac: "Command+Shift+P",
      },
      description: "Open TabSwirl popup",
    },
  },
});
