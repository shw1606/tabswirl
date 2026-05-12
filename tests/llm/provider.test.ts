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

  it('classifyInitial defaults to Gemini when provider omitted', async () => {
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
      { language: "en" }, // no provider
    );

    expect(result.ok).toBe(true);
    // Default flipped to Gemini in this commit; the request must hit Google.
    expect(net.requests[0]?.url).toContain("generativelanguage.googleapis.com");
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
