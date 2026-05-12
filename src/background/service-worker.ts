// MV3 service worker entry point. Registers all extension-level listeners
// and bootstraps state recovery on wake.
//
// Lifecycle (CLAUDE.md "Critical invariants" §4):
//   - onInstalled fires on install/update — bulk classify all open tabs.
//   - onStartup fires when the browser starts with the extension already
//     installed — rehydrate pending classifier queues.
//   - The SW idles ~30s after no events; module-level state dies. The
//     event handlers below are the only thing that survives across naps.

import { rehydrateQueue } from "./classifier-queue";
import { getSettings } from "../core/settings";
import { classifyAllOpenTabs } from "./initial-classifier";
import { registerTabListener } from "./tab-listener";

registerTabListener();

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    const settings = await getSettings();
    if (!settings.autoClassifyEnabled) return;
    // Bulk classify on first install or after extension update.
    if (details.reason === "install" || details.reason === "update") {
      await classifyAllOpenTabs({
        language: settings.language,
        model: settings.llmModel,
      });
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    const settings = await getSettings();
    await rehydrateQueue({
      language: settings.language,
      model: settings.llmModel,
    });
  })();
});

// Bare event registrations above keep this SW awake just long enough
// to dispatch the call into the relevant module. All meaningful work
// happens in those modules — this file is intentionally thin so a fresh
// SW wake-up does the minimum work before reaching the right handler.
