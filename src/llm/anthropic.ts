// All LLM traffic goes through this module. (CLAUDE.md "Critical
// invariants" §5.) No other file may call api.anthropic.com directly.
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

import type { ChromeGroupColor } from "../core/types";
import {
  CLASSIFY_TABS_TOOL,
  LLM_DEFAULTS,
  getIncrementalSystemPrompt,
  getIncrementalUserPrompt,
  getInitialSystemPrompt,
  getInitialUserPrompt,
  type ClassificationAssignment,
  type ClassifyTabsToolInput,
  type ExistingGroup,
  type Language,
  type TabInput,
} from "./prompts";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const BYOK_STORAGE_KEY = "byok:anthropic";

const ALLOWED_COLORS: ReadonlySet<string> = new Set<ChromeGroupColor>([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);

export type ClassifyError =
  | { kind: "missing-key" }
  | { kind: "network"; message: string }
  | { kind: "http"; status: number; body: string }
  | { kind: "no-tool-call" }
  | { kind: "validation"; reason: string };

export type ClassifyResult =
  | { ok: true; assignments: ClassificationAssignment[] }
  | { ok: false; error: ClassifyError };

export interface ClassifyOptions {
  language: Language;
  model?: string;
  /** Optional cancellation, e.g. when the SW is about to terminate. */
  signal?: AbortSignal;
}

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

// ============================================================
// Validation
// ============================================================

type ValidationOutcome =
  | { ok: true; assignments: ClassificationAssignment[] }
  | { ok: false; reason: string };

function validateAssignments(
  raw: unknown,
  expectedTabIds: ReadonlySet<number>,
): ValidationOutcome {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { assignments?: unknown }).assignments)
  ) {
    return { ok: false, reason: "missing assignments array" };
  }

  const assignments = (raw as { assignments: unknown[] }).assignments;

  if (assignments.length !== expectedTabIds.size) {
    return {
      ok: false,
      reason: `expected ${expectedTabIds.size} assignments, got ${assignments.length}`,
    };
  }

  const seenTabIds = new Set<number>();
  const groupColors = new Map<string, ChromeGroupColor>();
  const result: ClassificationAssignment[] = [];

  for (const a of assignments) {
    if (!a || typeof a !== "object") {
      return { ok: false, reason: "assignment is not an object" };
    }
    const r = a as Record<string, unknown>;

    if (
      typeof r["tab_id"] !== "number" ||
      typeof r["group_name"] !== "string" ||
      typeof r["color"] !== "string" ||
      typeof r["is_new_group"] !== "boolean"
    ) {
      return { ok: false, reason: "assignment field types" };
    }

    const tab_id = r["tab_id"];
    const group_name = r["group_name"];
    const color = r["color"];
    const is_new_group = r["is_new_group"];

    if (!expectedTabIds.has(tab_id)) {
      return { ok: false, reason: `unknown tab_id ${tab_id}` };
    }
    if (seenTabIds.has(tab_id)) {
      return { ok: false, reason: `duplicate tab_id ${tab_id}` };
    }
    seenTabIds.add(tab_id);

    if (!ALLOWED_COLORS.has(color)) {
      return { ok: false, reason: `invalid color "${color}"` };
    }
    const typedColor = color as ChromeGroupColor;

    const existing = groupColors.get(group_name);
    if (existing && existing !== typedColor) {
      return {
        ok: false,
        reason: `group "${group_name}" assigned both ${existing} and ${typedColor}`,
      };
    }
    groupColors.set(group_name, typedColor);

    result.push({ tab_id, group_name, color: typedColor, is_new_group });
  }

  return { ok: true, assignments: result };
}

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
