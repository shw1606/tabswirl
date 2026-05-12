// Pure data transform: (window's tabs, chrome groups) → tree shape the
// popup renders. Split from the React layer so it can be unit-tested
// without rendering anything.

import type { ChromeGroupColor } from "../core/types";

export interface TreeTab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface TreeGroup {
  groupId: number;
  name: string;
  color: ChromeGroupColor;
  tabs: TreeTab[];
}

export interface TabTree {
  groups: TreeGroup[];
  ungrouped: TreeTab[];
}

export interface BuildTreeInput {
  tabs: chrome.tabs.Tab[];
  groups: { id: number; title: string; color: ChromeGroupColor }[];
}

function toTreeTab(t: chrome.tabs.Tab): TreeTab | null {
  if (typeof t.id !== "number") return null;
  return {
    id: t.id,
    title: t.title ?? "",
    url: t.url ?? "",
    ...(t.favIconUrl ? { favIconUrl: t.favIconUrl } : {}),
  };
}

export function buildTabTree(input: BuildTreeInput): TabTree {
  const groupMeta = new Map<
    number,
    { name: string; color: ChromeGroupColor; tabs: TreeTab[] }
  >();
  for (const g of input.groups) {
    groupMeta.set(g.id, {
      name: g.title || "Untitled",
      color: g.color,
      tabs: [],
    });
  }

  const ungrouped: TreeTab[] = [];

  for (const tab of input.tabs) {
    const tt = toTreeTab(tab);
    if (!tt) continue;
    const gid = tab.groupId ?? -1;
    const bucket = gid > 0 ? groupMeta.get(gid) : undefined;
    if (bucket) {
      bucket.tabs.push(tt);
    } else {
      ungrouped.push(tt);
    }
  }

  const groups: TreeGroup[] = [];
  for (const [groupId, meta] of groupMeta) {
    groups.push({
      groupId,
      name: meta.name,
      color: meta.color,
      tabs: meta.tabs,
    });
  }

  return { groups, ungrouped };
}

/**
 * Collect every tabId that appears in the tree. Used to seed the
 * "select all" checkbox state.
 */
export function allTabIds(tree: TabTree): number[] {
  const ids: number[] = [];
  for (const g of tree.groups) for (const t of g.tabs) ids.push(t.id);
  for (const t of tree.ungrouped) ids.push(t.id);
  return ids;
}
