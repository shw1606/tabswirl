// LLM provider abstraction. The rest of the codebase imports the
// facade functions (classifyInitial / classifyIncremental) from this
// module — never from a specific provider. Switching providers, or
// adding a new one (Gemini, OpenRouter, Chrome's built-in Prompt API),
// is a localized change: implement LlmProvider, register in
// getProvider().
//
// Why a facade rather than callers picking a provider themselves: the
// provider choice is a user setting that flows through
// settings.llmProvider. We don't want every classify call site to
// re-read settings. Callers pass `options.provider` through from
// whatever they already read from settings, and the facade dispatches.
//
// PRD §6.6 lists this file as the canonical place for the interface.

import { anthropicProvider } from "./anthropic";
import { chromeAiProvider } from "./chrome-ai";
import { geminiProvider } from "./gemini";
import type {
  ClassificationAssignment,
  ExistingGroup,
  Language,
  TabInput,
} from "./prompts";

/**
 * Tag for one of the configured LLM backends. Expand this union when a
 * new provider is registered in getProvider().
 */
export type LlmProviderName = "anthropic" | "gemini" | "chrome-ai";

export type ClassifyError =
  | { kind: "missing-key" }
  | { kind: "network"; message: string }
  | { kind: "http"; status: number; body: string }
  | { kind: "no-tool-call" }
  | { kind: "validation"; reason: string }
  | { kind: "unsupported-provider"; provider: string };

export type ClassifyResult =
  | { ok: true; assignments: ClassificationAssignment[] }
  | { ok: false; error: ClassifyError };

export interface ClassifyOptions {
  language: Language;
  /** Provider-specific model identifier. Provider picks a default when omitted. */
  model?: string;
  /** Optional cancellation, e.g. when the SW is about to terminate. */
  signal?: AbortSignal;
  /** Defaults to "anthropic" when omitted. */
  provider?: LlmProviderName;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  classifyInitial(
    tabs: TabInput[],
    options: ClassifyOptions,
  ): Promise<ClassifyResult>;
  classifyIncremental(
    existingGroups: ExistingGroup[],
    newTabs: TabInput[],
    options: ClassifyOptions,
  ): Promise<ClassifyResult>;
}

// Anthropic Claude Haiku 4.5 is the default BYOK provider:
//   - market #1 AI tab classifier (jkainmm AI Tab Organizer) uses the same model
//   - ~500-1500ms latency, predictable; no free-tier rate-limit surprises
//   - ~$0.01/mo at typical use
// Chrome built-in (chrome-ai) is tried *before* the BYOK provider via the
// cascade in classifyInitial / classifyIncremental — see withCascade
// below. So zero-config Chrome 148+ users get on-device classification for
// free, and the BYOK key only kicks in when chrome-ai is unavailable or
// returns something we can't validate.
//
// Gemini (free tier) is kept in the type union and factory for users who
// explicitly opt in via storage, but it's hidden from the options UI —
// 15-20 RPM rate limit is too tight for continuous tab classification.
const DEFAULT_PROVIDER: LlmProviderName = "anthropic";

/**
 * Try Chrome's on-device LanguageModel first (when it's not the chosen
 * primary), then fall back to the BYOK provider on miss/failure. This is
 * the Tier 2 → Tier 3 cascade.
 */
async function withCascade(
  primary: LlmProviderName,
  call: (provider: LlmProvider) => Promise<ClassifyResult>,
): Promise<ClassifyResult> {
  if (primary !== "chrome-ai") {
    const chromeAi = getProvider("chrome-ai");
    if (chromeAi) {
      const result = await call(chromeAi);
      if (result.ok) return result;
      // Any chrome-ai failure (unavailable, validation, parse) falls
      // through to the primary provider.
    }
  }
  const provider = getProvider(primary);
  if (!provider) {
    return {
      ok: false,
      error: { kind: "unsupported-provider", provider: primary },
    };
  }
  return call(provider);
}

/**
 * Look up the implementation for a given provider tag. Returns null
 * when the name has no registered backend — callers turn that into the
 * `unsupported-provider` error result.
 */
export function getProvider(name: LlmProviderName): LlmProvider | null {
  switch (name) {
    case "anthropic":
      return anthropicProvider;
    case "gemini":
      return geminiProvider;
    case "chrome-ai":
      return chromeAiProvider;
    default:
      return null;
  }
}

export async function classifyInitial(
  tabs: TabInput[],
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  const primary = options.provider ?? DEFAULT_PROVIDER;
  return withCascade(primary, (p) => p.classifyInitial(tabs, options));
}

export async function classifyIncremental(
  existingGroups: ExistingGroup[],
  newTabs: TabInput[],
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  const primary = options.provider ?? DEFAULT_PROVIDER;
  return withCascade(primary, (p) =>
    p.classifyIncremental(existingGroups, newTabs, options),
  );
}
