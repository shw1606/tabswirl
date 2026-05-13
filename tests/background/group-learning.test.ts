import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDomainEntry } from "../../src/background/domain-cache";
import {
  _resetGroupLearningListenersForTests,
  registerGroupLearningListeners,
} from "../../src/background/group-learning";
import { _resetForTests as resetWindowTypeCache } from "../../src/background/window-type";
import { installChromeStorageMock } from "../helpers/chrome-storage";
import { installChromeTabsMock, type ChromeTabsMock } from "../helpers/chrome-tabs";

async function flush(): Promise<void> {
  // The listener registers a `void async () => { … }` IIFE inside the
  // event callback; let microtasks settle before assertions.
  await new Promise<void>((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function setup() {
  installChromeStorageMock();
  const tabs = installChromeTabsMock();
  _resetGroupLearningListenersForTests();
  resetWindowTypeCache();
  return { tabs };
}

describe("group-learning", () => {
  let env: { tabs: ChromeTabsMock };

  beforeEach(() => {
    env = setup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registerGroupLearningListeners is idempotent", () => {
    registerGroupLearningListeners();
    registerGroupLearningListeners();
    // Each listener API should have been called only once.
    expect(
      (chrome.tabs.onUpdated.addListener as unknown as { mock: { calls: unknown[] } })
        .mock.calls,
    ).toHaveLength(1);
    expect(
      (chrome.tabGroups.onUpdated.addListener as unknown as { mock: { calls: unknown[] } })
        .mock.calls,
    ).toHaveLength(1);
  });

  it("user moving a tab into a group updates the domain cache", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Doc", url: "https://example.com/x" },
    ]);
    env.tabs.groups.set(900, {
      id: 900,
      windowId: 10,
      title: "My Reading",
      color: "yellow",
    });

    registerGroupLearningListeners();

    // Simulate user dragging the tab into group 900.
    env.tabs.fireTabGroupIdChanged(1, 900);
    await flush();

    const entry = await getDomainEntry(10, "example.com");
    expect(entry).toMatchObject({
      groupId: 900,
      categoryName: "My Reading",
      color: "yellow",
    });
  });

  it("ignores moves to TAB_GROUP_ID_NONE (-1, ungrouped)", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: 900, title: "Doc", url: "https://example.com/x" },
    ]);
    env.tabs.groups.set(900, {
      id: 900,
      windowId: 10,
      title: "My Reading",
      color: "yellow",
    });

    registerGroupLearningListeners();
    env.tabs.fireTabGroupIdChanged(1, -1);
    await flush();

    // Cache unchanged.
    expect(await getDomainEntry(10, "example.com")).toBeNull();
  });

  it("ignores non-classifiable tabs (pinned, internal URL, etc)", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Settings", url: "chrome://settings/" },
    ]);
    env.tabs.groups.set(900, {
      id: 900,
      windowId: 10,
      title: "My Group",
      color: "blue",
    });

    registerGroupLearningListeners();
    env.tabs.fireTabGroupIdChanged(1, 900);
    await flush();

    expect(await getDomainEntry(10, "chrome://settings/")).toBeNull();
  });

  it("renaming/recoloring a group re-seeds cache entries for its tabs", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: 900, title: "GH", url: "https://github.com/" },
      { id: 2, windowId: 10, groupId: 900, title: "Stack", url: "https://stackoverflow.com/" },
      { id: 3, windowId: 10, groupId: 901, title: "Other", url: "https://other.example/" },
    ]);
    env.tabs.groups.set(900, {
      id: 900,
      windowId: 10,
      title: "Dev",
      color: "purple",
    });
    env.tabs.groups.set(901, {
      id: 901,
      windowId: 10,
      title: "Other",
      color: "blue",
    });

    registerGroupLearningListeners();

    // User renames group 900 from "Dev" to "Work" and recolors green.
    const g = env.tabs.groups.get(900)!;
    g.title = "Work";
    g.color = "green";
    env.tabs.fireTabGroupUpdated(900);
    await flush();

    expect((await getDomainEntry(10, "github.com"))).toMatchObject({
      categoryName: "Work",
      color: "green",
      groupId: 900,
    });
    expect((await getDomainEntry(10, "stackoverflow.com"))).toMatchObject({
      categoryName: "Work",
      color: "green",
    });
    // Tabs in the other group are not touched.
    expect(await getDomainEntry(10, "other.example")).toBeNull();
  });
});
