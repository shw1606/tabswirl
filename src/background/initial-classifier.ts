// One-shot bulk classification of all currently-open tabs across every
// window. Triggered by chrome.runtime.onInstalled (fresh install / update)
// and by the user toggling auto-classify off → on.
//
// Strategy (PRD §4 F1, §8.1.a):
//   - For each window, gather classifiable tabs (isClassifiable predicate).
//   - Chunk to CHUNK_SIZE per LLM call (context-size guard for 50+ tab windows).
//   - On success: create chrome tab groups, seed the domain cache.
//   - On failure: silently leave tabs ungrouped; the user's workflow is
//     never blocked by a classification error.

import { extractDomain, isClassifiable } from "../core/tabs";
import type { ChromeGroupColor } from "../core/types";
import { classifyInitial } from "../llm/anthropic";
import type { Language, TabInput } from "../llm/prompts";
import { seedDomainEntries } from "./domain-cache";
import { applyGroup } from "./group-manager";

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

  // Track group-name → groupId across chunks so a category that
  // appears in chunk 1 and chunk 2 lands in the same chrome tabGroup.
  const namedGroupIds = new Map<string, number>();
  // And remember the color the LLM picked for each name (so the second
  // chunk doesn't accidentally rename a group's color).
  const namedColors = new Map<string, ChromeGroupColor>();

  for (const batch of chunk(tabs, CHUNK_SIZE)) {
    const llm = await classifyInitial(
      batch.map((t) => t.input),
      { language: options.language, model: options.model },
    );

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

    // Apply groups, reusing chrome groupIds across chunks when the name matches.
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
