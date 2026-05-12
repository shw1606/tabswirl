// Settings read/write helpers. Single source for "is auto-classify enabled".
//
// Storage: chrome.storage.local under `settings:main` per PRD §6.4.

import type { Settings } from "./types";

const SETTINGS_KEY = "settings:main";

// Default to Gemini: 1,000 RPD free tier, no credit card. Anthropic is
// still available and selectable from the options page.
export const DEFAULT_SETTINGS: Settings = {
  llmProvider: "gemini",
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
