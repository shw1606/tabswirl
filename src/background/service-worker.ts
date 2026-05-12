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
import type {
  ClassifyAllRequest,
  ClassifyAllResponse,
  RestoreRequest,
  RestoreResponse,
} from "../core/messaging";
import { rehydrateQueue } from "./classifier-queue";
import { registerGroupRemovalInvalidator } from "./domain-cache";
import { classifyAllOpenTabs } from "./initial-classifier";
import { restorePouch } from "./restore";
import { registerTabListener } from "./tab-listener";
import { registerWindowTypeListeners } from "./window-type";

registerTabListener();
registerWindowTypeListeners();
registerGroupRemovalInvalidator();

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    const settings = await getSettings();
    if (!settings.autoClassifyEnabled) return;
    // Bulk classify on first install or after extension update.
    if (details.reason === "install" || details.reason === "update") {
      await classifyAllOpenTabs({
        language: settings.language,
        model: settings.llmModel,
        provider: settings.llmProvider,
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
      provider: settings.llmProvider,
    });
  })();
});

// Popup → SW messaging. Returning `true` keeps the channel open for
// the async sendResponse — chrome.runtime requires this to await a
// Promise inside a message listener.
// Ref: https://developer.chrome.com/docs/extensions/develop/concepts/messaging#simple
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;

  if (type === "restore-pouch") {
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
  }

  if (type === "classify-all-tabs") {
    void (message as ClassifyAllRequest);
    void (async () => {
      const settings = await getSettings();
      const outcome = await classifyAllOpenTabs({
        language: settings.language,
        model: settings.llmModel,
        provider: settings.llmProvider,
      });
      const response: ClassifyAllResponse = {
        ok: true,
        totalClassified: outcome.totalClassified,
        totalErrors: outcome.totalErrors,
        windowsTouched: outcome.windows.length,
      };
      sendResponse(response);
    })();
    return true;
  }

  return false;
});

// Bare event registrations above keep this SW awake just long enough
// to dispatch the call into the relevant module. All meaningful work
// happens in those modules — this file is intentionally thin so a fresh
// SW wake-up does the minimum work before reaching the right handler.
