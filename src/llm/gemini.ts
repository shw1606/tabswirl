// Google Gemini implementation of LlmProvider.
//
// Wire protocol: raw `fetch` against the Gemini Messages-equivalent
// (`generateContent`) with function calling. SDK intentionally not used —
// the MV3 service worker stays lean.
//
// Refs:
//   https://ai.google.dev/gemini-api/docs/function-calling
//   https://ai.google.dev/api/generate-content
//
// Free tier: Gemini 2.5 Flash-Lite — 1,000 RPD per key, no credit card
// required (https://ai.google.dev/gemini-api/docs/rate-limits). This is
// why Gemini is the default provider — users can be productive without
// any billing setup.
//
// Validation is shared with Anthropic — see ./validate.ts. This file
// just maps the Gemini wire format to/from the shared shape.

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
  ClassifyError,
  ClassifyOptions,
  ClassifyResult,
  LlmProvider,
} from "./provider";
import { validateAssignments } from "./validate";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const BYOK_STORAGE_KEY = "byok:gemini";
const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

// ============================================================
// BYOK key
// ============================================================

async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get(BYOK_STORAGE_KEY);
  const raw = result[BYOK_STORAGE_KEY];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function resolveModel(model: string | undefined): string {
  // settings.llmProvider can flip between providers but settings carries
  // a single model field. Only honor the override when it looks like a
  // Gemini model id; otherwise fall back to our default.
  if (model && model.startsWith("gemini-")) return model;
  return DEFAULT_MODEL;
}

// ============================================================
// Response shape (subset we actually read)
// ============================================================

interface GeminiFunctionCall {
  name?: string;
  args?: unknown;
}

interface GeminiPart {
  functionCall?: GeminiFunctionCall;
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
    role?: string;
  };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

function extractToolInput(
  response: GeminiResponse,
): ClassifyTabsToolInput | null {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const fc = part.functionCall;
    if (fc && fc.name === CLASSIFY_TABS_TOOL.name && "args" in fc) {
      return fc.args as ClassifyTabsToolInput;
    }
  }
  return null;
}

// ============================================================
// Network
// ============================================================

interface GeminiRequestBody {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: "user"; parts: { text: string }[] }[];
  tools: Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: typeof CLASSIFY_TABS_TOOL.input_schema;
    }>;
  }>;
  toolConfig: {
    functionCallingConfig: {
      mode: "ANY";
      allowedFunctionNames: string[];
    };
  };
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
  };
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal | undefined,
): Promise<
  | { ok: true; response: GeminiResponse }
  | { ok: false; error: ClassifyError }
> {
  const body: GeminiRequestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    tools: [
      {
        functionDeclarations: [
          {
            name: CLASSIFY_TABS_TOOL.name,
            description: CLASSIFY_TABS_TOOL.description,
            parameters: CLASSIFY_TABS_TOOL.input_schema,
          },
        ],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [CLASSIFY_TABS_TOOL.name],
      },
    },
    generationConfig: {
      temperature: DEFAULT_TEMPERATURE,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    },
  };

  const url = `${API_BASE}/${model}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Ref: https://ai.google.dev/gemini-api/docs/api-key
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tabswirl] gemini network error:", message);
    return { ok: false, error: { kind: "network", message } };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      "[tabswirl] gemini http error",
      response.status,
      text.slice(0, 500),
    );
    return {
      ok: false,
      error: { kind: "http", status: response.status, body: text },
    };
  }

  const json = (await response.json()) as GeminiResponse;
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
      "[tabswirl] no Gemini BYOK key set — classification skipped. " +
        "Get a free key at ai.google.dev (no credit card).",
    );
    return { ok: false, error: { kind: "missing-key" } };
  }

  const model = resolveModel(options.model);
  const call = await callGemini(
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    options.signal,
  );
  if (!call.ok) return { ok: false, error: call.error };

  const toolInput = extractToolInput(call.response);
  if (!toolInput) {
    console.warn(
      "[tabswirl] gemini returned no functionCall — check finishReason / safety filters",
    );
    return { ok: false, error: { kind: "no-tool-call" } };
  }

  const validated = validateAssignments(toolInput, expectedTabIds);
  if (!validated.ok) {
    console.warn("[tabswirl] gemini validation failed:", validated.reason);
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

export const geminiProvider: LlmProvider = {
  name: "gemini",
  classifyInitial,
  classifyIncremental,
};
