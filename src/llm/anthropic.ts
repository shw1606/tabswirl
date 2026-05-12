// Anthropic implementation of LlmProvider. All api.anthropic.com
// traffic lives here. (CLAUDE.md "Critical invariants" §5.) Callers
// should NOT import this file directly — go through src/llm/provider.ts
// so we can swap or add providers without touching the call sites.
//
// Wire protocol: raw `fetch` against the Anthropic Messages API with
// tool use. The SDK is intentionally not used — the MV3 service worker
// stays lean.
//
// Refs:
//   https://docs.anthropic.com/en/api/messages
//   https://docs.anthropic.com/en/docs/build-with-claude/tool-use
//
// Response validation enforces the four invariants from CLAUDE.md §5:
//   (1) every tab_id was in the input
//   (2) color ∈ the 9 ChromeGroupColor enum
//   (3) consistent group_name → color mapping
//   (4) assignments.length === inputs.length
//
// On any failure the caller receives a tagged error and is expected to
// fall back to "leave tabs ungrouped". This module never throws on
// remote / model failures.

import {
  CLASSIFY_TABS_TOOL,
  LLM_DEFAULTS,
  getIncrementalSystemPrompt,
  getIncrementalUserPrompt,
  getInitialSystemPrompt,
  getInitialUserPrompt,
  type ClassifyTabsToolInput,
  type ExistingGroup,
  type TabInput,
} from "./prompts";
// Types-only import — keeps the runtime cycle with provider.ts inert.
import type {
  ClassifyError,
  ClassifyOptions,
  ClassifyResult,
  LlmProvider,
} from "./provider";
import { validateAssignments } from "./validate";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const BYOK_STORAGE_KEY = "byok:anthropic";

// ============================================================
// BYOK key
// ============================================================

async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get(BYOK_STORAGE_KEY);
  const raw = result[BYOK_STORAGE_KEY];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

// ============================================================
// Response shape (subset we actually read)
// ============================================================

interface AnthropicMessagesResponse {
  content?: unknown[];
}

function extractToolInput(
  response: AnthropicMessagesResponse,
): ClassifyTabsToolInput | null {
  if (!Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (
      b["type"] === "tool_use" &&
      b["name"] === CLASSIFY_TABS_TOOL.name &&
      "input" in b
    ) {
      return b["input"] as ClassifyTabsToolInput;
    }
  }
  return null;
}

// Validation is shared across providers — see ./validate.ts.

// ============================================================
// Network
// ============================================================

interface AnthropicMessagesRequestBody {
  model: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: { role: "user"; content: string }[];
  tools: typeof CLASSIFY_TABS_TOOL[];
  tool_choice: { type: "tool"; name: string };
}

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: ClassifyOptions,
): Promise<
  | { ok: true; response: AnthropicMessagesResponse }
  | { ok: false; error: ClassifyError }
> {
  const body: AnthropicMessagesRequestBody = {
    model: options.model ?? LLM_DEFAULTS.model,
    max_tokens: LLM_DEFAULTS.max_tokens,
    temperature: LLM_DEFAULTS.temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    tools: [CLASSIFY_TABS_TOOL],
    tool_choice: { type: "tool", name: CLASSIFY_TABS_TOOL.name },
  };

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        // Required for direct browser/extension calls without a CORS proxy.
        // Ref: https://docs.anthropic.com/en/api/messages
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tabswirl] anthropic network error:", message);
    return { ok: false, error: { kind: "network", message } };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      "[tabswirl] anthropic http error",
      response.status,
      text.slice(0, 500),
    );
    return {
      ok: false,
      error: { kind: "http", status: response.status, body: text },
    };
  }

  const json = (await response.json()) as AnthropicMessagesResponse;
  return { ok: true, response: json };
}

// ============================================================
// Public entry points
// ============================================================

async function classify(
  systemPrompt: string,
  userPrompt: string,
  expectedTabIds: ReadonlySet<number>,
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.warn(
      "[tabswirl] no BYOK key set — classification skipped. " +
        "Set one via the options page (chrome.storage.local['byok:anthropic']).",
    );
    return { ok: false, error: { kind: "missing-key" } };
  }

  const call = await callAnthropic(apiKey, systemPrompt, userPrompt, options);
  if (!call.ok) {
    return { ok: false, error: call.error };
  }

  const toolInput = extractToolInput(call.response);
  if (!toolInput) {
    console.warn("[tabswirl] anthropic returned no tool_use block");
    return { ok: false, error: { kind: "no-tool-call" } };
  }

  const validated = validateAssignments(toolInput, expectedTabIds);
  if (!validated.ok) {
    console.warn("[tabswirl] validation failed:", validated.reason);
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
  return classify(
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
  return classify(
    getIncrementalSystemPrompt(options.language),
    getIncrementalUserPrompt(existingGroups, newTabs),
    new Set(newTabs.map((t) => t.id)),
    options,
  );
}

/**
 * LlmProvider implementation. Imported by src/llm/provider.ts's
 * getProvider factory.
 */
export const anthropicProvider: LlmProvider = {
  name: "anthropic",
  classifyInitial,
  classifyIncremental,
};
