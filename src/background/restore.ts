// Restore a Pouch into the current window, then DELETE the Pouch —
// the consume-on-restore semantic (PRD §0, §4 F4, CLAUDE.md
// "Critical invariants" §2).
//
// Steps (PRD §8.3):
//   1. Read the Pouch from chrome.storage.local.
//   2. For each saved group: create chrome.tabs.create for each saved tab.
//   3. After collecting the new tab ids, markRestoring them BEFORE the
//      classifier listener can run (Critical invariant §3).
//   4. chrome.tabs.group + chrome.tabGroups.update with the saved name + color.
//   5. removePouch — consume.
//   6. setTimeout 1.5s, then unmarkRestoring to release the guard.
//
// On any chrome.* error during tab creation, we still try to consume
// the pouch — partial restores happen and a stuck pouch is worse than
// a partially restored one. Returning a tagged error lets the popup
// surface what went wrong.

import { getPouch, removePouch } from "../core/pouch-store";
import { applyGroup } from "./group-manager";
import { markRestoring, unmarkRestoring } from "./tab-listener";

export const RESTORE_GUARD_MS = 1500;

export type RestoreOutcome =
  | { ok: true; tabsOpened: number; groupsOpened: number }
  | { ok: false; reason: string };

interface RestoreOptions {
  /** Target window. Defaults to a "normal" window (last focused if possible). */
  windowId?: number;
}

/**
 * Pick a window that can actually host tabs and groups. Prefers
 * `override` when provided, then the last-focused window if it's
 * normal, then any other normal window.
 *
 * Throws if no normal window exists at all (which can happen when
 * only PWAs are open).
 */
async function resolveTargetWindow(
  override: number | undefined,
): Promise<number> {
  if (typeof override === "number") return override;

  const allWindows = await chrome.windows.getAll();
  const normalWindows = allWindows.filter(
    (w) => w.type === "normal" && typeof w.id === "number",
  );
  if (normalWindows.length === 0) {
    throw new Error("no normal window available");
  }

  const focused = await chrome.windows.getLastFocused().catch(() => null);
  if (
    focused &&
    typeof focused.id === "number" &&
    normalWindows.some((w) => w.id === focused.id)
  ) {
    return focused.id;
  }

  return normalWindows[0]!.id as number;
}

export async function restorePouch(
  pouchId: string,
  options: RestoreOptions = {},
): Promise<RestoreOutcome> {
  const pouch = await getPouch(pouchId);
  if (!pouch) {
    return { ok: false, reason: "not-found" };
  }

  let windowId: number;
  try {
    windowId = await resolveTargetWindow(options.windowId);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const createdAll: number[] = [];
  let groupsOpened = 0;

  for (const group of pouch.groups) {
    const createdIds: number[] = [];
    for (const tab of group.tabs) {
      try {
        const created = await chrome.tabs.create({
          url: tab.url,
          windowId,
          active: false,
        });
        if (typeof created.id === "number") {
          createdIds.push(created.id);
          createdAll.push(created.id);
          // Mark each tab as it's born so the listener can't race us.
          markRestoring([created.id]);
        }
      } catch {
        // skip this tab but keep going
      }
    }
    if (createdIds.length === 0) continue;

    try {
      await applyGroup({
        windowId,
        tabIds: createdIds,
        name: group.name,
        color: group.color,
      });
      groupsOpened++;
    } catch {
      // Group apply failed — tabs are open but not grouped. Still progress.
    }
  }

  for (const tab of pouch.ungrouped.tabs) {
    try {
      const created = await chrome.tabs.create({
        url: tab.url,
        windowId,
        active: false,
      });
      if (typeof created.id === "number") {
        createdAll.push(created.id);
        markRestoring([created.id]);
      }
    } catch {
      // skip
    }
  }

  // Consume the Pouch unconditionally — partial restores are still
  // "the user retrieved this pouch". A pouch left behind after restore
  // would be a P0 violation of the product semantic.
  await removePouch(pouchId);

  // Release the guard after a delay so that any straggling onUpdated
  // events caused by the restored tabs finish loading without being
  // re-classified.
  setTimeout(() => {
    unmarkRestoring(createdAll);
  }, RESTORE_GUARD_MS);

  return {
    ok: true,
    tabsOpened: createdAll.length,
    groupsOpened,
  };
}
