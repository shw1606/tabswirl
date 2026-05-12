// MV3 service worker entry point. Registers all extension-level listeners
// and bootstraps state recovery on wake.
//
// Lifecycle (CLAUDE.md "Critical invariants" §4):
//   - onInstalled fires on install/update — bulk classify all open tabs.
//   - onStartup fires when the browser starts with the extension already
//     installed — rehydrate pending classifier queues.
//   - The SW idles ~30s after no events; module-level state dies. The
//     event handlers below are the only thing that survives across naps.

import { getSettings } from "../core/settings";
import type { RestoreRequest, RestoreResponse } from "../core/messaging";
import { rehydrateQueue } from "./classifier-queue";
import { classifyAllOpenTabs } from "./initial-classifier";
import { restorePouch } from "./restore";
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

// Popup → SW messaging. Returning `true` keeps the channel open for
// the async sendResponse — chrome.runtime requires this to await a
// Promise inside a message listener.
// Ref: https://developer.chrome.com/docs/extensions/develop/concepts/messaging#simple
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    !message ||
    typeof message !== "object" ||
    (message as { type?: unknown }).type !== "restore-pouch"
  ) {
    return false;
  }
  const req = message as RestoreRequest;
  void (async () => {
    const outcome = await restorePouch(req.pouchId);
    const response: RestoreResponse = outcome.ok
      ? {
          ok: true,
          tabsOpened: outcome.tabsOpened,
          groupsOpened: outcome.groupsOpened,
        }
      : { ok: false, reason: outcome.reason };
    sendResponse(response);
  })();
  return true;
});

// Bare event registrations above keep this SW awake just long enough
// to dispatch the call into the relevant module. All meaningful work
// happens in those modules — this file is intentionally thin so a fresh
// SW wake-up does the minimum work before reaching the right handler.
