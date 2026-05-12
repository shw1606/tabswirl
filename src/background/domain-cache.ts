// Per-window domain → group cache. Backed by chrome.storage.session
// so it survives the SW going to sleep but vanishes on browser shutdown.
//
// Why session: a tab group's chrome `groupId` is only meaningful inside
// the browser session that minted it. Persisting across restart would
// hand out stale ids to chrome.tabGroups.* and silently fail. Also see
// CLAUDE.md "Critical invariants" §1.
//
// Ref: https://developer.chrome.com/docs/extensions/reference/api/storage#property-session
//      (chrome.storage.session: in-memory only, cleared on browser shutdown)

import type { ChromeGroupColor, DomainCacheEntry } from "../core/types";

const KEY_PREFIX = "cache:domains:";
const cacheKey = (windowId: number): string => `${KEY_PREFIX}${windowId}`;

// Stored shape: a plain Record per window. (No Map — not structured-cloneable.)
type WindowCache = Record<string, DomainCacheEntry>;

async function readWindow(windowId: number): Promise<WindowCache> {
  const key = cacheKey(windowId);
  const result = await chrome.storage.session.get(key);
  const raw = result[key];
  if (!raw || typeof raw !== "object") return {};
  return raw as WindowCache;
}

async function writeWindow(
  windowId: number,
  cache: WindowCache,
): Promise<void> {
  await chrome.storage.session.set({ [cacheKey(windowId)]: cache });
}

export async function getDomainEntry(
  windowId: number,
  domain: string,
): Promise<DomainCacheEntry | null> {
  const cache = await readWindow(windowId);
  return cache[domain] ?? null;
}

export interface SetDomainInput {
  windowId: number;
  domain: string;
  groupId: number;
  categoryName: string;
  color: ChromeGroupColor;
}

export async function setDomainEntry(input: SetDomainInput): Promise<void> {
  const cache = await readWindow(input.windowId);
  cache[input.domain] = {
    groupId: input.groupId,
    categoryName: input.categoryName,
    color: input.color,
    lastUsed: Date.now(),
  };
  await writeWindow(input.windowId, cache);
}

/**
 * Bulk seed entries for a window. Used by the initial classifier
 * after a successful LLM batch — one write call regardless of size.
 */
export async function seedDomainEntries(
  windowId: number,
  entries: ReadonlyArray<{
    domain: string;
    groupId: number;
    categoryName: string;
    color: ChromeGroupColor;
  }>,
): Promise<void> {
  if (entries.length === 0) return;
  const cache = await readWindow(windowId);
  const now = Date.now();
  for (const e of entries) {
    cache[e.domain] = {
      groupId: e.groupId,
      categoryName: e.categoryName,
      color: e.color,
      lastUsed: now,
    };
  }
  await writeWindow(windowId, cache);
}

/**
 * Read-only snapshot of the cache for a window. Used by the incremental
 * classifier to build the "existing groups" prompt context.
 */
export async function listDomainEntries(
  windowId: number,
): Promise<Array<{ domain: string; entry: DomainCacheEntry }>> {
  const cache = await readWindow(windowId);
  return Object.entries(cache).map(([domain, entry]) => ({ domain, entry }));
}

export async function clearWindow(windowId: number): Promise<void> {
  await chrome.storage.session.remove(cacheKey(windowId));
}

/**
 * Forget any entry pointing at the given groupId. Called when the user
 * deletes / ungroups that group so the next tab of that domain triggers
 * a fresh LLM lookup instead of resurrecting the dead group.
 */
export async function forgetGroup(
  windowId: number,
  groupId: number,
): Promise<void> {
  const cache = await readWindow(windowId);
  let changed = false;
  for (const [domain, entry] of Object.entries(cache)) {
    if (entry.groupId === groupId) {
      delete cache[domain];
      changed = true;
    }
  }
  if (changed) {
    await writeWindow(windowId, cache);
  }
}
