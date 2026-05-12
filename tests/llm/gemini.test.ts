import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyIncremental,
  classifyInitial,
} from "../../src/llm/gemini";
import type { TabInput } from "../../src/llm/prompts";
import { installChromeStorageMock } from "../helpers/chrome-storage";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock";

const sampleTabs: TabInput[] = [
  { id: 1, title: "PostgreSQL Docs", domain: "postgresql.org" },
  { id: 2, title: "Redis Quickstart", domain: "redis.io" },
];

function goodGeminiResponse() {
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "classify_tabs",
                args: {
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
            },
          ],
        },
        finishReason: "STOP",
      },
    ],
  };
}

describe("gemini classifyInitial", () => {
  let storage: ReturnType<typeof installChromeStorageMock>;
  let net: FetchMock;

  beforeEach(() => {
    storage = installChromeStorageMock();
    net = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns missing-key when no Gemini BYOK key is set", async () => {
    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result).toEqual({ ok: false, error: { kind: "missing-key" } });
    expect(net.requests).toHaveLength(0);
  });

  it('reads ONLY from byok:gemini, not byok:anthropic', async () => {
    await storage.local.set({ "byok:anthropic": "sk-ant-test" });
    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("missing-key");
  });

  it("calls generateContent with the right shape and parses functionCall args", async () => {
    await storage.local.set({ "byok:gemini": "AIza-test-key" });
    net.queueResponse({ status: 200, body: goodGeminiResponse() });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0]).toMatchObject({
      tab_id: 1,
      group_name: "Database",
      color: "blue",
    });

    expect(net.requests).toHaveLength(1);
    const req = net.requests[0]!;
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
    );
    expect(req.method).toBe("POST");
    expect(req.headers["x-goog-api-key"]).toBe("AIza-test-key");
    expect(req.headers["content-type"]).toBe("application/json");

    const body = req.body as Record<string, unknown>;
    expect(body["systemInstruction"]).toBeDefined();
    expect(body["contents"]).toBeDefined();
    expect(body["toolConfig"]).toMatchObject({
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["classify_tabs"],
      },
    });
    const tools = body["tools"] as Array<{ functionDeclarations: unknown[] }>;
    expect(tools[0]?.functionDeclarations).toBeDefined();
  });

  it("honors options.model when it's a gemini- prefix", async () => {
    await storage.local.set({ "byok:gemini": "AIza-test-key" });
    net.queueResponse({ status: 200, body: goodGeminiResponse() });

    await classifyInitial(sampleTabs, {
      language: "en",
      model: "gemini-2.5-pro",
    });
    expect(net.requests[0]?.url).toContain("/gemini-2.5-pro:generateContent");
  });

  it("falls back to default model when options.model is not a gemini- id", async () => {
    await storage.local.set({ "byok:gemini": "AIza-test-key" });
    net.queueResponse({ status: 200, body: goodGeminiResponse() });

    // A stale Anthropic model name from settings.llmModel.
    await classifyInitial(sampleTabs, {
      language: "en",
      model: "claude-haiku-4-5",
    });
    expect(net.requests[0]?.url).toContain(
      "/gemini-2.5-flash-lite:generateContent",
    );
  });

  it("returns network error as a tagged error (no throw)", async () => {
    await storage.local.set({ "byok:gemini": "AIza-test-key" });
    net.queueResponse({ throwError: new Error("ECONNRESET") });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("network");
  });

  it("returns http error with the response body for non-2xx", async () => {
    await storage.local.set({ "byok:gemini": "AIza-test-key" });
    net.queueResponse({
      status: 400,
      body: { error: { code: 400, message: "API key not valid" } },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http");
    if (result.error.kind !== "http") return;
    expect(result.error.status).toBe(400);
    expect(result.error.body).toContain("API key not valid");
  });

  it("returns no-tool-call when the response has no functionCall part", async () => {
    await storage.local.set({ "byok:gemini": "AIza-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "I refuse to classify." }],
            },
            finishReason: "STOP",
          },
        ],
      },
    });

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("no-tool-call");
  });

  it("rejects assignments that fail the shared validator", async () => {
    await storage.local.set({ "byok:gemini": "AIza-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "classify_tabs",
                    args: {
                      assignments: [
                        {
                          tab_id: 999, // not in input
                          group_name: "X",
                          color: "blue",
                          is_new_group: true,
                        },
                        {
                          tab_id: 2,
                          group_name: "X",
                          color: "blue",
                          is_new_group: true,
                        },
                      ],
                    },
                  },
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
});

describe("gemini classifyIncremental", () => {
  let storage: ReturnType<typeof installChromeStorageMock>;
  let net: FetchMock;

  beforeEach(() => {
    storage = installChromeStorageMock();
    net = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes existing groups in the user message", async () => {
    await storage.local.set({ "byok:gemini": "AIza-test-key" });
    net.queueResponse({
      status: 200,
      body: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "classify_tabs",
                    args: {
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
          sample_tabs: [{ title: "PostgreSQL", domain: "postgresql.org" }],
        },
      ],
      [{ id: 42, title: "MySQL Reference", domain: "dev.mysql.com" }],
      { language: "en" },
    );

    expect(result.ok).toBe(true);
    const body = net.requests[0]!.body as Record<string, unknown>;
    const userPart = (body["contents"] as Array<{ parts: { text: string }[] }>)[0]!
      .parts[0]!.text;
    expect(userPart).toContain("Database");
    expect(userPart).toContain("postgresql.org");
    expect(userPart).toContain("MySQL Reference");
  });
});
