// Single source of truth for "is this window groupable?"
//
// chrome.tabs.group + chrome.tabGroups.* only work on windows whose
// `type === "normal"`. PWA / popup / panel / devtools windows reject
// with "Grouping is not supported by tabs in this window."
//
// We cache window types per-windowId so the predicate is essentially
// free after the first lookup. The cache is invalidated on
// chrome.windows.onRemoved so a windowId reused by Chrome later can't
// surface stale data.
//
// Refs:
//   https://developer.chrome.com/docs/extensions/reference/api/windows#type-Window
//   https://developer.chrome.com/docs/extensions/reference/api/windows#type-WindowType

const cache = new Map<number, chrome.windows.windowTypeEnum>();
let listenersRegistered = false;

export async function getWindowType(
  windowId: number,
): Promise<chrome.windows.windowTypeEnum | null> {
  const cached = cache.get(windowId);
  if (cached !== undefined) return cached;
  try {
    const win = await chrome.windows.get(windowId);
    const type = (win.type ?? "normal") as chrome.windows.windowTypeEnum;
    cache.set(windowId, type);
    return type;
  } catch {
    return null;
  }
}

/**
 * True iff the window supports chrome.tabs.group / chrome.tabGroups.*.
 * Anything other than "normal" (PWA, popup, panel, app, devtools) is
 * skipped by every classifier path.
 */
export async function isGroupableWindow(windowId: number): Promise<boolean> {
  return (await getWindowType(windowId)) === "normal";
}

/**
 * Wire chrome.windows.onRemoved to drop dead windows from the cache.
 * Idempotent — call from the SW entry point.
 */
export function registerWindowTypeListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;
  chrome.windows.onRemoved.addListener((windowId) => {
    cache.delete(windowId);
  });
}

export function _resetForTests(): void {
  cache.clear();
  listenersRegistered = false;
}
