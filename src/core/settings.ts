// Settings read/write helpers. Single source for "is auto-classify enabled".
//
// Storage: chrome.storage.local under `settings:main` per PRD §6.4.

import type { Settings } from "./types";

const SETTINGS_KEY = "settings:main";

export const DEFAULT_SETTINGS: Settings = {
  llmProvider: "anthropic",
  llmModel: "claude-haiku-4-5",
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
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}
