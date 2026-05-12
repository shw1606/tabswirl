// CRUD over Pouch objects in chrome.storage.local.
//
// Storage layout (PRD §6.4):
//   pouch:<id>      → Pouch
//   pouches:index   → string[]   (pouch ids, newest first)
//
// chrome.storage.local is the only acceptable backing store for Pouches.
// Putting them in chrome.storage.session would lose data on browser
// restart — a P0 violation of the consume-on-restore semantic.
// See CLAUDE.md "Critical invariants" §1.

import type { Pouch, SavedGroup, UngroupedBucket } from "./types";

const POUCH_KEY_PREFIX = "pouch:";
const POUCHES_INDEX_KEY = "pouches:index";

const pouchKey = (id: string): string => `${POUCH_KEY_PREFIX}${id}`;

export interface PouchCreateInput {
  groups: SavedGroup[];
  ungrouped: UngroupedBucket;
  label?: string;
  sourceWindowTitle?: string;
}

async function readIndex(): Promise<string[]> {
  const result = await chrome.storage.local.get(POUCHES_INDEX_KEY);
  const raw = result[POUCHES_INDEX_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

async function writeIndex(ids: string[]): Promise<void> {
  await chrome.storage.local.set({ [POUCHES_INDEX_KEY]: ids });
}

function countTabs(input: PouchCreateInput): number {
  const groupTabs = input.groups.reduce((acc, g) => acc + g.tabs.length, 0);
  return groupTabs + input.ungrouped.tabs.length;
}

export async function createPouch(input: PouchCreateInput): Promise<Pouch> {
  const pouch: Pouch = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    label: input.label,
    sourceWindowTitle: input.sourceWindowTitle,
    groups: input.groups,
    ungrouped: input.ungrouped,
    totalTabs: countTabs(input),
  };

  const index = await readIndex();
  await chrome.storage.local.set({
    [pouchKey(pouch.id)]: pouch,
    [POUCHES_INDEX_KEY]: [pouch.id, ...index.filter((id) => id !== pouch.id)],
  });

  return pouch;
}

export async function getPouch(id: string): Promise<Pouch | null> {
  const key = pouchKey(id);
  const result = await chrome.storage.local.get(key);
  const value = result[key];
  return value ? (value as Pouch) : null;
}

/**
 * Returns pouches in index order (newest first). If the index references
 * an id whose backing pouch is missing, the index is repaired in place.
 */
export async function listPouches(): Promise<Pouch[]> {
  const index = await readIndex();
  if (index.length === 0) return [];

  const result = await chrome.storage.local.get(index.map(pouchKey));

  const pouches: Pouch[] = [];
  const surviving: string[] = [];
  for (const id of index) {
    const value = result[pouchKey(id)];
    if (value) {
      pouches.push(value as Pouch);
      surviving.push(id);
    }
  }

  if (surviving.length !== index.length) {
    await writeIndex(surviving);
  }

  return pouches;
}

/**
 * Idempotent. Used by both explicit Discard (F5) and consume-on-restore
 * (F4). Removes the pouch's backing record and prunes its id from the
 * index in a single logical step.
 */
export async function removePouch(id: string): Promise<void> {
  await chrome.storage.local.remove(pouchKey(id));
  const index = await readIndex();
  const next = index.filter((existing) => existing !== id);
  if (next.length !== index.length) {
    await writeIndex(next);
  }
}
