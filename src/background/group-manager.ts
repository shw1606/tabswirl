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
 * Throw-safe: chrome.tabs.group can throw "Grouping is not supported
 * by tabs in this window." for non-normal window types. We catch that
 * here so one bad window can't cascade through the caller.
 */
export async function applyGroup(input: ApplyGroupInput): Promise<number | null> {
  if (input.tabIds.length === 0) return null;

  const groupOptions: chrome.tabs.GroupOptions = {
    tabIds: input.tabIds,
    createProperties:
      input.existingGroupId === undefined
        ? { windowId: input.windowId }
        : undefined,
    ...(input.existingGroupId !== undefined
      ? { groupId: input.existingGroupId }
      : {}),
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

  try {
    await chrome.tabGroups.update(groupId, {
      title: input.name,
      color: input.color,
    });
  } catch (err) {
    // The group was created but couldn't be named/colored. Surface the
    // error and still return the id — the tabs are at least grouped.
    console.warn(
      `[tabswirl] chrome.tabGroups.update failed for group ${groupId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return groupId;
}

/**
 * Move tabs into an already-existing group, leaving the group's
 * title/color alone. Used by the fast path in the classifier queue
 * when a domain cache hit tells us exactly which group to extend.
 *
 * Throw-safe with the same rationale as applyGroup.
 */
export async function addTabsToGroup(
  groupId: number,
  tabIds: number[],
): Promise<void> {
  if (tabIds.length === 0) return;
  try {
    await chrome.tabs.group({ tabIds, groupId });
  } catch (err) {
    console.warn(
      `[tabswirl] addTabsToGroup failed for group ${groupId}:`,
      err instanceof Error ? err.message : err,
    );
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
