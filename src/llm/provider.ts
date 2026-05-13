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

// Gemini's free tier (1,000 RPD, no credit card) is the lowest-friction
// default. Anthropic stays available for users who prefer it.
const DEFAULT_PROVIDER: LlmProviderName = "gemini";

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
  const name = options.provider ?? DEFAULT_PROVIDER;
  const provider = getProvider(name);
  if (!provider) {
    return {
      ok: false,
      error: { kind: "unsupported-provider", provider: name },
    };
  }
  return provider.classifyInitial(tabs, options);
}

export async function classifyIncremental(
  existingGroups: ExistingGroup[],
  newTabs: TabInput[],
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  const name = options.provider ?? DEFAULT_PROVIDER;
  const provider = getProvider(name);
  if (!provider) {
    return {
      ok: false,
      error: { kind: "unsupported-provider", provider: name },
    };
  }
  return provider.classifyIncremental(existingGroups, newTabs, options);
}
