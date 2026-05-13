// Chrome built-in Prompt API — on-device Gemini Nano.
//
// Lives behind `LanguageModel` (a SW-accessible global in Chrome 148+).
// Free, no key, no network. The model is the same 4GB Gemini Nano that
// Chrome ships internally. Output is plain text — no native function
// calling — so we ask for a strict JSON object via system prompt and
// parse it ourselves.
//
// Refs:
//   https://developer.chrome.com/docs/extensions/ai/prompt-api
//   https://developer.chrome.com/docs/ai/built-in
//
// Korean caveat: Chrome's officially supported output languages are
// en/es/ja/de/fr at time of writing. Korean is best-effort. The classifier
// still tries on KR users; if results are obviously wrong, cascade to
// the BYOK provider (handled in src/llm/cascade.ts).

import {
  CLASSIFY_TABS_TOOL,
  getIncrementalSystemPrompt,
  getIncrementalUserPrompt,
  getInitialSystemPrompt,
  getInitialUserPrompt,
  type ClassifyTabsToolInput,
  type ExistingGroup,
  type TabInput,
} from "./prompts";
import type {
  ClassifyOptions,
  ClassifyResult,
  LlmProvider,
} from "./provider";
import { validateAssignments } from "./validate";

// Chrome AI globals are not in @types/chrome yet — declare narrowly.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace globalThis {
    var LanguageModel:
      | {
          availability(): Promise<
            "unavailable" | "downloadable" | "downloading" | "available"
          >;
          create(options?: {
            initialPrompts?: Array<{ role: "system"; content: string }>;
            temperature?: number;
            topK?: number;
            outputLanguage?: string;
          }): Promise<ChromeAiSession>;
        }
      | undefined;
  }
}

interface ChromeAiSession {
  prompt(text: string): Promise<string>;
  destroy(): void;
}

const JSON_INSTRUCTION = `
Output format — STRICT:
- Reply with a single valid JSON object, no prose, no markdown fences.
- Shape: {"assignments":[{"tab_id":N,"group_name":"S","color":"C","is_new_group":B},…]}
- One entry per input tab, in any order.
- "color" MUST be one of: grey, blue, red, yellow, green, pink, purple, cyan, orange.
- Tabs sharing a group_name MUST share a color.
`;

/**
 * Check whether the on-device model is usable in this Chrome.
 * Returns true only when the model is fully downloaded and ready.
 */
export async function isChromeAiAvailable(): Promise<boolean> {
  const lm = globalThis.LanguageModel;
  if (!lm) return false;
  try {
    const status = await lm.availability();
    return status === "available";
  } catch {
    return false;
  }
}

function stripCodeFences(text: string): string {
  // Some models wrap JSON in ```json fences. Strip if present.
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return (fenced ? (fenced[1] ?? "") : text).trim();
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(stripCodeFences(text));
  } catch {
    return null;
  }
}

async function classifyOnce(
  systemPrompt: string,
  userPrompt: string,
  expectedTabIds: ReadonlySet<number>,
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  const lm = globalThis.LanguageModel;
  if (!lm) {
    return { ok: false, error: { kind: "missing-key" } };
  }

  let status: Awaited<ReturnType<typeof lm.availability>>;
  try {
    status = await lm.availability();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: "network", message } };
  }

  if (status !== "available") {
    // Treat downloadable/downloading/unavailable the same — the cascade
    // will move on. We use "missing-key" so the cascade's "soft failure"
    // logic kicks in without inventing a new error tag.
    console.debug(
      `[tabswirl] chrome-ai availability=${status} → not usable, cascading`,
    );
    return { ok: false, error: { kind: "missing-key" } };
  }

  let session: ChromeAiSession;
  try {
    session = await lm.create({
      initialPrompts: [
        {
          role: "system",
          content: systemPrompt + "\n" + JSON_INSTRUCTION,
        },
      ],
      temperature: 0.2,
      outputLanguage: options.language === "ko" ? "ko" : "en",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tabswirl] chrome-ai session create failed:", message);
    return { ok: false, error: { kind: "network", message } };
  }

  let raw: string;
  try {
    raw = await session.prompt(userPrompt);
  } catch (err) {
    session.destroy();
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tabswirl] chrome-ai prompt failed:", message);
    return { ok: false, error: { kind: "network", message } };
  } finally {
    session.destroy();
  }

  const parsed = safeJsonParse(raw);
  if (!parsed) {
    console.warn(
      "[tabswirl] chrome-ai returned unparseable text:",
      raw.slice(0, 300),
    );
    return { ok: false, error: { kind: "no-tool-call" } };
  }

  const validated = validateAssignments(
    parsed as ClassifyTabsToolInput,
    expectedTabIds,
  );
  if (!validated.ok) {
    console.warn("[tabswirl] chrome-ai validation failed:", validated.reason);
    return {
      ok: false,
      error: { kind: "validation", reason: validated.reason },
    };
  }

  return { ok: true, assignments: validated.assignments };
}

export async function classifyInitial(
  tabs: TabInput[],
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  return classifyOnce(
    getInitialSystemPrompt(options.language),
    getInitialUserPrompt(tabs),
    new Set(tabs.map((t) => t.id)),
    options,
  );
}

export async function classifyIncremental(
  existingGroups: ExistingGroup[],
  newTabs: TabInput[],
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  return classifyOnce(
    getIncrementalSystemPrompt(options.language),
    getIncrementalUserPrompt(existingGroups, newTabs),
    new Set(newTabs.map((t) => t.id)),
    options,
  );
}

// Reference the unused import so TS doesn't complain — used implicitly
// via the system prompt's tool-schema language.
void CLASSIFY_TABS_TOOL;

export const chromeAiProvider: LlmProvider = {
  name: "chrome-ai",
  classifyInitial,
  classifyIncremental,
};
