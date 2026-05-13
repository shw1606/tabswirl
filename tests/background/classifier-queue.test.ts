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

describe("classifier-queue — Tier 1 (domain rules)", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });

  afterEach(() => {
    _resetInMemoryTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("rule hit on github.com classifies immediately without LLM", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "GitHub", url: "https://github.com/" },
    ]);

    const result = await enqueueTab({
      tabId: 1,
      windowId: 10,
      title: "GitHub",
      url: "https://github.com/",
      language: "en",
      provider: "anthropic",
    });

    expect(result.path).toBe("rule-hit");
    expect(env.net.requests).toHaveLength(0);

    // Tab was placed into a chrome group.
    const newGroupId = env.tabs.tabs.get(1)?.groupId;
    expect(newGroupId).not.toBe(-1);
    const group = env.tabs.groups.get(newGroupId!);
    expect(group?.title).toBe("Code");
    expect(group?.color).toBe("purple");

    // Cache was seeded — next visit takes T0 fast path.
    const cache = (await env.storage.session.get("cache:domains:10"))[
      "cache:domains:10"
    ] as Record<string, { groupId: number; categoryName: string }>;
    expect(cache["github.com"]).toBeDefined();
    expect(cache["github.com"]?.categoryName).toBe("Code");
  });

  it("rule hit uses Korean label when language=ko", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "유튜브", url: "https://www.youtube.com/" },
    ]);

    const result = await enqueueTab({
      tabId: 1,
      windowId: 10,
      title: "유튜브",
      url: "https://www.youtube.com/",
      language: "ko",
      provider: "anthropic",
    });

    expect(result.path).toBe("rule-hit");
    const gid = env.tabs.tabs.get(1)?.groupId;
    expect(env.tabs.groups.get(gid!)?.title).toBe("비디오");
  });

  it("subdomain walks to apex rule (docs.github.com → code)", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Docs", url: "https://docs.github.com/" },
    ]);

    const result = await enqueueTab({
      tabId: 1,
      windowId: 10,
      title: "Docs",
      url: "https://docs.github.com/",
      language: "en",
      provider: "anthropic",
    });

    expect(result.path).toBe("rule-hit");
  });

  it("falls through to slow path when domain doesn't match any rule", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Unknown", url: "https://totally-random-site.example/" },
    ]);

    const result = await enqueueTab({
      tabId: 1,
      windowId: 10,
      title: "Unknown",
      url: "https://totally-random-site.example/",
      language: "en",
      provider: "anthropic",
    });

    expect(result.path).toBe("queued");
  });

  it("cache hit beats rule hit (user's manual move sticks)", async () => {
    // Seed cache pointing github.com to a DIFFERENT (user-chosen) group.
    env.tabs.seedTabs([
      { id: 100, windowId: 10, groupId: 555, title: "My GH", url: "https://github.com/me" },
      { id: 1, windowId: 10, groupId: -1, title: "New GH", url: "https://github.com/me/repo" },
    ]);
    env.tabs.groups.set(555, { id: 555, windowId: 10, title: "My stuff", color: "yellow" });
    await seedDomainEntries(10, [
      {
        domain: "github.com",
        groupId: 555,
        categoryName: "My stuff",
        color: "yellow",
      },
    ]);

    const result = await enqueueTab({
      tabId: 1,
      windowId: 10,
      title: "New GH",
      url: "https://github.com/me/repo",
      language: "en",
      provider: "anthropic",
    });

    expect(result.path).toBe("cache-hit");
    // Tab joined the user's custom group, not the rule's default.
    expect(env.tabs.tabs.get(1)?.groupId).toBe(555);
  });
});

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

  it("falls back via Tier 1 rule when the cached group has been deleted (stale cache, rule-covered domain)", async () => {
    // instagram.com is covered by Tier 1 rules → social/pink. After
    // cache invalidation, the rule catches the tab without needing
    // the LLM. This is the common case.
    env.tabs.seedTabs([
      { id: 99, windowId: 10, groupId: -1, title: "Insta", url: "https://instagram.com/" },
    ]);
    await seedDomainEntries(10, [
      {
        domain: "instagram.com",
        groupId: 1459190572, // dead groupId
        categoryName: "Social",
        color: "pink",
      },
    ]);

    const result = await enqueueTab({
      tabId: 99,
      windowId: 10,
      title: "Insta",
      url: "https://instagram.com/",
      language: "en",
      provider: "anthropic",
    });

    // Stale T0 → T1 rule catches it.
    expect(result.path).toBe("rule-hit");

    // Cache was re-seeded with the new groupId (different from the dead one).
    const cache = (
      await env.storage.session.get("cache:domains:10")
    )["cache:domains:10"] as Record<string, { groupId: number }>;
    expect(cache["instagram.com"]?.groupId).not.toBe(1459190572);
  });

  it("falls back to slow path when the cached group has been deleted AND no Tier 1 rule matches", async () => {
    env.tabs.seedTabs([
      { id: 99, windowId: 10, groupId: -1, title: "Random", url: "https://nonexistent.example/" },
    ]);
    await seedDomainEntries(10, [
      {
        domain: "nonexistent.example",
        groupId: 1459190572,
        categoryName: "Misc",
        color: "grey",
      },
    ]);
    vi.useFakeTimers();
    try {
      const result = await enqueueTab({
        tabId: 99,
        windowId: 10,
        title: "Random",
        url: "https://nonexistent.example/",
        language: "en",
        provider: "anthropic",
      });

      expect(result.path).toBe("queued");

      const cache = (
        await env.storage.session.get("cache:domains:10")
      )["cache:domains:10"] as Record<string, unknown> | undefined;
      expect(cache?.["nonexistent.example"]).toBeUndefined();

      const queue = (
        await env.storage.session.get("queue:incremental:10")
      )["queue:incremental:10"] as { tabs: { id: number }[] } | undefined;
      expect(queue?.tabs).toEqual([
        { id: 99, title: "Random", domain: "nonexistent.example" },
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
