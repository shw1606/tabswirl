// Manifest V3 definition. Mirrors PRD §6.5 verbatim.
// Entry-point paths (popup, options, service worker) reference files that
// will land in later milestones; vite build will fail until those exist,
// but typecheck and unit tests do not depend on them.
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "TabSwirl",
  version: "0.1.0",
  description:
    "AI-powered automatic tab classification with consume-on-restore Pouches.",
  permissions: ["tabs", "tabGroups", "storage", "unlimitedStorage"],
  host_permissions: ["https://api.anthropic.com/*"],
  action: {
    default_popup: "src/popup/index.html",
    default_title: "TabSwirl",
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
