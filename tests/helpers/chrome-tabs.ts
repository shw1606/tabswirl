// Mock for chrome.tabs.group / chrome.tabGroups.update / .query / chrome.tabs.query.
//
// Models the subset of behavior our code depends on:
//   - chrome.tabs.group returns a numeric groupId (auto-incremented)
//   - chrome.tabGroups.update sets title + color on the group
//   - chrome.tabGroups.query / chrome.tabs.query filter by windowId
//
// Not modeled: cross-window grouping, autodiscard, etc.

import { vi } from "vitest";
import type { ChromeGroupColor } from "../../src/core/types";

export interface FakeTab {
  id: number;
  windowId: number;
  groupId: number;
  title: string;
  url: string;
  incognito?: boolean;
  pinned?: boolean;
}

export interface FakeGroup {
  id: number;
  windowId: number;
  title: string;
  color: ChromeGroupColor;
}

export interface ChromeTabsMock {
  tabs: Map<number, FakeTab>;
  groups: Map<number, FakeGroup>;
  /** Adds tabs to the in-memory state. */
  seedTabs: (tabs: FakeTab[]) => void;
}

export function installChromeTabsMock(): ChromeTabsMock {
  const tabs = new Map<number, FakeTab>();
  const groups = new Map<number, FakeGroup>();
  let nextGroupId = 1000;

  const tabsApi = {
    group: vi.fn(async (options: chrome.tabs.GroupOptions): Promise<number> => {
      const tabIdList = Array.isArray(options.tabIds)
        ? options.tabIds
        : [options.tabIds as number];

      let groupId: number;
      if (options.groupId !== undefined) {
        groupId = options.groupId;
        if (!groups.has(groupId)) {
          throw new Error(`fake chrome.tabs.group: groupId ${groupId} unknown`);
        }
      } else {
        const windowId =
          options.createProperties?.windowId ??
          (() => {
            const firstTab = tabs.get(tabIdList[0]!);
            if (!firstTab) {
              throw new Error("fake chrome.tabs.group: no window context");
            }
            return firstTab.windowId;
          })();
        groupId = nextGroupId++;
        groups.set(groupId, {
          id: groupId,
          windowId,
          title: "",
          color: "grey",
        });
      }

      const group = groups.get(groupId)!;
      for (const tabId of tabIdList) {
        const tab = tabs.get(tabId);
        if (!tab) {
          throw new Error(`fake chrome.tabs.group: unknown tab ${tabId}`);
        }
        if (tab.windowId !== group.windowId) {
          throw new Error(
            `fake chrome.tabs.group: tab ${tabId} is in window ${tab.windowId}, group ${groupId} is in ${group.windowId}`,
          );
        }
        tab.groupId = groupId;
      }

      return groupId;
    }),

    ungroup: vi.fn(async (tabIds: number | number[]): Promise<void> => {
      const list = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of list) {
        const tab = tabs.get(id);
        if (tab) tab.groupId = -1;
      }
    }),

    query: vi.fn(
      async (query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> => {
        let list = [...tabs.values()];
        if (query.windowId !== undefined) {
          list = list.filter((t) => t.windowId === query.windowId);
        }
        if (query.groupId !== undefined) {
          list = list.filter((t) => t.groupId === query.groupId);
        }
        return list.map((t) =>
          ({
            id: t.id,
            windowId: t.windowId,
            groupId: t.groupId,
            title: t.title,
            url: t.url,
            incognito: !!t.incognito,
            pinned: !!t.pinned,
            index: 0,
            highlighted: false,
            active: false,
            selected: false,
            discarded: false,
            autoDiscardable: true,
          }) as chrome.tabs.Tab,
        );
      },
    ),
  };

  const tabGroupsApi = {
    update: vi.fn(
      async (
        groupId: number,
        updateProperties: { title?: string; color?: ChromeGroupColor },
      ): Promise<FakeGroup> => {
        const group = groups.get(groupId);
        if (!group) {
          throw new Error(`fake chrome.tabGroups.update: unknown group ${groupId}`);
        }
        if (updateProperties.title !== undefined) group.title = updateProperties.title;
        if (updateProperties.color !== undefined) group.color = updateProperties.color;
        return group;
      },
    ),
    query: vi.fn(
      async (query: { windowId?: number }): Promise<FakeGroup[]> => {
        let list = [...groups.values()];
        if (query.windowId !== undefined) {
          list = list.filter((g) => g.windowId === query.windowId);
        }
        return list;
      },
    ),
  };

  const existingChrome =
    (globalThis as { chrome?: Record<string, unknown> }).chrome ?? {};
  vi.stubGlobal("chrome", {
    ...existingChrome,
    tabs: tabsApi,
    tabGroups: tabGroupsApi,
  });

  return {
    tabs,
    groups,
    seedTabs: (toAdd) => {
      for (const t of toAdd) tabs.set(t.id, { ...t });
    },
  };
}
