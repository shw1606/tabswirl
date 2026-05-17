// Incremental classification with three tiers of speed (PRD §6.3 + the
// rules cascade added on top):
//
//   T0  Domain-cache hit: groupId already known for this domain. Just
//       join the group. ~10ms. No LLM, no rules.
//   T1  Domain-rules hit: well-known site like youtube.com / github.com
//       matches src/core/domain-rules.ts. Apply that category +
//       seed the cache so future tabs from the same domain take T0.
//       ~30ms. No LLM.
//   T2  Slow path: cache & rules miss → queue + 500ms debounce → batch
//       LLM call. Existing behaviour.
//
// MV3 service-worker lifecycle (CLAUDE.md "Critical invariants" §4):
// the SW idles after ~30s. A bare setTimeout dies with it. We persist
// the queue and the target fire-at timestamp in chrome.storage.session
// so that when the SW wakes (or a new event arrives), rehydrateQueue()
// can either flush immediately or re-schedule the remaining time.
//
// chrome.alarms is unsuitable here — its minimum period is way bigger
// than our 500ms debounce. setTimeout + persistence is the right model.

import { matchDomainRule } from "../core/domain-rules";
import { logTiming } from "../core/log";
import { extractDomain } from "../core/tabs";
import type { ChromeGroupColor, Tier2Order } from "../core/types";
import type { ExistingGroup, Language, TabInput } from "../llm/prompts";
import { classifyIncremental, type LlmProviderName } from "../llm/provider";
import {
  forgetGroup,
  getDomainEntry,
  seedDomainEntries,
  setDomainEntry,
} from "./domain-cache";
import {
  addTabsToGroup,
  applyGroup,
  snapshotWindowGroups,
} from "./group-manager";
import { isGroupableWindow } from "./window-type";

export const DEBOUNCE_MS = 500;
const QUEUE_KEY_PREFIX = "queue:incremental:";
const queueKey = (windowId: number): string => `${QUEUE_KEY_PREFIX}${windowId}`;

interface QueuedTab {
  id: number;
  title: string;
  domain: string;
}

interface WindowQueueState {
  tabs: QueuedTab[];
  scheduledAt: number;
}

interface FlushOptions {
  language: Language;
  model?: string;
  provider?: LlmProviderName;
  tier2Order?: Tier2Order;
}

export interface EnqueueInput {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  language: Language;
  model?: string;
  provider?: LlmProviderName;
  tier2Order?: Tier2Order;
}

export type EnqueuePath = "cache-hit" | "rule-hit" | "queued";

// In-memory timer registry. The Map dies when the SW idles — that's
// expected. rehydrateQueue() restores timers on wake.
const timers = new Map<number, ReturnType<typeof setTimeout>>();

async function readQueue(windowId: number): Promise<WindowQueueState> {
  const key = queueKey(windowId);
  const result = await chrome.storage.session.get(key);
  const raw = result[key];
  if (!raw || typeof raw !== "object") {
    return { tabs: [], scheduledAt: 0 };
  }
  const state = raw as WindowQueueState;
  return {
    tabs: Array.isArray(state.tabs) ? state.tabs : [],
    scheduledAt: typeof state.scheduledAt === "number" ? state.scheduledAt : 0,
  };
}

async function writeQueue(
  windowId: number,
  state: WindowQueueState,
): Promise<void> {
  if (state.tabs.length === 0) {
    await chrome.storage.session.remove(queueKey(windowId));
    return;
  }
  await chrome.storage.session.set({ [queueKey(windowId)]: state });
}

function scheduleFlush(
  windowId: number,
  delayMs: number,
  options: FlushOptions,
): void {
  const existing = timers.get(windowId);
  if (existing) clearTimeout(existing);
  timers.set(
    windowId,
    setTimeout(() => {
      timers.delete(windowId);
      void flushWindow(windowId, options);
    }, Math.max(0, delayMs)),
  );
}

