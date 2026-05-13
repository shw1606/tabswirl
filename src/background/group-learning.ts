// Learn from user-initiated tab → group moves.
//
// PRD §4 F1 "사용자 액션 존중":
//   사용자가 수동으로 탭을 다른 그룹으로 옮기면 → 그 결정을 도메인 캐시에 학습
//
// Mechanism: chrome.tabs.onUpdated fires with `changeInfo.groupId` set
// whenever a tab changes groups. We can't distinguish user-initiated
// moves from our own classifier-initiated moves at the event level, but
// it doesn't matter — recording either is correct:
//   - Our move: cache update is redundant (seedDomainEntries already
//     wrote the same value).
//   - User move: cache learns the user's choice. Next same-domain tab
//     takes the T0 fast path into the user's preferred group.
//
// We also act on chrome.tabGroups.onUpdated (name / color changes) so a
// user-renamed group propagates to cached entries pointing at it.

import { extractDomain, isClassifiable } from "../core/tabs";
import type { ChromeGroupColor } from "../core/types";
import { setDomainEntry } from "./domain-cache";
import { isGroupableWindow } from "./window-type";

let listenersRegistered = false;

async function recordGroupForTab(
  tab: chrome.tabs.Tab,
  groupId: number,
): Promise<void> {
  if (typeof tab.url !== "string" || tab.url.length === 0) return;
  if (typeof tab.windowId !== "number") return;
  if (!isClassifiable(tab)) return;
  if (!(await isGroupableWindow(tab.windowId))) return;

  let group: chrome.tabGroups.TabGroup;
  try {
    group = await chrome.tabGroups.get(groupId);
  } catch {
    // Group disappeared between the event and our lookup. Skip.
    return;
  }
  const title = group.title;
  // chrome.tabGroups requires a title before we cache (an empty group
  // title would store as "" and surface confusingly in the popup).
  if (!title || title.length === 0) return;

  const domain = extractDomain(tab.url);
  await setDomainEntry({
    windowId: tab.windowId,
    domain,
    groupId,
    categoryName: title,
    color: group.color as ChromeGroupColor,
  });
}

/**
 * Wire chrome.tabs.onUpdated + chrome.tabGroups.onUpdated to keep the
 * domain cache aligned with what's actually on screen. Idempotent.
 */
export function registerGroupLearningListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  // (a) Tab moved into a (different) group.
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (typeof changeInfo.groupId !== "number") return;
    // -1 means ungrouped — nothing to record (forgetGroup is handled
    // elsewhere when groups themselves are removed).
    if (changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return;
    void recordGroupForTab(tab, changeInfo.groupId);
  });

  // (b) Group renamed or recolored. Walk the tabs in that group and
  // re-seed each one's cache entry with the new metadata.
  chrome.tabGroups.onUpdated.addListener((group) => {
    void (async () => {
      if (typeof group.windowId !== "number") return;
      if (!group.title || group.title.length === 0) return;
      let tabs: chrome.tabs.Tab[];
      try {
        tabs = await chrome.tabs.query({ groupId: group.id });
      } catch {
        return;
      }
      for (const tab of tabs) {
        if (typeof tab.url !== "string" || tab.url.length === 0) continue;
        if (!isClassifiable(tab)) continue;
        const domain = extractDomain(tab.url);
        await setDomainEntry({
          windowId: group.windowId,
          domain,
          groupId: group.id,
          categoryName: group.title,
          color: group.color as ChromeGroupColor,
        });
      }
    })();
  });
}

/** Test-only. */
export function _resetGroupLearningListenersForTests(): void {
  listenersRegistered = false;
}
