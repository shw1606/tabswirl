import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEBOUNCE_MS,
  _resetInMemoryTimers,
  enqueueTab,
  rehydrateQueue,
} from "../../src/background/classifier-queue";
import { seedDomainEntries } from "../../src/background/domain-cache";
import { installChromeStorageMock } from "../helpers/chrome-storage";
import { installChromeTabsMock, type ChromeTabsMock } from "../helpers/chrome-tabs";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock";

function toolResponse(
  assignments: Array<{
    tab_id: number;
    group_name: string;
    color: string;
    is_new_group?: boolean;
  }>,
) {
  return {
    content: [
      {
        type: "tool_use",
        id: `toolu_${Math.random()}`,
        name: "classify_tabs",
        input: {
          assignments: assignments.map((a) => ({
            is_new_group: true,
            ...a,
          })),
        },
      },
    ],
  };
}

function setup() {
  const storage = installChromeStorageMock();
  const tabs = installChromeTabsMock();
  const net = installFetchMock();
  return { storage, tabs, net };
}

describe("classifier-queue — fast path", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });

  afterEach(() => {
    _resetInMemoryTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("falls back to slow path when the cached group has been deleted (stale cache)", async () => {
    env.tabs.seedTabs([
      { id: 99, windowId: 10, groupId: -1, title: "Insta", url: "https://instagram.com/" },
    ]);
    // Seed a cache pointing at a group that never existed.
    await seedDomainEntries(10, [
      {
        domain: "instagram.com",
        groupId: 1459190572,
        categoryName: "Social",
        color: "pink",
      },
    ]);
    // No api key, so slow-path LLM call will silently fail — but we
    // can still observe the cache invalidation and queue write.
    vi.useFakeTimers();
    try {
      const result = await enqueueTab({
        tabId: 99,
        windowId: 10,
        title: "Insta",
        url: "https://instagram.com/",
        language: "en",
        provider: "anthropic",
      });

      // Returned the slow-path tag rather than the cache-hit tag.
      expect(result.path).toBe("queued");

      // Cache entry for instagram.com was evicted.
      const cache = (
        await env.storage.session.get("cache:domains:10")
      )["cache:domains:10"] as Record<string, unknown> | undefined;
      expect(cache?.["instagram.com"]).toBeUndefined();

      // Tab was enqueued for the slow path.
      const queue = (
        await env.storage.session.get("queue:incremental:10")
      )["queue:incremental:10"] as { tabs: { id: number }[] } | undefined;
      expect(queue?.tabs).toEqual([
        { id: 99, title: "Insta", domain: "instagram.com" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("joins an existing group immediately on cache hit — no LLM call", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: 500, title: "PG1", url: "https://postgresql.org/a" },
      { id: 2, windowId: 10, groupId: -1, title: "PG2", url: "https://postgresql.org/b" },
    ]);
    env.tabs.groups.set(500, { id: 500, windowId: 10, title: "Database", color: "blue" });

    await seedDomainEntries(10, [
      {
        domain: "postgresql.org",
        groupId: 500,
        categoryName: "Database",
        color: "blue",
      },
    ]);

    const result = await enqueueTab({
      tabId: 2,
      windowId: 10,
      title: "PG2",
      url: "https://postgresql.org/b",
      language: "en",
      provider: "anthropic",
    });

    expect(result.path).toBe("cache-hit");
    expect(env.net.requests).toHaveLength(0);
    expect(env.tabs.tabs.get(2)?.groupId).toBe(500);
  });
});

describe("classifier-queue — slow path", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetInMemoryTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("queues a single tab, fires after DEBOUNCE_MS, calls LLM once", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "New Site", url: "https://new.example.com/" },
    ]);

    env.net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "Misc", color: "grey" }]),
    });

    const r = await enqueueTab({
      tabId: 1,
      windowId: 10,
      title: "New Site",
      url: "https://new.example.com/",
      language: "en",
      provider: "anthropic",
    });
    expect(r.path).toBe("queued");
    expect(env.net.requests).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(env.net.requests).toHaveLength(1);
    expect(env.tabs.tabs.get(1)?.groupId).not.toBe(-1);

    // Domain cached after flush.
    const cache = (await env.storage.session.get("cache:domains:10"))[
      "cache:domains:10"
    ] as Record<string, { groupId: number }>;
    expect(cache["new.example.com"]).toBeTruthy();
  });

  it("batches multiple enqueues inside the debounce window into one LLM call", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example.com/" },
      { id: 2, windowId: 10, groupId: -1, title: "B", url: "https://b.example.com/" },
      { id: 3, windowId: 10, groupId: -1, title: "C", url: "https://c.example.com/" },
    ]);

    env.net.queueResponse({
      status: 200,
      body: toolResponse([
        { tab_id: 1, group_name: "Misc", color: "grey" },
        { tab_id: 2, group_name: "Misc", color: "grey" },
        { tab_id: 3, group_name: "Misc", color: "grey" },
      ]),
    });

    await enqueueTab({
      tabId: 1, windowId: 10, title: "A", url: "https://a.example.com/", language: "en",
      provider: "anthropic",
    });
    await vi.advanceTimersByTimeAsync(100);
    await enqueueTab({
      tabId: 2, windowId: 10, title: "B", url: "https://b.example.com/", language: "en",
      provider: "anthropic",
    });
    await vi.advanceTimersByTimeAsync(100);
    await enqueueTab({
      tabId: 3, windowId: 10, title: "C", url: "https://c.example.com/", language: "en",
      provider: "anthropic",
    });

    // None of those should have fired yet — each enqueue resets the timer.
    expect(env.net.requests).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(env.net.requests).toHaveLength(1);
    const body = env.net.requests[0]!.body as Record<string, unknown>;
    const userMsg = (body["messages"] as { content: string }[])[0]!.content;
    expect(userMsg).toContain("id=1");
    expect(userMsg).toContain("id=2");
    expect(userMsg).toContain("id=3");
  });

  it("re-enqueuing the same tab does not duplicate it in the prompt", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example.com/" },
    ]);

    env.net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "Misc", color: "grey" }]),
    });

    await enqueueTab({
      tabId: 1, windowId: 10, title: "A", url: "https://a.example.com/", language: "en",
      provider: "anthropic",
    });
    await enqueueTab({
      tabId: 1, windowId: 10, title: "A", url: "https://a.example.com/", language: "en",
      provider: "anthropic",
    });

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(env.net.requests).toHaveLength(1);
    const body = env.net.requests[0]!.body as Record<string, unknown>;
    const userMsg = (body["messages"] as { content: string }[])[0]!.content;
    // Only one id=1 entry in the formatted list.
    const matches = userMsg.match(/id=1\b/g);
    expect(matches).toHaveLength(1);
  });

  it("clears the queue and leaves tabs ungrouped when the LLM fails", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example.com/" },
    ]);
    env.net.queueResponse({ status: 500, body: { error: "boom" } });

    await enqueueTab({
      tabId: 1, windowId: 10, title: "A", url: "https://a.example.com/", language: "en",
      provider: "anthropic",
    });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(env.tabs.tabs.get(1)?.groupId).toBe(-1);
    // Queue should be empty (no retry on next tick).
    const queue = await env.storage.session.get("queue:incremental:10");
    expect(queue["queue:incremental:10"]).toBeUndefined();
  });

  it("classifies into an existing group by name (incremental continuity)", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 100, windowId: 10, groupId: 700, title: "Existing", url: "https://existing.example.com/" },
      { id: 1, windowId: 10, groupId: -1, title: "New", url: "https://new.example.com/" },
    ]);
    env.tabs.groups.set(700, { id: 700, windowId: 10, title: "Database", color: "blue" });

    env.net.queueResponse({
      status: 200,
      body: toolResponse([
        { tab_id: 1, group_name: "Database", color: "blue", is_new_group: false },
      ]),
    });

    await enqueueTab({
      tabId: 1, windowId: 10, title: "New", url: "https://new.example.com/", language: "en",
      provider: "anthropic",
    });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    // Reuses existing chrome groupId 700, doesn't make a new group.
    expect(env.tabs.tabs.get(1)?.groupId).toBe(700);
    expect(env.tabs.groups.size).toBe(1);
  });

  it("includes existing groups in the incremental prompt context", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 100, windowId: 10, groupId: 700, title: "PG", url: "https://postgresql.org/" },
      { id: 1, windowId: 10, groupId: -1, title: "New", url: "https://new.example.com/" },
    ]);
    env.tabs.groups.set(700, { id: 700, windowId: 10, title: "Database", color: "blue" });

    env.net.queueResponse({
      status: 200,
      body: toolResponse([
        { tab_id: 1, group_name: "Misc", color: "grey" },
      ]),
    });

    await enqueueTab({
      tabId: 1, windowId: 10, title: "New", url: "https://new.example.com/", language: "en",
      provider: "anthropic",
    });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    const body = env.net.requests[0]!.body as Record<string, unknown>;
    const userMsg = (body["messages"] as { content: string }[])[0]!.content;
    expect(userMsg).toContain("Database");
    expect(userMsg).toContain("postgresql.org");
  });
});

describe("classifier-queue — rehydrate (SW wake)", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetInMemoryTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("flushes immediately when scheduledAt has already passed", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example.com/" },
    ]);
    // Simulate a queue persisted before the SW went idle, with fire-at in the past.
    await env.storage.session.set({
      "queue:incremental:10": {
        tabs: [{ id: 1, title: "A", domain: "a.example.com" }],
        scheduledAt: Date.now() - 1000,
      },
    });

    env.net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "Misc", color: "grey" }]),
    });

    await rehydrateQueue({ language: "en", provider: "anthropic" });
    // The flush runs asynchronously; flush its microtasks.
    await vi.advanceTimersByTimeAsync(10);

    expect(env.net.requests).toHaveLength(1);
  });

  it("re-schedules when scheduledAt is still in the future", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example.com/" },
    ]);
    await env.storage.session.set({
      "queue:incremental:10": {
        tabs: [{ id: 1, title: "A", domain: "a.example.com" }],
        scheduledAt: Date.now() + 200,
      },
    });
    env.net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "Misc", color: "grey" }]),
    });

    await rehydrateQueue({ language: "en", provider: "anthropic" });
    expect(env.net.requests).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);
    expect(env.net.requests).toHaveLength(1);
  });
});