export async function enqueueTab(
  input: EnqueueInput,
): Promise<{ path: EnqueuePath }> {
  const tEnter = performance.now();
  const domain = extractDomain(input.url);

  // FAST PATH — domain cache hit. Try to join the cached group; if it
  // succeeds, refresh lastUsed and we're done.
  //
  // If chrome.tabs.group rejects (most often because the group was
  // auto-deleted when the user closed its last tab), invalidate the
  // stale cache entry and fall through to the slow path so the LLM
  // gets to assign this tab to a fresh group.
  const cached = await getDomainEntry(input.windowId, domain);
  if (cached) {
    const joined = await addTabsToGroup(cached.groupId, [input.tabId]);
    if (joined) {
      await setDomainEntry({
        windowId: input.windowId,
        domain,
        groupId: cached.groupId,
        categoryName: cached.categoryName,
        color: cached.color,
      });
      logTiming(
        `[tabswirl:timing] fast-path tab=${input.tabId} ${domain} → group=${cached.groupId} (${Math.round(
          performance.now() - tEnter,
        )}ms)`,
      );
      return { path: "cache-hit" };
    }
    console.debug(
      `[tabswirl] stale cache for "${domain}" pointed at dead group ${cached.groupId}; invalidating and re-classifying`,
    );
    await forgetGroup(input.windowId, cached.groupId);
  }

  // TIER 1 — domain-rules hit. Well-known site like youtube.com. Apply
  // the rule's category immediately and seed the cache so future tabs
  // from this domain go through the T0 fast path. Skips the LLM entirely.
  const rule = matchDomainRule(domain, input.language);
  if (rule) {
    const groupId = await applyGroup({
      windowId: input.windowId,
      tabIds: [input.tabId],
      name: rule.categoryName,
      color: rule.color,
    });
    if (groupId !== null) {
      await setDomainEntry({
        windowId: input.windowId,
        domain,
        groupId,
        categoryName: rule.categoryName,
        color: rule.color,
      });
      logTiming(
        `[tabswirl:timing] rule-hit tab=${input.tabId} ${domain} → ${rule.categoryName} (${Math.round(
          performance.now() - tEnter,
        )}ms)`,
      );
      return { path: "rule-hit" };
    }
    // applyGroup returned null — non-normal window or chrome rejected.
    // Fall through to slow path so we still attempt classification.
  }

  // TIER 2 (slow path) — enqueue and (re)schedule the debounced flush.
  const queue = await readQueue(input.windowId);
  if (!queue.tabs.some((t) => t.id === input.tabId)) {
    queue.tabs.push({ id: input.tabId, title: input.title, domain });
  }
  queue.scheduledAt = Date.now() + DEBOUNCE_MS;
  await writeQueue(input.windowId, queue);

  scheduleFlush(input.windowId, DEBOUNCE_MS, {
    language: input.language,
    model: input.model,
    provider: input.provider,
    tier2Order: input.tier2Order,
  });
  console.log(
    `[tabswirl:timing] queued tab=${input.tabId} ${domain} (enqueue=${Math.round(
      performance.now() - tEnter,
    )}ms, debounce=${DEBOUNCE_MS}ms)`,
  );
  return { path: "queued" };
}

