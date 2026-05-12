import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTabsToGroup,
  applyGroup,
  snapshotWindowGroups,
  ungroupTabs,
} from "../../src/background/group-manager";
import { installChromeTabsMock, type ChromeTabsMock } from "../helpers/chrome-tabs";

describe("group-manager", () => {
  let mock: ChromeTabsMock;

  beforeEach(() => {
    mock = installChromeTabsMock();
    mock.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Postgres", url: "https://postgresql.org/" },
      { id: 2, windowId: 10, groupId: -1, title: "Redis", url: "https://redis.io/" },
      { id: 3, windowId: 10, groupId: -1, title: "GitHub", url: "https://github.com/" },
      { id: 4, windowId: 20, groupId: -1, title: "Other window", url: "https://other.example/" },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applyGroup creates a new group with the given name and color", async () => {
    const groupId = await applyGroup({
      windowId: 10,
      tabIds: [1, 2],
      name: "Database",
      color: "blue",
    });

    expect(groupId).not.toBeNull();
    if (groupId === null) return;

    const group = mock.groups.get(groupId);
    expect(group).toMatchObject({ title: "Database", color: "blue", windowId: 10 });
    expect(mock.tabs.get(1)?.groupId).toBe(groupId);
    expect(mock.tabs.get(2)?.groupId).toBe(groupId);
  });

  it("applyGroup returns null and is a no-op for empty tab list", async () => {
    const groupId = await applyGroup({
      windowId: 10,
      tabIds: [],
      name: "Empty",
      color: "grey",
    });
    expect(groupId).toBeNull();
    expect(mock.groups.size).toBe(0);
  });

  it("applyGroup extends an existing group when existingGroupId is set", async () => {
    const first = await applyGroup({
      windowId: 10,
      tabIds: [1],
      name: "Database",
      color: "blue",
    });
    expect(first).not.toBeNull();

    const second = await applyGroup({
      windowId: 10,
      tabIds: [2],
      name: "Database",
      color: "blue",
      existingGroupId: first!,
    });

    expect(second).toBe(first);
    expect(mock.tabs.get(2)?.groupId).toBe(first);
  });

  it("addTabsToGroup moves tabs into a known group", async () => {
    const groupId = await applyGroup({
      windowId: 10,
      tabIds: [1],
      name: "Database",
      color: "blue",
    });

    await addTabsToGroup(groupId!, [2, 3]);
    expect(mock.tabs.get(2)?.groupId).toBe(groupId);
    expect(mock.tabs.get(3)?.groupId).toBe(groupId);
  });

  it("addTabsToGroup is a no-op for empty list", async () => {
    await expect(addTabsToGroup(1, [])).resolves.toBeUndefined();
  });

  it("ungroupTabs detaches tabs from their group", async () => {
    const groupId = await applyGroup({
      windowId: 10,
      tabIds: [1, 2],
      name: "Database",
      color: "blue",
    });
    expect(mock.tabs.get(1)?.groupId).toBe(groupId);

    await ungroupTabs([1]);
    expect(mock.tabs.get(1)?.groupId).toBe(-1);
    expect(mock.tabs.get(2)?.groupId).toBe(groupId);
  });

  it("snapshotWindowGroups returns groups with sample tabs", async () => {
    const dbId = await applyGroup({
      windowId: 10,
      tabIds: [1, 2],
      name: "Database",
      color: "blue",
    });
    const codeId = await applyGroup({
      windowId: 10,
      tabIds: [3],
      name: "Code",
      color: "purple",
    });

    const snapshot = await snapshotWindowGroups(10);
    expect(snapshot).toHaveLength(2);

    const byId = new Map(snapshot.map((s) => [s.groupId, s]));
    expect(byId.get(dbId!)?.name).toBe("Database");
    expect(byId.get(dbId!)?.color).toBe("blue");
    expect(byId.get(dbId!)?.sampleTabs).toHaveLength(2);

    expect(byId.get(codeId!)?.name).toBe("Code");
    expect(byId.get(codeId!)?.sampleTabs).toHaveLength(1);
  });

  it("applyGroup returns null when chrome.tabs.group throws (e.g. PWA window)", async () => {
    mock.seedTabs([
      { id: 50, windowId: 30, groupId: -1, title: "PWA tab", url: "https://pwa.example/" },
    ]);
    // Override chrome.tabs.group to throw, mimicking a non-normal window.
    const chromeAny = (globalThis as unknown as {
      chrome: { tabs: { group: unknown } };
    }).chrome;
    chromeAny.tabs.group = vi.fn(async () => {
      throw new Error("Grouping is not supported by tabs in this window.");
    });

    const groupId = await applyGroup({
      windowId: 30,
      tabIds: [50],
      name: "X",
      color: "blue",
    });

    expect(groupId).toBeNull();
    // Tab is left untouched.
    expect(mock.tabs.get(50)?.groupId).toBe(-1);
  });

  it("addTabsToGroup logs and swallows when chrome.tabs.group throws", async () => {
    const chromeAny = (globalThis as unknown as {
      chrome: { tabs: { group: unknown } };
    }).chrome;
    chromeAny.tabs.group = vi.fn(async () => {
      throw new Error("Grouping is not supported by tabs in this window.");
    });

    await expect(addTabsToGroup(1000, [1])).resolves.toBeUndefined();
  });

  it("snapshotWindowGroups respects sampleTabCount cap", async () => {
    mock.seedTabs([
      { id: 100, windowId: 10, groupId: -1, title: "t100", url: "u" },
      { id: 101, windowId: 10, groupId: -1, title: "t101", url: "u" },
      { id: 102, windowId: 10, groupId: -1, title: "t102", url: "u" },
      { id: 103, windowId: 10, groupId: -1, title: "t103", url: "u" },
    ]);
    await applyGroup({
      windowId: 10,
      tabIds: [100, 101, 102, 103],
      name: "Big",
      color: "green",
    });

    const snapshot = await snapshotWindowGroups(10, 2);
    expect(snapshot[0]?.sampleTabs).toHaveLength(2);
  });
});
