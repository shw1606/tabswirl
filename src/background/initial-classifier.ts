// One-shot bulk classification of all currently-open tabs across every
// window. Triggered by chrome.runtime.onInstalled (fresh install / update),
// chrome.runtime.onStartup, and by the user clicking "Re-classify all
// open tabs now" in options.
//
// Strategy (PRD §4 F1, §8.1.a):
//   - For each window, gather classifiable tabs (isClassifiable predicate).
//   - Tier 1: bucket rule-matched tabs by category and apply groups
//     directly (no LLM call). Seed the cache so subsequent same-domain
//     tabs hit T0 fast path.
//   - Tier 2: only tabs that didn't match a rule are sent to the LLM,
//     chunked to CHUNK_SIZE per call (context-size guard for big windows).
//   - On LLM failure: silently leave the rule-miss tabs ungrouped — the
//     rule-hit tabs are already grouped, the user keeps the partial win.

import { matchDomainRule } from "../core/domain-rules";
import { extractDomain, isClassifiable } from "../core/tabs";
import type { ChromeGroupColor, Tier2Order } from "../core/types";
import type { Language, TabInput } from "../llm/prompts";
import { classifyInitial, type LlmProviderName } from "../llm/provider";
import { seedDomainEntries } from "./domain-cache";
import { applyGroup, consolidateDuplicateGroups } from "./group-manager";

/** Max tabs per LLM batch. Prompt size guard for huge windows. PRD §4 F1. */
export const CHUNK_SIZE = 30;

export interface ClassifyWindowResult {
  windowId: number;
  classified: number;
  groupsCreated: number;
  skipped: number;
  errors: number;
}

export interface ClassifyAllResult {
  windows: ClassifyWindowResult[];
  totalClassified: number;
  totalErrors: number;
}