async function flushWindow(
  windowId: number,
  options: FlushOptions,
): Promise<void> {
  const tFlushStart = performance.now();

  const queue = await readQueue(windowId);
  if (queue.tabs.length === 0) return;
  const tabCount = queue.tabs.length;

  // Whatever happens below, the queue is consumed exactly once. Tabs
  // that fail to classify silently fall back to ungrouped per PRD §6.3.
  await writeQueue(windowId, { tabs: [], scheduledAt: 0 });

  // PWA / popup / app windows can't host tab groups — there's no point
  // calling the LLM for them. Drop the queue and move on.
  if (!(await isGroupableWindow(windowId))) {
    console.debug(
      `[tabswirl] flushWindow: window ${windowId} is not groupable, skipping LLM call`,
    );
    return;
  }

  const tBeforeSnap = performance.now();
  const snapshot = await snapshotWindowGroups(windowId);
  const tAfterSnap = performance.now();

  const existingGroups: ExistingGroup[] = snapshot.map((g) => ({
    name: g.name,
    color: g.color,
    sample_tabs: g.sampleTabs.map((t) => ({
      title: t.title,
      domain: extractDomain(t.url),
    })),
  }));

  const tabInputs: TabInput[] = queue.tabs.map((t) => ({
    id: t.id,
    title: t.title,
    domain: t.domain,
  }));

  const tBeforeLlm = performance.now();
  const result = await classifyIncremental(existingGroups, tabInputs, options);
  const tAfterLlm = performance.now();

  if (!result.ok) {
    logTiming(
      `[tabswirl:timing] flush(window=${windowId} tabs=${tabCount}) LLM FAILED ` +
        `(${result.error.kind}) snapshot=${Math.round(tAfterSnap - tBeforeSnap)}ms ` +
        `llm=${Math.round(tAfterLlm - tBeforeLlm)}ms ` +
        `total=${Math.round(tAfterLlm - tFlushStart)}ms`,
    );
    return;
  }

  const groupIdByName = new Map<string, number>();
  const colorByName = new Map<string, ChromeGroupColor>();
  for (const g of snapshot) {
    groupIdByName.set(g.name, g.groupId);
    colorByName.set(g.name, g.color);
  }

  const byGroup = new Map<
    string,
    { color: ChromeGroupColor; tabIds: number[]; domains: string[] }
  >();
  for (const a of result.assignments) {
    const t = queue.tabs.find((q) => q.id === a.tab_id);
    if (!t) continue;
    const color = colorByName.get(a.group_name) ?? a.color;
    const bucket = byGroup.get(a.group_name) ?? {
      color,
      tabIds: [],
      domains: [],
    };
    bucket.tabIds.push(a.tab_id);
    bucket.domains.push(t.domain);
    byGroup.set(a.group_name, bucket);
  }

  for (const [name, bucket] of byGroup) {
    const existingGroupId = groupIdByName.get(name);
    const groupId = await applyGroup({
      windowId,
      tabIds: bucket.tabIds,
      name,
      color: bucket.color,
      existingGroupId,
    });
    if (groupId === null) continue;

    await seedDomainEntries(
      windowId,
      bucket.domains.map((domain) => ({
        domain,
        groupId,
        categoryName: name,
        color: bucket.color,
      })),
    );
  }

  const tEnd = performance.now();
  console.log(
    `[tabswirl:timing] flush(window=${windowId} tabs=${tabCount}) ` +
      `snapshot=${Math.round(tAfterSnap - tBeforeSnap)}ms ` +
      `llm=${Math.round(tAfterLlm - tBeforeLlm)}ms ` +
      `apply=${Math.round(tEnd - tAfterLlm)}ms ` +
      `total=${Math.round(tEnd - tFlushStart)}ms`,
  );
}

/**
 * Called when the SW starts (`chrome.runtime.onStartup`) and whenever
 * we want to recover after an idle nap. Walks persisted queues and
 * schedules a flush for each window that still has pending tabs.
 */
export async function rehydrateQueue(options: FlushOptions): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const now = Date.now();
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(QUEUE_KEY_PREFIX)) continue;
    const windowId = Number(key.slice(QUEUE_KEY_PREFIX.length));
    if (!Number.isFinite(windowId)) continue;
    const state = value as WindowQueueState;
    if (!Array.isArray(state.tabs) || state.tabs.length === 0) continue;

    const remaining = (state.scheduledAt ?? 0) - now;
    if (remaining <= 0) {
      void flushWindow(windowId, options);
    } else {
      scheduleFlush(windowId, remaining, options);
    }
  }
}

/**
 * Test/dev affordance: drop pending timers without touching the
 * persisted queue. Production code should never need this.
 */
export function _resetInMemoryTimers(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
