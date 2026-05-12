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

  it("classifyInitial routes to Anthropic when no provider is set (default)", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test" });
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "G", color: "blue" }]),
    });

    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en" },
    );

    expect(result.ok).toBe(true);
    // Confirm we actually hit api.anthropic.com via the Anthropic provider.
    expect(net.requests[0]?.url).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("classifyInitial routes to Anthropic when provider is set explicitly", async () => {
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
  });

  it("returns unsupported-provider for an unregistered name (defensive runtime branch)", async () => {
    // Bypass the type system to simulate a stale settings value that
    // points at a provider whose impl was removed / never added.
    const result = await classifyInitial(
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en", provider: "gemini" as unknown as LlmProviderName },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsupported-provider");
    if (result.error.kind !== "unsupported-provider") return;
    expect(result.error.provider).toBe("gemini");
    // No network call attempted.
    expect(net.requests).toHaveLength(0);
  });

  it("classifyIncremental routes to the same provider", async () => {
    await storage.local.set({ "byok:anthropic": "sk-test" });
    net.queueResponse({
      status: 200,
      body: toolResponse([{ tab_id: 1, group_name: "G", color: "blue" }]),
    });

    const result = await classifyIncremental(
      [],
      [{ id: 1, title: "A", domain: "a.example" }],
      { language: "en" },
    );

    expect(result.ok).toBe(true);
    expect(net.requests).toHaveLength(1);
  });
});
