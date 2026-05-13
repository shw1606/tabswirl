import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyIncremental,
  classifyInitial,
  isChromeAiAvailable,
} from "../../src/llm/chrome-ai";
import type { TabInput } from "../../src/llm/prompts";

interface FakeSession {
  prompt: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface LanguageModelMock {
  availability: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

function installLanguageModelMock(): {
  lm: LanguageModelMock;
  setAvailability: (s: string) => void;
  queueResponse: (s: string) => void;
  queueThrow: (e: Error) => void;
} {
  let availability = "available";
  const responseQueue: Array<{ text?: string; error?: Error }> = [];

  const lm: LanguageModelMock = {
    availability: vi.fn(async () => availability),
    create: vi.fn(async () => {
      const session: FakeSession = {
        prompt: vi.fn(async () => {
          const next = responseQueue.shift();
          if (!next) throw new Error("test: no queued response");
          if (next.error) throw next.error;
          return next.text ?? "";
        }),
        destroy: vi.fn(),
      };
      return session;
    }),
  };

  vi.stubGlobal("LanguageModel", lm);

  return {
    lm,
    setAvailability: (s) => {
      availability = s;
    },
    queueResponse: (s) => responseQueue.push({ text: s }),
    queueThrow: (e) => responseQueue.push({ error: e }),
  };
}

const sampleTabs: TabInput[] = [
  { id: 1, title: "GitHub", domain: "github.com" },
  { id: 2, title: "Random", domain: "random.example" },
];

describe("chrome-ai availability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when LanguageModel global is missing", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    expect(await isChromeAiAvailable()).toBe(false);
  });

  it('returns true only when availability() === "available"', async () => {
    const env = installLanguageModelMock();
    env.setAvailability("available");
    expect(await isChromeAiAvailable()).toBe(true);

    env.setAvailability("downloadable");
    expect(await isChromeAiAvailable()).toBe(false);

    env.setAvailability("downloading");
    expect(await isChromeAiAvailable()).toBe(false);

    env.setAvailability("unavailable");
    expect(await isChromeAiAvailable()).toBe(false);
  });
});

describe("chrome-ai classifyInitial", () => {
  let env: ReturnType<typeof installLanguageModelMock>;

  beforeEach(() => {
    env = installLanguageModelMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns missing-key when LanguageModel is not present", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result).toEqual({ ok: false, error: { kind: "missing-key" } });
  });

  it("returns missing-key when availability is not 'available'", async () => {
    env.setAvailability("downloadable");
    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("missing-key");
  });

  it("parses a clean JSON response", async () => {
    env.queueResponse(
      JSON.stringify({
        assignments: [
          { tab_id: 1, group_name: "Code", color: "purple", is_new_group: true },
          { tab_id: 2, group_name: "Misc", color: "grey", is_new_group: true },
        ],
      }),
    );

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0]?.color).toBe("purple");
  });

  it("strips ```json fences if the model wraps output", async () => {
    env.queueResponse(
      "```json\n" +
        JSON.stringify({
          assignments: [
            { tab_id: 1, group_name: "Code", color: "purple", is_new_group: true },
            { tab_id: 2, group_name: "Misc", color: "grey", is_new_group: true },
          ],
        }) +
        "\n```",
    );

    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(true);
  });

  it("returns no-tool-call when response is unparseable text", async () => {
    env.queueResponse("Sorry, I can't help with that.");
    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("no-tool-call");
  });

  it("returns validation error when the JSON shape is wrong", async () => {
    env.queueResponse(
      JSON.stringify({
        assignments: [
          { tab_id: 999, group_name: "X", color: "blue", is_new_group: true },
          { tab_id: 2, group_name: "X", color: "blue", is_new_group: true },
        ],
      }),
    );
    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
  });

  it("returns network error when the session throws", async () => {
    env.queueThrow(new Error("model crashed"));
    const result = await classifyInitial(sampleTabs, { language: "en" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("network");
  });

  it('passes outputLanguage: "ko" when language=ko', async () => {
    env.queueResponse(
      JSON.stringify({
        assignments: [
          { tab_id: 1, group_name: "코드", color: "purple", is_new_group: true },
          { tab_id: 2, group_name: "기타", color: "grey", is_new_group: true },
        ],
      }),
    );

    await classifyInitial(sampleTabs, { language: "ko" });
    const createCall = env.lm.create.mock.calls[0]?.[0];
    expect(createCall?.outputLanguage).toBe("ko");
  });
});

describe("chrome-ai classifyIncremental", () => {
  let env: ReturnType<typeof installLanguageModelMock>;

  beforeEach(() => {
    env = installLanguageModelMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes existing groups in the prompt", async () => {
    env.queueResponse(
      JSON.stringify({
        assignments: [
          { tab_id: 42, group_name: "Code", color: "purple", is_new_group: false },
        ],
      }),
    );

    await classifyIncremental(
      [
        {
          name: "Code",
          color: "purple",
          sample_tabs: [{ title: "GitHub", domain: "github.com" }],
        },
      ],
      [{ id: 42, title: "GitLab", domain: "gitlab.com" }],
      { language: "en" },
    );

    const promptText = env.lm.create.mock.calls[0]?.[0]?.initialPrompts?.[0]?.content as string;
    expect(promptText).toContain("INCREMENTAL");
    // User prompt has the existing group context
    const sessionMock = await env.lm.create.mock.results[0]?.value as FakeSession;
    const promptCall = sessionMock.prompt.mock.calls[0]?.[0] as string;
    expect(promptCall).toContain("Code");
    expect(promptCall).toContain("github.com");
    expect(promptCall).toContain("GitLab");
  });
});
