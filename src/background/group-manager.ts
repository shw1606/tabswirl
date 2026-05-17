// Wrapper around chrome.tabs.group + chrome.tabGroups.* operations.
//
// Why this exists:
//   1. chrome.tabs.group groups tabs and returns a groupId, but
//      naming/coloring is a separate chrome.tabGroups.update call.
//      Doing both atomically here keeps callers tidy.
//   2. All tabs in a single chrome.tabs.group() call MUST share a
//      windowId. (Common trap §4 in CLAUDE.md.) We enforce that.
//   3. The 9-color enum is duplicated in three places — types.ts,
//      LLM prompts tool schema, and chrome.tabGroups API. This module
//      is the boundary between the LLM/extension internal color and
//      the chrome.tabGroups runtime call.
//
// Refs:
//   https://developer.chrome.com/docs/extensions/reference/api/tabs#method-group
//   https://developer.chrome.com/docs/extensions/reference/api/tabGroups#method-update
//   https://developer.chrome.com/docs/extensions/reference/api/tabGroups#type-Color

import type { ChromeGroupColor } from "../core/types";

export interface ApplyGroupInput {
  windowId: number;
  /** Tab ids to put into the group. Must be non-empty. All must live in windowId. */
  tabIds: number[];
  name: string;
  color: ChromeGroupColor;
  /** Optional existing groupId to extend instead of creating fresh. */
  existingGroupId?: number;
}

/**
 * Create a new tab group (or extend an existing one) and apply
 * name + color. Returns the resulting groupId, or null if grouping
 * wasn't possible (no tabs / chrome.tabs.group rejected — e.g. the
 * window is a PWA / popup / panel that doesn't support tab groups).
 *
 * Duplicate-group prevention: when no explicit `existingGroupId` is
 * given, we query the window's groups and reuse any group whose title
 * already equals `input.name`. Without this, callers that don't track
 * group ids (Tier 1 rules in enqueueTab, the rule pass in
 * initial-classifier, a second classifyAll run) each mint a fresh
 * "Code" / "Social" / … group and the window fills with same-name
 * duplicates. Resolving by name here makes every caller safe by
 * default — single source of truth.
 *
 * Throw-safe: chrome.tabs.group can throw "Grouping is not supported
 * by tabs in this window." for non-normal window types. We catch that
 * here so one bad window can't cascade through the caller.
 */