interface RunOptions {
  language: Language;
  model?: string;
  provider?: LlmProviderName;
  tier2Order?: Tier2Order;
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

interface TabWithDomain {
  id: number;
  windowId: number;
  domain: string;
  input: TabInput;
}

function toTabInput(tab: chrome.tabs.Tab): TabWithDomain | null {
  if (!isClassifiable(tab)) return null;
  if (typeof tab.id !== "number") return null;
  if (typeof tab.windowId !== "number") return null;
  const url = tab.url ?? "";
  const domain = extractDomain(url);
  return {
    id: tab.id,
    windowId: tab.windowId,
    domain,
    input: {
      id: tab.id,
      title: tab.title ?? "",
      domain,
    },
  };
}

async function classifyOneWindow(
  windowId: number,
  tabs: TabWithDomain[],
  options: RunOptions,
): Promise<ClassifyWindowResult> {
  const result: ClassifyWindowResult = {
    windowId,
    classified: 0,
    groupsCreated: 0,
    skipped: 0,
    errors: 0,
  };

  if (tabs.length === 0) return result;

  // Fold any pre-existing same-name duplicate groups together first, so
  // a "Re-classify all" also repairs windows that accumulated dupes
  // before the applyGroup name-resolution fix (or via manual edits).
  await consolidateDuplicateGroups(windowId);

  // Track group-name → groupId across the rule pass AND every LLM chunk
  // so a category that appears in both lands in the same chrome group.
  const namedGroupIds = new Map<string, number>();
  // Keep the first-seen color stable (rule-defined color beats whatever
  // the LLM later guesses for the same category name).
  const namedColors = new Map<string, ChromeGroupColor>();

  // === Tier 1: domain rules ===
  // Split tabs into rule-hits (bucketed by category) and rule-misses
  // (to be sent to the LLM).
  const ruleBatches = new Map<
    string,
    { color: ChromeGroupColor; tabIds: number[]; domains: string[] }
  >();
  const remainingTabs: TabWithDomain[] = [];
  for (const t of tabs) {
    const rule = matchDomainRule(t.domain, options.language);
    if (rule) {
      const bucket = ruleBatches.get(rule.categoryName) ?? {
        color: rule.color,
        tabIds: [],
        domains: [],
      };
      bucket.tabIds.push(t.id);
      bucket.domains.push(t.domain);
      ruleBatches.set(rule.categoryName, bucket);
    } else {
      remainingTabs.push(t);
    }
  }

  for (const [name, bucket] of ruleBatches) {
    const groupId = await applyGroup({
      windowId,
      tabIds: bucket.tabIds,
      name,
      color: bucket.color,
    });
    if (groupId === null) continue;
    namedGroupIds.set(name, groupId);
    namedColors.set(name, bucket.color);
    result.classified += bucket.tabIds.length;
    result.groupsCreated++;
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

  // === Tier 2: LLM for whatever didn't match a rule ===
  if (remainingTabs.length === 0) return result;

  for (const batch of chunk(remainingTabs, CHUNK_SIZE)) {
    const llm = await classifyInitial(batch.map((t) => t.input), options);

    if (!llm.ok) {
      result.errors += batch.length;
      continue;
    }

    // Bucket assignments by group name.
    const byGroup = new Map<
      string,
      { color: ChromeGroupColor; tabIds: number[]; domains: string[] }
    >();
    for (const a of llm.assignments) {
      const t = batch.find((b) => b.id === a.tab_id);
      if (!t) {
        result.skipped++;
        continue;
      }
      const existingColor = namedColors.get(a.group_name) ?? a.color;
      const bucket = byGroup.get(a.group_name) ?? {
        color: existingColor,
        tabIds: [],
        domains: [],
      };
      bucket.tabIds.push(a.tab_id);
      bucket.domains.push(t.domain);
      byGroup.set(a.group_name, bucket);
    }

    // Apply groups, reusing chrome groupIds across chunks AND across
    // the earlier rule pass when the name matches.
    for (const [name, bucket] of byGroup) {
      const existingGroupId = namedGroupIds.get(name);
      const groupId = await applyGroup({
        windowId,
        tabIds: bucket.tabIds,
        name,
        color: bucket.color,
        existingGroupId,
      });

      if (groupId === null) continue;

      if (existingGroupId === undefined) result.groupsCreated++;
      namedGroupIds.set(name, groupId);
      namedColors.set(name, bucket.color);
      result.classified += bucket.tabIds.length;

      // Seed the domain cache for the fast path on future tabs.
      const seeds = bucket.domains.map((domain) => ({
        domain,
        groupId,
        categoryName: name,
        color: bucket.color,
      }));
      await seedDomainEntries(windowId, seeds);
    }
  }

  return result;
}

/**
 * Public entry point. Walks every browser window, classifies its tabs,
 * creates chrome tab groups, and seeds the domain cache. Safe to call
 * multiple times.
 *
 * Per-window isolation: only windows whose `type === "normal"` are
 * processed. PWA / popup / app / panel / devtools windows are skipped
 * silently — chrome.tabs.group would throw there. Each window's
 * classification is wrapped in try/catch so a single window's failure
 * cannot cascade to the others.
 */
export async function classifyAllOpenTabs(
  options: RunOptions,
): Promise<ClassifyAllResult> {
  // chrome.windows.getAll with populate gives us tabs grouped by their
  // owning window in one IPC, AND lets us read window.type for the
  // groupable filter.
  const allWindows = await chrome.windows.getAll({ populate: true });

  const windows: ClassifyWindowResult[] = [];

  for (const win of allWindows) {
    if (typeof win.id !== "number") continue;
    if (win.type !== "normal") {
      console.debug(
        `[tabswirl] classifyAllOpenTabs: skipping window ${win.id} (type=${win.type})`,
      );
      continue;
    }

    const tabs = (win.tabs ?? [])
      .map(toTabInput)
      .filter((t): t is TabWithDomain => t !== null);

    if (tabs.length === 0) continue;

    try {
      windows.push(await classifyOneWindow(win.id, tabs, options));
    } catch (err) {
      console.warn(
        `[tabswirl] classifyAllOpenTabs: window ${win.id} crashed during classification:`,
        err instanceof Error ? err.message : err,
      );
      windows.push({
        windowId: win.id,
        classified: 0,
        groupsCreated: 0,
        skipped: 0,
        errors: tabs.length,
      });
      // Continue to the next window — per-window isolation.
    }
  }

  return {
    windows,
    totalClassified: windows.reduce((acc, w) => acc + w.classified, 0),
    totalErrors: windows.reduce((acc, w) => acc + w.errors, 0),
  };
}
