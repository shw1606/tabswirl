import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPouchBody, stashTabs } from "../../src/core/stash";
import { listPouches } from "../../src/core/pouch-store";
import { installChromeStorageMock } from "../helpers/chrome-storage";
import { installChromeTabsMock, type ChromeTabsMock } from "../helpers/chrome-tabs";

function tab(overrides: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    id: 1,
    windowId: 10,
    groupId: -1,
    title: "Tab",
    url: "https://example.com",
    favIconUrl: undefined,
    index: 0,
    pinned: false,
    highlighted: false,
    active: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    incognito: false,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe("buildPouchBody", () => {
  it("buckets selected tabs into their chrome groups", () => {
    const body = buildPouchBody({
      tabs: [
        tab({ id: 1, groupId: 100, title: "PG", url: "https://postgresql.org/" }),
        tab({ id: 2, groupId: 100, title: "Redis", url: "https://redis.io/" }),
        tab({ id: 3, groupId: 200, title: "GitHub", url: "https://github.com/" }),
        tab({ id: 4, groupId: -1, title: "Misc", url: "https://example.com/" }),
      ],
      groups: [
        { id: 100, title: "Database", color: "blue" },
        { id: 200, title: "Code", color: "purple" },
      ],
      selectedTabIds: [1, 2, 3, 4],
    });

    expect(body.groups).toHaveLength(2);
    const byName = new Map(body.groups.map((g) => [g.name, g]));
    expect(byName.get("Database")?.color).toBe("blue");
    expect(byName.get("Database")?.tabs.map((t) => t.url)).toEqual([
      "https://postgresql.org/",
      "https://redis.io/",
    ]);
    expect(byName.get("Code")?.tabs).toHaveLength(1);
    expect(body.ungrouped.tabs.map((t) => t.url)).toEqual([
      "https://example.com/",
    ]);
  });

  it("excludes unselected tabs", () => {
    const body = buildPouchBody({
      tabs: [
        tab({ id: 1, groupId: 100, title: "A", url: "https://a.example/" }),
        tab({ id: 2, groupId: 100, title: "B", url: "https://b.example/" }),
      ],
      groups: [{ id: 100, title: "G", color: "blue" }],
      selectedTabIds: [1],
    });

    expect(body.groups[0]?.tabs.map((t) => t.url)).toEqual([
      "https://a.example/",
    ]);
  });

  it("drops tabs with no usable URL", () => {
    const body = buildPouchBody({
      tabs: [
        tab({ id: 1, url: "", title: "Empty" }),
        tab({ id: 2, url: "https://valid.example/" }),
      ],
      groups: [],
      selectedTabIds: [1, 2],
    });

    expect(body.ungrouped.tabs).toHaveLength(1);
    expect(body.ungrouped.tabs[0]?.url).toBe("https://valid.example/");
  });

  it("falls back to 'Untitled' for groups with no title", () => {
    const body = buildPouchBody({
      tabs: [
        tab({ id: 1, groupId: 100, title: "A", url: "https://a.example/" }),
      ],
      groups: [{ id: 100, title: "", color: "blue" }],
      selectedTabIds: [1],
    });

    expect(body.groups[0]?.name).toBe("Untitled");
  });

  it("preserves favIconUrl", () => {
    const body = buildPouchBody({
      tabs: [
        tab({
          id: 1,
          groupId: 100,
          title: "A",
          url: "https://a.example/",
          favIconUrl: "https://a.example/icon.png",
        }),
      ],
      groups: [{ id: 100, title: "G", color: "blue" }],
      selectedTabIds: [1],
    });
    expect(body.groups[0]?.tabs[0]?.favIconUrl).toBe(
      "https://a.example/icon.png",
    );
  });
});

describe("stashTabs", () => {
  let tabsEnv: ChromeTabsMock;

  beforeEach(() => {
    installChromeStorageMock();
    tabsEnv = installChromeTabsMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists a Pouch and closes selected tabs by default", async () => {
    tabsEnv.seedTabs([
      { id: 1, windowId: 10, groupId: 100, title: "PG", url: "https://postgresql.org/" },
      { id: 2, windowId: 10, groupId: 100, title: "Redis", url: "https://redis.io/" },
      { id: 3, windowId: 10, groupId: -1, title: "Misc", url: "https://example.com/" },
    ]);

    const result = await stashTabs({
      tabs: [
        tab({ id: 1, groupId: 100, title: "PG", url: "https://postgresql.org/" }),
        tab({ id: 2, groupId: 100, title: "Redis", url: "https://redis.io/" }),
        tab({ id: 3, groupId: -1, title: "Misc", url: "https://example.com/" }),
      ],
      groups: [{ id: 100, title: "Database", color: "blue" }],
      selectedTabIds: [1, 2, 3],
      label: "morning",
    });

    expect(result.pouch.label).toBe("morning");
    expect(result.pouch.totalTabs).toBe(3);
    expect(result.closedTabIds.sort()).toEqual([1, 2, 3]);

    const list = await listPouches();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(result.pouch.id);
  });

  it("does not call chrome.tabs.remove when closeTabs is false", async () => {
    tabsEnv.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example/" },
    ]);

    const result = await stashTabs({
      tabs: [tab({ id: 1, groupId: -1, title: "A", url: "https://a.example/" })],
      groups: [],
      selectedTabIds: [1],
      closeTabs: false,
    });

    expect(result.closedTabIds).toEqual([]);
    expect(tabsEnv.tabs.has(1)).toBe(true);
  });

  it("does not close tabs that were filtered out (no url)", async () => {
    tabsEnv.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Empty", url: "" },
      { id: 2, windowId: 10, groupId: -1, title: "Valid", url: "https://valid.example/" },
    ]);

    const result = await stashTabs({
      tabs: [
        tab({ id: 1, groupId: -1, title: "Empty", url: "" }),
        tab({ id: 2, groupId: -1, title: "Valid", url: "https://valid.example/" }),
      ],
      groups: [],
      selectedTabIds: [1, 2],
    });

    expect(result.closedTabIds).toEqual([2]);
  });
});