export async function applyGroup(input: ApplyGroupInput): Promise<number | null> {
  if (input.tabIds.length === 0) return null;

  // Resolve the target group: explicit id > existing same-name group
  // in this window > create new.
  let targetGroupId = input.existingGroupId;
  let mergedIntoExisting = false;
  if (targetGroupId === undefined) {
    try {
      const groups = await chrome.tabGroups.query({ windowId: input.windowId });
      const match = groups.find((g) => (g.title ?? "") === input.name);
      if (match) {
        targetGroupId = match.id;
        mergedIntoExisting = true;
      }
    } catch {
      // query unavailable (non-normal window etc.) — fall through to create.
    }
  }

  const groupOptions: chrome.tabs.GroupOptions = {
    tabIds: input.tabIds,
    createProperties:
      targetGroupId === undefined ? { windowId: input.windowId } : undefined,
    ...(targetGroupId !== undefined ? { groupId: targetGroupId } : {}),
  };

  let groupId: number;
  try {
    groupId = await chrome.tabs.group(groupOptions);
  } catch (err) {
    console.warn(
      `[tabswirl] chrome.tabs.group failed for window ${input.windowId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  // When we merged into a pre-existing same-name group, leave its
  // title/color alone — the user may have recolored it, and the
  // group-learning listener treats that as intent. Only stamp name +
  // color when this group is (effectively) ours to define.
  if (!mergedIntoExisting) {
    try {
      await chrome.tabGroups.update(groupId, {
        title: input.name,
        color: input.color,
      });
    } catch (err) {
      // The group exists but couldn't be named/colored. Surface the
      // error and still return the id — the tabs are at least grouped.
      console.warn(
        `[tabswirl] chrome.tabGroups.update failed for group ${groupId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return groupId;
}

/**
 * Merge same-name groups in a window into one. Chrome auto-removes a
 * group once its last tab leaves, so moving every duplicate's tabs into
 * the first group of that name cleans up the window. Returns the number
 * of duplicate groups absorbed.
 *
 * Called at the start of classifyAllOpenTabs so the "Re-classify all
 * open tabs" action also repairs any duplicates that accumulated before
 * the applyGroup name-resolution fix landed (or from manual edits).
 */
export async function consolidateDuplicateGroups(
  windowId: number,
): Promise<number> {
  let groups: chrome.tabGroups.TabGroup[];
  try {
    groups = await chrome.tabGroups.query({ windowId });
  } catch {
    return 0;
  }

  const byTitle = new Map<string, chrome.tabGroups.TabGroup[]>();
  for (const g of groups) {
    const title = g.title ?? "";
    if (!title) continue; // never merge untitled groups
    const list = byTitle.get(title) ?? [];
    list.push(g);
    byTitle.set(title, list);
  }

  let absorbed = 0;
  for (const [, list] of byTitle) {
    if (list.length < 2) continue;
    // Keep the first; fold the rest in. Chrome deletes the now-empty
    // duplicates, which fires onRemoved → domain-cache self-heals.
    const keep = list[0]!;
    for (let i = 1; i < list.length; i++) {
      const dup = list[i]!;
      let tabs: chrome.tabs.Tab[];
      try {
        tabs = await chrome.tabs.query({ groupId: dup.id });
      } catch {
        continue;
      }
      const ids = tabs
        .map((t) => t.id)
        .filter((x): x is number => typeof x === "number");
      if (ids.length === 0) continue;
      try {
        await chrome.tabs.group({ tabIds: ids, groupId: keep.id });
        absorbed++;
      } catch (err) {
        console.warn(
          `[tabswirl] consolidateDuplicateGroups: merge failed for "${dup.title}":`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  return absorbed;
}

/**
 * Move tabs into an already-existing group, leaving the group's
 * title/color alone. Used by the fast path in the classifier queue
 * when a domain cache hit tells us exactly which group to extend.
 *
 * Returns `true` on success, `false` when chrome.tabs.group rejected —
 * most commonly because the cached groupId no longer exists (the user
 * closed every tab in the group, Chrome auto-removed it, and our
 * domain cache still points at the dead id). The caller is expected
 * to invalidate its cache entry and re-classify.
 */
export async function addTabsToGroup(
  groupId: number,
  tabIds: number[],
): Promise<boolean> {
  if (tabIds.length === 0) return true;
  try {
    await chrome.tabs.group({ tabIds, groupId });
    return true;
  } catch (err) {
    console.warn(
      `[tabswirl] addTabsToGroup failed for group ${groupId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Remove the given tabs from whatever group they're currently in.
 * Used when the classifier decides a tab no longer belongs.
 */
export async function ungroupTabs(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  await chrome.tabs.ungroup(tabIds);
}

/**
 * Read the current state of a window's groups — name, color, sample
 * tabs. Feeds the incremental classifier's "existing groups" prompt.
 *
 * `sampleTabCount` caps how many representative tabs per group are
 * returned (prompt size control). Defaults to 3 per PRD §6.3.
 */
export async function snapshotWindowGroups(
  windowId: number,
  sampleTabCount = 3,
): Promise<
  Array<{
    groupId: number;
    name: string;
    color: ChromeGroupColor;
    sampleTabs: { title: string; url: string }[];
  }>
> {
  const groups = await chrome.tabGroups.query({ windowId });
  const tabs = await chrome.tabs.query({ windowId });

  return groups.map((g) => {
    const groupTabs = tabs
      .filter((t) => t.groupId === g.id)
      .slice(0, sampleTabCount)
      .map((t) => ({
        title: t.title ?? "",
        url: t.url ?? "",
      }));

    return {
      groupId: g.id,
      name: g.title ?? "",
      color: g.color as ChromeGroupColor,
      sampleTabs: groupTabs,
    };
  });
}
