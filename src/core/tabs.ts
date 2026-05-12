// Single source of truth for "should this tab be auto-classified?"
// (CLAUDE.md "Critical invariants" §6.) Anywhere else in the codebase
// that needs the same check must call this predicate — never reinvent
// the rules inline.
//
// Excluded:
//   - incognito tabs (privacy)
//   - pinned tabs (explicit user intent)
//   - internal URLs (chrome://, chrome-extension://, about:, edge://)
//   - tabs with no usable title (still loading)

const INTERNAL_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge://",
  "brave://",
  "opera://",
  "vivaldi://",
  "view-source:",
  "devtools://",
] as const;

export function isInternalUrl(url: string | undefined): boolean {
  if (!url) return true;
  return INTERNAL_URL_PREFIXES.some((p) => url.startsWith(p));
}

export function isClassifiable(tab: chrome.tabs.Tab): boolean {
  if (tab.incognito) return false;
  if (tab.pinned) return false;
  if (isInternalUrl(tab.url)) return false;
  if (!tab.title || tab.title.trim().length === 0) return false;
  return true;
}

/**
 * Extracts the registrable-ish domain from a URL. Falls back to the
 * hostname when URL parsing fails. Used by the classifier and the
 * domain cache.
 */
export function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}
