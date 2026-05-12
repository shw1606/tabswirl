import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyIncremental,
  classifyInitial,
} from "../../src/llm/anthropic";
import type { TabInput } from "../../src/llm/prompts";
import { installChromeStorageMock } from "../helpers/chrome-storage";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock";

const sampleTabs: TabInput[] = [
  { id: 1, title: "PostgreSQL Docs", domain: "postgresql.org" },
  { id: 2, title: "Redis Quickstart", domain: "redis.io" },
];

function goodToolResponse() {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "classify_tabs",
        input: {
          assignments: [
            {
              tab_id: 1,
              group_name: "Database",
              color: "blue",
              is_new_group: true,
            },
            {
              tab_id: 2,
              group_name: "Database",
              color: "blue",
              is_new_group: true,
            },
          ],
        },
      },
    ],
  };
}

describe("classifyInitial", () => {
  let storage: ReturnType<typeof installChromeStorageMock>;
  let net: FetchMock;

  beforeEach(() => {
    storage = installChromeStorageMock();
    net = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns missing-key when no BYOK key is set", async () => {
    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result).toEqual({ ok: false, error: { kind: "missing-key" } });
    expect(net.requests).toHaveLength(0);
  });

  it("calls the Messages API with the right shape and returns parsed assignments", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({ status: 200, body: goodToolResponse() });

    const result = await classifyInitial(sampleTabs, { language: "en" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0]).toMatchObject({
      tab_id: 1,
      group_name: "Database",
      color: "blue",
      is_new_group: true,
    });

    expect(net.requests).toHaveLength(1);
    const req = net.requests[0]!;
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.method).toBe("POST");
    expect(req.headers["x-api-key"]).toBe("sk-test-key");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.headers["anthropic-dangerous-direct-browser-access"]).toBe(
      "true",
    );
    expect(req.headers["content-type"]).toBe("application/json");

    const body = req.body as Record<string, unknown>;
    expect(body["model"]).toBe("claude-haiku-4-5");
    expect(body["tool_choice"]).toEqual({
      type: "tool",
      name: "classify_tabs",
    });
    expect(Array.isArray(body["tools"])).toBe(true);
    expect(typeof body["system"]).toBe("string");
    expect((body["system"] as string).length).toBeGreaterThan(0);
  });

  it("treats network failures as a tagged error (no throw)", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({ throwError: new Error("ECONNRESET") });

    const result = await classifyInitial(sampleTabs, { language: "en" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("network");
  });

  it("treats non-2xx as a tagged http error with the body preserved", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({
      status: 429,
      body: { type: "error", error: { message: "rate_limit_error" } },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http");
    if (result.error.kind !== "http") return;
    expect(result.error.status).toBe(429);
    expect(result.error.body).toContain("rate_limit_error");
  });

  it("fails with no-tool-call when the response has no tool_use block", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({
      status: 200,
      body: { content: [{ type: "text", text: "I refuse to classify." }] },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("no-tool-call");
  });

  it("rejects responses with the wrong number of assignments", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "classify_tabs",
            input: {
              assignments: [
                {
                  tab_id: 1,
                  group_name: "Database",
                  color: "blue",
                  is_new_group: true,
                },
              ],
            },
          },
        ],
      },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
  });

  it("rejects assignments referencing tab_ids not in the input", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "classify_tabs",
            input: {
              assignments: [
                {
                  tab_id: 1,
                  group_name: "Database",
                  color: "blue",
                  is_new_group: true,
                },
                {
                  tab_id: 999,
                  group_name: "Other",
                  color: "red",
                  is_new_group: true,
                },
              ],
            },
          },
        ],
      },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    if (result.error.kind !== "validation") return;
    expect(result.error.reason).toMatch(/unknown tab_id/);
  });

  it("rejects invalid colors", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "classify_tabs",
            input: {
              assignments: [
                {
                  tab_id: 1,
                  group_name: "Database",
                  color: "blue",
                  is_new_group: true,
                },
                {
                  tab_id: 2,
                  group_name: "Other",
                  color: "magenta",
                  is_new_group: true,
                },
              ],
            },
          },
        ],
      },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    if (result.error.kind !== "validation") return;
    expect(result.error.reason).toMatch(/invalid color/);
  });

  it("rejects responses where the same group_name has inconsistent colors", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "classify_tabs",
            input: {
              assignments: [
                {
                  tab_id: 1,
                  group_name: "Database",
                  color: "blue",
                  is_new_group: true,
                },
                {
                  tab_id: 2,
                  group_name: "Database",
                  color: "red",
                  is_new_group: true,
                },
              ],
            },
          },
        ],
      },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    if (result.error.kind !== "validation") return;
    expect(result.error.reason).toMatch(/both blue and red|both red and blue/);
  });

  it("rejects duplicate tab_id entries", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "classify_tabs",
            input: {
              assignments: [
                {
                  tab_id: 1,
                  group_name: "Database",
                  color: "blue",
                  is_new_group: true,
                },
                {
                  tab_id: 1,
                  group_name: "Database",
                  color: "blue",
                  is_new_group: true,
                },
              ],
            },
          },
        ],
      },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    if (result.error.kind !== "validation") return;
    expect(result.error.reason).toMatch(/duplicate tab_id/);
  });
});

describe("classifyIncremental", () => {
  let storage: ReturnType<typeof installChromeStorageMock>;
  let net: FetchMock;

  beforeEach(() => {
    storage = installChromeStorageMock();
    net = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes existing groups in the prompt", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "classify_tabs",
            input: {
              assignments: [
                {
                  tab_id: 42,
                  group_name: "Database",
                  color: "blue",
                  is_new_group: false,
                },
              ],
            },
          },
        ],
      },
    });

    const result = await classifyIncremental(
      [
        {
          name: "Database",
          color: "blue",
          sample_tabs: [
            { title: "PostgreSQL", domain: "postgresql.org" },
          ],
        },
      ],
      [{ id: 42, title: "MySQL Reference", domain: "dev.mysql.com" }],
      { language: "en" },
    );

    expect(result.ok).toBe(true);
    expect(net.requests).toHaveLength(1);
    const userMessage = (net.requests[0]!.body as Record<string, unknown>)[
      "messages"
    ] as { role: string; content: string }[];
    expect(userMessage[0]!.content).toContain("Database");
    expect(userMessage[0]!.content).toContain("postgresql.org");
    expect(userMessage[0]!.content).toContain("MySQL Reference");
  });
});
