// Stash a selection of tabs into a Pouch.
//
// Inputs:
//   - the currently open tabs in one window (with their chrome.tabGroups state)
//   - a subset of tab ids the user picked
// Outputs:
//   - one Pouch in chrome.storage.local (via pouch-store)
//   - those tabs closed (chrome.tabs.remove)
//
// No LLM call here — Stash freezes the existing auto-classification
// instead of asking the model again. PRD §4 F2.

import { createPouch } from "./pouch-store";
import type { ChromeGroupColor, Pouch, SavedGroup, SavedTab } from "./types";

export interface BuildPouchInput {
  /** All tabs in the source window. Filter by selection inside. */
  tabs: chrome.tabs.Tab[];
  /** chrome.tabGroups present in the source window. */
  groups: { id: number; title: string; color: ChromeGroupColor }[];
  /** Tab ids the user actually selected to stash. */
  selectedTabIds: Iterable<number>;
  label?: string;
  sourceWindowTitle?: string;
}

interface BuiltPouch {
  groups: SavedGroup[];
  ungrouped: { tabs: SavedTab[] };
}

function toSavedTab(tab: chrome.tabs.Tab): SavedTab | null {
  if (typeof tab.url !== "string" || tab.url.length === 0) return null;
  const saved: SavedTab = {
    url: tab.url,
    title: tab.title ?? "",
  };
  if (tab.favIconUrl) saved.favIconUrl = tab.favIconUrl;
  return saved;
}

/**
 * Pure function: from a window's tabs/groups and a selection set,
 * produce the structured groups + ungrouped buckets that go into a
 * Pouch. Separated from the IO so it can be unit-tested without
 * touching chrome.* APIs.
 */
export function buildPouchBody(input: BuildPouchInput): BuiltPouch {
  const selection = new Set(input.selectedTabIds);
  const groupMeta = new Map<number, { title: string; color: ChromeGroupColor }>();
  for (const g of input.groups) {
    groupMeta.set(g.id, { title: g.title, color: g.color });
  }

  const byGroup = new Map<number, SavedTab[]>();
  const ungroupedTabs: SavedTab[] = [];

  for (const tab of input.tabs) {
    if (typeof tab.id !== "number") continue;
    if (!selection.has(tab.id)) continue;
    const saved = toSavedTab(tab);
    if (!saved) continue;

    const gid = tab.groupId ?? -1;
    if (gid > 0 && groupMeta.has(gid)) {
      const list = byGroup.get(gid) ?? [];
      list.push(saved);
      byGroup.set(gid, list);
    } else {
      ungroupedTabs.push(saved);
    }
  }

  const groups: SavedGroup[] = [];
  for (const [gid, tabs] of byGroup) {
    if (tabs.length === 0) continue;
    const meta = groupMeta.get(gid)!;
    groups.push({
      name: meta.title || "Untitled",
      color: meta.color,
      tabs,
    });
  }

  return { groups, ungrouped: { tabs: ungroupedTabs } };
}

export interface StashTabsInput extends BuildPouchInput {
  /** When true, also calls chrome.tabs.remove on the stashed ids. PRD §4 F2. */
  closeTabs?: boolean;
}

export interface StashResult {
  pouch: Pouch;
  closedTabIds: number[];
}

/**
 * IO-bound entry point: build the Pouch body, persist it, then close
 * the selected tabs. Tabs that fail to be assembled into a SavedTab
 * (missing url) are dropped silently — they aren't worth storing.
 */
export async function stashTabs(input: StashTabsInput): Promise<StashResult> {
  const body = buildPouchBody(input);
  const pouch = await createPouch({
    groups: body.groups,
    ungrouped: body.ungrouped,
    label: input.label,
    sourceWindowTitle: input.sourceWindowTitle,
  });

  let closedTabIds: number[] = [];
  if (input.closeTabs !== false) {
    const selectedSet = new Set(input.selectedTabIds);
    closedTabIds = input.tabs
      .filter(
        (t) =>
          typeof t.id === "number" &&
          selectedSet.has(t.id) &&
          typeof t.url === "string" &&
          t.url.length > 0,
      )
      .map((t) => t.id as number);

    if (closedTabIds.length > 0) {
      await chrome.tabs.remove(closedTabIds);
    }
  }

  return { pouch, closedTabIds };
}
