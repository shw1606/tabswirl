// Tests for the facade in src/llm/provider.ts.
//
// Verifies the dispatch table and the default-when-omitted contract.
// The Anthropic-specific behavior is covered by tests/llm/anthropic.test.ts;
// here we only check that the facade routes calls to the right
// implementation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyIncremental,
  classifyInitial,
  getProvider,
  type LlmProviderName,
} from "../../src/llm/provider";
import { installChromeStorageMock } from "../helpers/chrome-storage";
import { installFetchMock } from "../helpers/fetch-mock";

function toolResponse(
  assignments: Array<{
    tab_id: number;
    group_name: string;
    color: string;
  }>,
) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "classify_tabs",
        input: {
          assignments: assignments.map((a) => ({ is_new_group: true, ...a })),
        },
      },
    ],
  };
}

describe("provider facade", () => {
  let storage: ReturnType<typeof installChromeStorageMock>;
  let net: ReturnType<typeof installFetchMock>;

  beforeEach(() => {
    storage = installChromeStorageMock();
    net = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getProvider("anthropic") returns the Anthropic implementation', () => {
    const provider = getProvider("anthropic");
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("anthropic");
  });

  it('classifyInitial routes to Anthropic when provider: "anthropic"', async () => {
    await storage.local.set({ "byok:anthropic": "sk-test" });
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "G", color: "blue" }]),
    });

    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en", provider: "anthropic" },
    );

    expect(result.ok).toBe(true);
    expect(net.requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it('classifyInitial routes to Gemini when provider: "gemini"', async () => {
    await storage.local.set({ "byok:gemini": "AIza-test" });
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
                          tab_id: 1,
                          group_name: "G",
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

    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en", provider: "gemini" },
    );

    expect(result.ok).toBe(true);
    expect(net.requests[0]?.url).toContain("generativelanguage.googleapis.com");
  });

  it("classifyInitial defaults to Anthropic when provider omitted", async () => {
    // chrome-ai cascade fires first but LanguageModel is absent in tests,
    // so it bounces immediately to the BYOK fallback (Anthropic by default).
    await storage.local.set({ "byok:anthropic": "sk-test" });
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "G", color: "blue" }]),
    });

    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en" }, // no provider
    );

    expect(result.ok).toBe(true);
    expect(net.requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("cascade tries chrome-ai first and falls back to Anthropic on chrome-ai miss", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test" });
    // Make chrome-ai look unavailable.
    vi.stubGlobal("LanguageModel", undefined);
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "G", color: "blue" }]),
    });

    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en", provider: "anthropic" },
    );

    expect(result.ok).toBe(true);
    // Anthropic was reached because chrome-ai bailed.
    expect(net.requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("cascade short-circuits when chrome-ai succeeds (no BYOK call)", async () => {
    // Provide a working LanguageModel mock.
    const fakeSession = {
      prompt: vi.fn(async () =>
        JSON.stringify({
          assignments: [
            {
              tab_id: 1,
              group_name: "Code",
              color: "purple",
              is_new_group: true,
            },
          ],
        }),
      ),
      destroy: vi.fn(),
    };
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => fakeSession),
    });

    // Anthropic key is set but should not be reached.
    await storage.local.set({ "byok:anthropic": "sk-should-not-be-used" });

    const result = await classifyInitial(
      [{ id: 1, title: "GH", domain: "github.com" }],
      { language: "en", provider: "anthropic" },
    );

    expect(result.ok).toBe(true);
    // No network request — chrome-ai handled it on-device.
    expect(net.requests).toHaveLength(0);
  });

  it('tier2Order "byok-first" hits BYOK before chrome-ai (chrome-ai not called)', async () => {
    // A *working* on-device model is present — but byok-first means it
    // must not be consulted while the BYOK call succeeds.
    const fakeSession = {
      prompt: vi.fn(async () =>
        JSON.stringify({
          assignments: [
            { tab_id: 1, group_name: "X", color: "blue", is_new_group: true },
          ],
        }),
      ),
      destroy: vi.fn(),
    };
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => fakeSession),
    });
    await storage.local.set({ "byok:anthropic": "sk-test" });
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "G", color: "blue" }]),
    });

    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en", provider: "anthropic", tier2Order: "byok-first" },
    );

    expect(result.ok).toBe(true);
    expect(net.requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    // On-device never touched — BYOK won the race.
    expect(fakeSession.prompt).not.toHaveBeenCalled();
  });

  it('tier2Order "byok-first" falls back to chrome-ai when BYOK has no key', async () => {
    const fakeSession = {
      prompt: vi.fn(async () =>
        JSON.stringify({
          assignments: [
            {
              tab_id: 1,
              group_name: "Code",
              color: "purple",
              is_new_group: true,
            },
          ],
        }),
      ),
      destroy: vi.fn(),
    };
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => fakeSession),
    });
    // No byok:anthropic key set → Anthropic returns missing-key, cascade
    // must fall through to the on-device model.

    const result = await classifyInitial(
      [{ id: 1, title: "GH", domain: "github.com" }],
      { language: "en", provider: "anthropic", tier2Order: "byok-first" },
    );

    expect(result.ok).toBe(true);
    expect(fakeSession.prompt).toHaveBeenCalled();
    // chrome-ai is on-device — no network at all.
    expect(net.requests).toHaveLength(0);
  });

  it('cascade does NOT loop when primary is "chrome-ai" itself', async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en", provider: "chrome-ai" },
    );
    // chrome-ai unavailable + primary is also chrome-ai → missing-key, no fallback.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("missing-key");
    expect(net.requests).toHaveLength(0);
  });

  it("returns unsupported-provider for an unregistered name", async () => {
    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en", provider: "openrouter" as unknown as LlmProviderName },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsupported-provider");
    if (result.error.kind !== "unsupported-provider") return;
    expect(result.error.provider).toBe("openrouter");
    expect(net.requests).toHaveLength(0);
  });

  it("classifyIncremental routes to the configured provider", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test" });
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "G", color: "blue" }]),
    });

    const result = await classifyIncremental(
      [],
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en", provider: "anthropic" },
    );

    expect(result.ok).toBe(true);
    expect(net.requests).toHaveLength(1);
    expect(net.requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");
  });
});
