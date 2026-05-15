import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_SIZE,
  classifyAllOpenTabs,
} from "../../src/background/initial-classifier";
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

// Composite mock that bolts tabs/tabGroups onto the chrome stub that
// installChromeStorageMock already created. Order matters: storage
// first, then tabs (which preserves the existing chrome stub).
function fullEnv() {
  const storage = installChromeStorageMock();
  const tabs = installChromeTabsMock();
  return { storage, tabs };
}

describe("classifyAllOpenTabs", () => {
  let env: { storage: ReturnType<typeof installChromeStorageMock>; tabs: ChromeTabsMock };
  let net: FetchMock;

  beforeEach(() => {
    env = fullEnv();
    net = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates groups from a successful single-batch LLM response (rule-miss domains)", async () => {
    // These domains aren't in the Tier 1 rules table — the LLM must run.
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Niche DB", url: "https://niche-database.example/" },
      { id: 2, windowId: 10, groupId: -1, title: "Niche DB 2", url: "https://other-db.example/" },
      { id: 3, windowId: 10, groupId: -1, title: "Dev blog", url: "https://random-dev-blog.example/" },
    ]);
    net.queueResponse({
      status: 200,
      body: toolResponse([
        { tab_id: 1, group_name: "Database", color: "blue" },
        { tab_id: 2, group_name: "Database", color: "blue" },
        { tab_id: 3, group_name: "Code", color: "purple" },
      ]),
    });

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });

    expect(result.totalClassified).toBe(3);
    expect(result.totalErrors).toBe(0);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]).toMatchObject({
      windowId: 10,
      classified: 3,
      groupsCreated: 2,
      errors: 0,
    });

    const groups = [...env.tabs.groups.values()];
    expect(groups).toHaveLength(2);
    const byName = new Map(groups.map((g) => [g.title, g]));
    expect(byName.get("Database")?.color).toBe("blue");
    expect(byName.get("Code")?.color).toBe("purple");
    expect(env.tabs.tabs.get(1)?.groupId).toBe(byName.get("Database")!.id);
    expect(env.tabs.tabs.get(3)?.groupId).toBe(byName.get("Code")!.id);

    const cacheKey = "cache:domains:10";
    const cache = (await env.storage.session.get(cacheKey))[cacheKey] as Record<
      string,
      { groupId: number; categoryName: string }
    >;
    expect(Object.keys(cache).sort()).toEqual([
      "niche-database.example",
      "other-db.example",
      "random-dev-blog.example",
    ]);
  });

  it("applies Tier 1 rules without calling LLM when every tab matches a rule", async () => {
    // No BYOK key, no fetch queue — these tabs MUST be classified
    // without touching the LLM at all.
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "GH", url: "https://github.com/" },
      { id: 2, windowId: 10, groupId: -1, title: "YT", url: "https://youtube.com/" },
      { id: 3, windowId: 10, groupId: -1, title: "IG", url: "https://instagram.com/" },
    ]);

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });

    expect(result.totalClassified).toBe(3);
    expect(result.totalErrors).toBe(0);
    expect(net.requests).toHaveLength(0); // no LLM call

    // Three groups: Code, Video, Social.
    const groupTitles = [...env.tabs.groups.values()].map((g) => g.title).sort();
    expect(groupTitles).toEqual(["Code", "Social", "Video"]);

    // Cache seeded for each domain.
    const cacheKey = "cache:domains:10";
    const cache = (await env.storage.session.get(cacheKey))[cacheKey] as Record<
      string,
      { categoryName: string }
    >;
    expect(cache["github.com"]?.categoryName).toBe("Code");
    expect(cache["youtube.com"]?.categoryName).toBe("Video");
    expect(cache["instagram.com"]?.categoryName).toBe("Social");
  });

  it("rule-hit + LLM-hit with same category name merge into one chrome group", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "GH", url: "https://github.com/" }, // rule → Code
      { id: 2, windowId: 10, groupId: -1, title: "Niche", url: "https://niche-dev.example/" }, // LLM → Code
    ]);
    net.queueResponse({
      status: 200,
      body: toolResponse([
        { tab_id: 2, group_name: "Code", color: "purple" },
      ]),
    });

    await classifyAllOpenTabs({ language: "en", provider: "anthropic" });

    // Both tabs share the same group (rule's Code, not a new one).
    const id1 = env.tabs.tabs.get(1)?.groupId;
    const id2 = env.tabs.tabs.get(2)?.groupId;
    expect(id1).toBe(id2);
    // Exactly one group exists in the window.
    expect(env.tabs.groups.size).toBe(1);
  });

  it("skips classifiable-excluded tabs (incognito, pinned, internal URLs, empty title)", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Real", url: "https://example.com/" },
      { id: 2, windowId: 10, groupId: -1, title: "Incog", url: "https://example.com/", incognito: true },
      { id: 3, windowId: 10, groupId: -1, title: "Pin", url: "https://example.com/", pinned: true },
      { id: 4, windowId: 10, groupId: -1, title: "Internal", url: "chrome://settings/" },
      { id: 5, windowId: 10, groupId: -1, title: "", url: "https://loading.example.com/" },
    ]);

    net.queueResponse({
      status: 200,
      body: toolResponse([
        { tab_id: 1, group_name: "Misc", color: "grey" },
      ]),
    });

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });
    expect(result.totalClassified).toBe(1);

    // Only the single classifiable tab should have been in the prompt.
    const reqBody = net.requests[0]?.body as Record<string, unknown>;
    const userMsg = (reqBody?.["messages"] as { content: string }[])?.[0]?.content ?? "";
    expect(userMsg).toContain("id=1");
    expect(userMsg).not.toContain("id=2");
    expect(userMsg).not.toContain("id=3");
    expect(userMsg).not.toContain("id=4");
    expect(userMsg).not.toContain("id=5");
  });

  it("isolates per-window groups (two windows → two batches → groups don't cross)", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example/" },
      { id: 2, windowId: 20, groupId: -1, title: "B", url: "https://b.example/" },
    ]);
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "Cat", color: "blue" }]),
    });
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 2, group_name: "Cat", color: "red" }]),
    });

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });

    expect(result.windows).toHaveLength(2);
    expect(net.requests).toHaveLength(2);
    // The two windows produced two distinct chrome groups, even though
    // the LLM picked the same name — group ids are per-window.
    expect(env.tabs.groups.size).toBe(2);
    const groupWindows = new Set(
      [...env.tabs.groups.values()].map((g) => g.windowId),
    );
    expect(groupWindows).toEqual(new Set([10, 20]));
  });

  it("chunks windows with > CHUNK_SIZE tabs into multiple LLM batches", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    const tabCount = CHUNK_SIZE + 5;
    env.tabs.seedTabs(
      Array.from({ length: tabCount }, (_, i) => ({
        id: i + 1,
        windowId: 10,
        groupId: -1,
        title: `Tab ${i + 1}`,
        url: `https://example.com/${i + 1}`,
      })),
    );
    // Chunk 1: tab_ids 1..CHUNK_SIZE
    net.queueResponse({
      status: 200,
      body: toolResponse(
        Array.from({ length: CHUNK_SIZE }, (_, i) => ({
          tab_id: i + 1,
          group_name: "Bulk",
          color: "blue",
        })),
      ),
    });
    // Chunk 2: remaining 5
    net.queueResponse({
      status: 200,
      body: toolResponse(
        Array.from({ length: 5 }, (_, i) => ({
          tab_id: CHUNK_SIZE + 1 + i,
          group_name: "Bulk",
          color: "blue",
        })),
      ),
    });

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });
    expect(net.requests).toHaveLength(2);
    expect(result.totalClassified).toBe(tabCount);

    // Same group name across chunks → reused chrome groupId (only one group).
    const groupsForBulk = [...env.tabs.groups.values()].filter(
      (g) => g.title === "Bulk",
    );
    expect(groupsForBulk).toHaveLength(1);
  });

  it("falls back silently when LLM returns an http error — tabs stay ungrouped", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example/" },
    ]);
    net.queueResponse({ status: 500, body: { error: "boom" } });

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });

    expect(result.totalClassified).toBe(0);
    expect(result.totalErrors).toBe(1);
    expect(env.tabs.groups.size).toBe(0);
    expect(env.tabs.tabs.get(1)?.groupId).toBe(-1);
  });

  it("skips non-normal windows entirely (PWA / app / popup / panel / devtools)", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Normal", url: "https://normal.example/" },
      { id: 2, windowId: 20, groupId: -1, title: "PWA", url: "https://gemini.example/" },
    ]);
    env.tabs.seedWindow(20, "app"); // override window 20 to be a PWA
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "X", color: "blue" }]),
    });

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });

    // Only the normal window's batch is sent.
    expect(net.requests).toHaveLength(1);
    expect(result.windows.map((w) => w.windowId)).toEqual([10]);
    // PWA tab is left ungrouped.
    expect(env.tabs.tabs.get(2)?.groupId).toBe(-1);
  });

  it("isolates a crashing window from the rest (per-window try/catch)", async () => {
    await env.storage.local.set({ "byok:anthropic": "sk-test" });
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "Win10", url: "https://w10.example/" },
      { id: 2, windowId: 20, groupId: -1, title: "Win20", url: "https://w20.example/" },
    ]);
    // Window 10 succeeds.
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "X", color: "blue" }]),
    });
    // Window 20: LLM succeeds, but chrome.tabs.group throws as if it's a PWA
    // that slipped past the filter (defense-in-depth path).
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 2, group_name: "Y", color: "red" }]),
    });

    // Make chrome.tabs.group throw ONLY for window 20.
    const chromeAny = (globalThis as unknown as {
      chrome: { tabs: { group: ReturnType<typeof vi.fn> } };
    }).chrome;
    const originalGroup = chromeAny.tabs.group;
    chromeAny.tabs.group = vi.fn(async (options: chrome.tabs.GroupOptions) => {
      const wid = options.createProperties?.windowId;
      if (wid === 20) {
        throw new Error("Grouping is not supported by tabs in this window.");
      }
      return originalGroup(options);
    });

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });

    // Both windows were attempted; only window 10 actually grouped.
    expect(result.windows).toHaveLength(2);
    expect(env.tabs.groups.size).toBe(1);
    expect([...env.tabs.groups.values()][0]?.windowId).toBe(10);
  });

  it("falls back silently when no BYOK key is set", async () => {
    env.tabs.seedTabs([
      { id: 1, windowId: 10, groupId: -1, title: "A", url: "https://a.example/" },
    ]);
    // No queued response — fetch should never be called.

    const result = await classifyAllOpenTabs({ language: "en", provider: "anthropic" });

    expect(result.totalClassified).toBe(0);
    expect(result.totalErrors).toBe(1);
    expect(net.requests).toHaveLength(0);
  });
});
