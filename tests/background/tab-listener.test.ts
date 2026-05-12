import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetInMemoryTimers } from "../../src/background/classifier-queue";
import { seedDomainEntries } from "../../src/background/domain-cache";
import {
  _resetForTests,
  markRestoring,
  registerTabListener,
} from "../../src/background/tab-listener";
import { _resetForTests as resetWindowTypeCache } from "../../src/background/window-type";
import { setSettings } from "../../src/core/settings";
import { installChromeStorageMock } from "../helpers/chrome-storage";
import {
  installChromeTabsMock,
  type ChromeTabsMock,
} from "../helpers/chrome-tabs";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock";

function setup() {
  const storage = installChromeStorageMock();
  const tabs = installChromeTabsMock();
  const net = installFetchMock();
  return { storage, tabs, net };
}

async function waitForMicrotasks(): Promise<void> {
  // The dispatched chain (getSettings → enqueueTab → readQueue → writeQueue)
  // has ~5 awaits and the listener wraps it in a fire-and-forget `void`.
  // A macrotask roundtrip is the most reliable way to let it settle.
  await new Promise<void>((r) => setTimeout(r, 0));
  for (let i = 0; i < 16; i++) await Promise.resolve();
}

describe("tab-listener", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
    _resetForTests();
    _resetInMemoryTimers();
    resetWindowTypeCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("registerTabListener subscribes exactly once even if called twice", () => {
    registerTabListener();
    registerTabListener();
    expect(env.tabs.onUpdatedListeners.size).toBe(1);
  });

  it("ignores onUpdated events without status=complete", async () => {
    registerTabListener();
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Loading", url: "https://example.com/" },
    ]);

    env.tabs.fireOnUpdated(1, { status: "loading" });
    await waitForMicrotasks();

    expect(env.net.requests).toHaveLength(0);
  });

  it("dispatches to the fast path on cache hit", async () => {
    registerTabListener();
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: 500, title: "Existing", url: "https://example.com/a" },
      { id: 2, windowId: 10, groupId: -1, title: "Same domain", url: "https://example.com/b" },
    ]);
    env.tabs.groups.set(500, { id: 500, windowId: 10, title: "Misc", color: "grey" });

    await seedDomainEntries(10, [
      { domain: "example.com", groupId: 500, categoryName: "Misc", color: "grey" },
    ]);

    env.tabs.fireOnUpdated(2, { status: "complete" });
    await waitForMicrotasks();

    expect(env.tabs.tabs.get(2)?.groupId).toBe(500);
    expect(env.net.requests).toHaveLength(0);
  });

  it("skips tabs marked as restoring (Critical invariant §3)", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    registerTabListener();
    env.tabs.seedTabs([
      { id: 99, windowId: 10, groupId: 700, title: "Restored", url: "https://restored.example.com/" },
    ]);
    env.tabs.groups.set(700, { id: 700, windowId: 10, title: "Restored", color: "blue" });

    markRestoring([99]);
    env.tabs.fireOnUpdated(99, { status: "complete" });
    await waitForMicrotasks();

    // Tab stayed in its restored group; no queue write either.
    expect(env.tabs.tabs.get(99)?.groupId).toBe(700);
    const queue = await env.storage.session.get("queue:incremental:10");
    expect(queue["queue:incremental:10"]).toBeUndefined();
  });

  it("skips non-classifiable tabs (incognito, pinned, internal URLs)", async () => {
    registerTabListener();
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Internal", url: "chrome://settings/" },
      { id: 2, windowId: 10, groupId: -1, title: "Pinned", url: "https://x.example.com/", pinned: true },
      { id: 3, windowId: 10, groupId: -1, title: "Incog", url: "https://y.example.com/", incognito: true },
    ]);

    env.tabs.fireOnUpdated(1, { status: "complete" });
    env.tabs.fireOnUpdated(2, { status: "complete" });
    env.tabs.fireOnUpdated(3, { status: "complete" });
    await waitForMicrotasks();

    const queue = await env.storage.session.get("queue:incremental:10");
    expect(queue["queue:incremental:10"]).toBeUndefined();
  });

  it("skips classification when autoClassifyEnabled is false", async () => {
    await setSettings({ autoClassifyEnabled: false });
    registerTabListener();
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example.com/" },
    ]);

    env.tabs.fireOnUpdated(1, { status: "complete" });
    await waitForMicrotasks();

    const queue = await env.storage.session.get("queue:incremental:10");
    expect(queue["queue:incremental:10"]).toBeUndefined();
  });

  it("skips tabs that live in a non-groupable (PWA / app) window", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    registerTabListener();
    env.tabs.seedTabs([
      { id: 1, windowId: 30, groupId: -1, title: "PWA Gemini", url: "https://gemini.example/" },
    ]);
    env.tabs.seedWindow(30, "app"); // mark as PWA

    env.tabs.fireOnUpdated(1, { status: "complete" });
    await waitForMicrotasks();

    // No queue write because we short-circuited.
    const queue = await env.storage.session.get("queue:incremental:30");
    expect(queue["queue:incremental:30"]).toBeUndefined();
  });

  it("queues a cache-miss tab (slow path)", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    registerTabListener();
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "New", url: "https://new.example.com/" },
    ]);

    env.tabs.fireOnUpdated(1, { status: "complete" });
    await waitForMicrotasks();

    const queue = await env.storage.session.get("queue:incremental:10");
    const state = queue["queue:incremental:10"] as { tabs: { id: number }[] };
    expect(state?.tabs).toEqual([
      { id: 1, title: "New", domain: "new.example.com" },
    ]);
  });
});
