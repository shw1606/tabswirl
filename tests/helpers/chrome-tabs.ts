// Mock for chrome.tabs.group / chrome.tabGroups.update / .query / chrome.tabs.query.
// Also exposes a fakable chrome.tabs.onUpdated event for the tab-listener tests.
//
// Models the subset of behavior our code depends on:
//   - chrome.tabs.group returns a numeric groupId (auto-incremented)
//   - chrome.tabGroups.update sets title + color on the group
//   - chrome.tabGroups.query / chrome.tabs.query filter by windowId
//   - chrome.tabs.onUpdated.addListener can be triggered manually via fireOnUpdated
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

type OnUpdatedListener = (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
) => void;

export interface ChromeTabsMock {
  tabs: Map<number, FakeTab>;
  groups: Map<number, FakeGroup>;
  seedTabs: (tabs: FakeTab[]) => void;
  /** Trigger chrome.tabs.onUpdated for a given tab id with the in-memory tab data. */
  fireOnUpdated: (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
  ) => void;
  onUpdatedListeners: Set<OnUpdatedListener>;
}

export function installChromeTabsMock(): ChromeTabsMock {
  const tabs = new Map<number, FakeTab>();
  const groups = new Map<number, FakeGroup>();
  let nextGroupId = 1000;
  let nextAutoTabId = 9000;
  const onUpdatedListeners = new Set<OnUpdatedListener>();

  function fakeTabToChromeTab(t: FakeTab): chrome.tabs.Tab {
    return {
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
    } as chrome.tabs.Tab;
  }

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

    remove: vi.fn(async (tabIds: number | number[]): Promise<void> => {
      const list = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of list) tabs.delete(id);
    }),

    create: vi.fn(
      async (props: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> => {
        const id = nextAutoTabId++;
        const windowId = props.windowId ?? 1;
        const tab: FakeTab = {
          id,
          windowId,
          groupId: -1,
          title: "",
          url: props.url ?? "",
        };
        tabs.set(id, tab);
        return fakeTabToChromeTab(tab);
      },
    ),

    query: vi.fn(
      async (query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> => {
        let list = [...tabs.values()];
        if (query.windowId !== undefined) {
          list = list.filter((t) => t.windowId === query.windowId);
        }
        if (query.groupId !== undefined) {
          list = list.filter((t) => t.groupId === query.groupId);
        }
        return list.map(fakeTabToChromeTab);
      },
    ),

    onUpdated: {
      addListener: vi.fn((listener: OnUpdatedListener) => {
        onUpdatedListeners.add(listener);
      }),
      removeListener: vi.fn((listener: OnUpdatedListener) => {
        onUpdatedListeners.delete(listener);
      }),
    },
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
    onUpdatedListeners,
    seedTabs: (toAdd) => {
      for (const t of toAdd) tabs.set(t.id, { ...t });
    },
    fireOnUpdated: (tabId, changeInfo) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`fireOnUpdated: unknown tab ${tabId}`);
      for (const l of onUpdatedListeners) {
        l(tabId, changeInfo, fakeTabToChromeTab(tab));
      }
    },
  };
}
