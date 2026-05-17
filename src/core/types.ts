// Core data model. Mirrors PRD §7 verbatim.
//
// Anything stored in chrome.storage must be structured-cloneable
// (plain objects/arrays/primitives). No Map, Set, Date instances —
// see CLAUDE.md "Common traps" §5.

/**
 * The nine colors chrome.tabGroups.update accepts. Any other value throws.
 * Ref: https://developer.chrome.com/docs/extensions/reference/api/tabGroups#type-Color
 */
export type ChromeGroupColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan"
  | "orange";

export interface SavedTab {
  url: string;
  title: string;
  favIconUrl?: string;
}

export interface SavedGroup {
  name: string;
  color: ChromeGroupColor;
  tabs: SavedTab[];
}

export interface UngroupedBucket {
  tabs: SavedTab[];
}

/**
 * A Pouch is the long-term-memory unit. Stored as `pouch:<id>` in
 * chrome.storage.local; consumed (deleted) on Restore — see PRD §0,
 * CLAUDE.md "Critical invariants" §2.
 *
 * Tabs hold `url`, not chrome tab id, because tab ids do not survive
 * browser restart.
 */
export interface Pouch {
  id: string;
  createdAt: number;
  label?: string;
  sourceWindowTitle?: string;
  groups: SavedGroup[];
  ungrouped: UngroupedBucket;
  totalTabs: number;
}

/**
 * Which of the two AI tiers is attempted first when domain rules (Tier 1)
 * miss. Tier 1 (the curated domain table) always runs before either.
 *
 *   "on-device-first" — Chrome built-in AI (Gemini Nano), then BYOK.
 *                        Default: free, private, no network on a hit.
 *   "byok-first"      — your API key (Claude Haiku), then Chrome built-in.
 *                        Faster + more consistent if on-device is slow or
 *                        unavailable on your machine.
 *
 * The cascade implementation lives in src/llm/provider.ts (withCascade);
 * this type is the user-facing knob it reads from settings.
 */
export type Tier2Order = "on-device-first" | "byok-first";

export interface Settings {
  /** Mirrored from src/llm/provider.ts LlmProviderName. */
  llmProvider: "anthropic" | "gemini";
  /**
   * Optional model override. When omitted, each provider picks its own
   * default (claude-haiku-4-5 for Anthropic, gemini-2.5-flash-lite for
   * Gemini). A provider that doesn't recognize the model string falls
   * back to its default.
   */
  llmModel?: string;
  /** Order the two AI tiers are tried in. Default "on-device-first". */
  tier2Order: Tier2Order;
  autoClassifyEnabled: boolean;
  /** When false, only domain (not full URL) is sent to the LLM. */
  sendUrls: boolean;
  confirmBeforeRestore: boolean;
  confirmBeforeDiscard: boolean;
  language: "ko" | "en";
  /** When true, the SW emits [tabswirl:timing] logs for every classify
   *  step. Used to diagnose slow-path latency. Default false. */
  verboseTiming?: boolean;
}

export interface DomainCacheEntry {
  groupId: number;
  categoryName: string;
  color: ChromeGroupColor;
  lastUsed: number;
}
