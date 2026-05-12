import { describe, expect, it } from "vitest";
import { allTabIds, buildTabTree } from "../../src/popup/tab-tree";

function tab(overrides: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    id: 1,
    windowId: 10,
    groupId: -1,
    title: "Tab",
    url: "https://example.com",
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

describe("buildTabTree", () => {
  it("groups tabs by chrome groupId; everything else goes to ungrouped", () => {
    const tree = buildTabTree({
      tabs: [
        tab({ id: 1, groupId: 100, title: "PG", url: "https://postgresql.org/" }),
        tab({ id: 2, groupId: 100, title: "Redis", url: "https://redis.io/" }),
        tab({ id: 3, groupId: -1, title: "Misc", url: "https://example.com/" }),
      ],
      groups: [{ id: 100, title: "Database", color: "blue" }],
    });

    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0]?.name).toBe("Database");
    expect(tree.groups[0]?.tabs.map((t) => t.id)).toEqual([1, 2]);
    expect(tree.ungrouped.map((t) => t.id)).toEqual([3]);
  });

  it("falls back to 'Untitled' for groups with no title", () => {
    const tree = buildTabTree({
      tabs: [tab({ id: 1, groupId: 100 })],
      groups: [{ id: 100, title: "", color: "grey" }],
    });
    expect(tree.groups[0]?.name).toBe("Untitled");
  });

  it("keeps a group entry even when it has zero tabs", () => {
    const tree = buildTabTree({
      tabs: [],
      groups: [{ id: 100, title: "Empty", color: "grey" }],
    });
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0]?.tabs).toEqual([]);
  });

  it("preserves favIconUrl", () => {
    const tree = buildTabTree({
      tabs: [tab({ id: 1, favIconUrl: "https://x.example/icon.png" })],
      groups: [],
    });
    expect(tree.ungrouped[0]?.favIconUrl).toBe("https://x.example/icon.png");
  });

  it("allTabIds collects all ids across groups and ungrouped", () => {
    const tree = buildTabTree({
      tabs: [
        tab({ id: 1, groupId: 100 }),
        tab({ id: 2, groupId: 100 }),
        tab({ id: 3, groupId: -1 }),
      ],
      groups: [{ id: 100, title: "G", color: "blue" }],
    });
    expect(allTabIds(tree).sort()).toEqual([1, 2, 3]);
  });
});
