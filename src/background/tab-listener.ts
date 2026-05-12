// Wires chrome.tabs.onUpdated → classifier-queue.
//
// We only act on `status === "complete"` so the URL and title are stable.
// (Tabs fire onUpdated many times during navigation; we don't want to
// classify a not-yet-loaded URL.)
//
// Restoring-tabs guard: when the user restores a Pouch, those tabs are
// re-created with their group/color already known. They MUST NOT be
// re-classified — CLAUDE.md "Critical invariants" §3. The shared
// restoringTabIds set is checked first; matching tab ids are skipped.

import { isClassifiable } from "../core/tabs";
import { getSettings } from "../core/settings";
import { enqueueTab } from "./classifier-queue";
import { isGroupableWindow } from "./window-type";

const restoringTabIds = new Set<number>();

/**
 * Mark a tab id as currently being restored. The next `complete` event
 * for this tab will be ignored by the auto-classifier.
 *
 * Caller is responsible for clearing the id ~1.5s after the restore
 * batch finishes (PRD §4 F4, CLAUDE.md "Critical invariants" §3).
 */
export function markRestoring(tabIds: number[]): void {
  for (const id of tabIds) restoringTabIds.add(id);
}

export function unmarkRestoring(tabIds: number[]): void {
  for (const id of tabIds) restoringTabIds.delete(id);
}

export function isRestoring(tabId: number): boolean {
  return restoringTabIds.has(tabId);
}

async function handleTabUpdate(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
): Promise<void> {
  // Fire only when the page has finished loading.
  if (changeInfo.status !== "complete") return;

  if (isRestoring(tabId)) return;
  if (!isClassifiable(tab)) return;

  // Skip PWA / popup / app / panel / devtools windows up-front so we
  // don't bother enqueuing a tab whose flush would later be rejected
  // by chrome.tabs.group anyway.
  if (!(await isGroupableWindow(tab.windowId))) return;

  const settings = await getSettings();
  if (!settings.autoClassifyEnabled) return;

  const tDispatch = performance.now();
  await enqueueTab({
    tabId,
    windowId: tab.windowId,
    title: tab.title ?? "",
    url: tab.url ?? "",
    language: settings.language,
    model: settings.llmModel,
    provider: settings.llmProvider,
  });
  // Listener-side overhead (settings read + filters + enqueue) — usually
  // small but worth surfacing when something stalls.
  const dt = Math.round(performance.now() - tDispatch);
  if (dt > 30) {
    console.log(
      `[tabswirl:timing] onUpdated→enqueueTab(tab=${tabId}) ${dt}ms (listener overhead)`,
    );
  }
}

/**
 * Register the chrome.tabs.onUpdated listener. Safe to call multiple
 * times — the second registration is idempotent because we keep a flag
 * tracking whether we've wired up already.
 */
let registered = false;
export function registerTabListener(): void {
  if (registered) return;
  registered = true;
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void handleTabUpdate(tabId, changeInfo, tab);
  });
}

/** Test-only: reset the registered flag and the restoring set. */
export function _resetForTests(): void {
  registered = false;
  restoringTabIds.clear();
}
