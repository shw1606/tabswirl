// Settings read/write helpers. Single source for "is auto-classify enabled".
//
// Storage: chrome.storage.local under `settings:main` per PRD §6.4.

import type { Settings } from "./types";

const SETTINGS_KEY = "settings:main";

// Default to Anthropic — same model the #1 AI tab classifier on Web Store
// uses. Chrome built-in AI is tried first automatically via the cascade
// in src/llm/provider.ts; this default only controls the BYOK fallback.
// Gemini is still selectable via storage for power users but hidden from
// the options UI (15-20 RPM rate limit makes it impractical for
// continuous tab classification).
export const DEFAULT_SETTINGS: Settings = {
  llmProvider: "anthropic",
  tier2Order: "on-device-first",
  autoClassifyEnabled: true,
  sendUrls: false,
  confirmBeforeRestore: true,
  confirmBeforeDiscard: true,
  language: "en",
};

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = result[SETTINGS_KEY];
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) };
}

export async function setSettings(next: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged: Settings = { ...current, ...next };
  // When the user switches provider, drop the now-irrelevant llmModel
  // override so the new provider picks its own default. Each provider
  // also defensively ignores model strings it doesn't recognize, so
  // this is belt-and-suspenders.
  if (
    next.llmProvider !== undefined &&
    next.llmProvider !== current.llmProvider
  ) {
    delete merged.llmModel;
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}
