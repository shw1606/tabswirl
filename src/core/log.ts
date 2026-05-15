// Verbose timing log gate. The `[tabswirl:timing]` lines (fast-path,
// queue, flush) are diagnostic only — useful for the user when they're
// chasing a latency issue, noisy otherwise. Default off.
//
// The flag lives in Settings.verboseTiming. We mirror it into a
// module-level variable so `logTiming(...)` is a sync, hot-path-safe
// call (no async storage read per log).
//
// chrome.storage.onChanged refreshes the mirror so toggling the option
// takes effect immediately without an SW restart.

const SETTINGS_KEY = "settings:main";

let verbose = false;
let registered = false;

export function setVerboseTimingForTests(v: boolean): void {
  verbose = v;
}

export function isVerboseTimingEnabled(): boolean {
  return verbose;
}

export function logTiming(...args: unknown[]): void {
  if (verbose) console.log(...args);
}

/**
 * Pull the current verboseTiming value from chrome.storage.local and
 * register a listener for future changes. Idempotent. Should be called
 * from the SW entry. Tolerates a missing onChanged surface so tests
 * without the full chrome.* mock don't blow up.
 */
export function registerVerboseTimingFromStorage(): void {
  if (registered) return;
  registered = true;

  void (async () => {
    try {
      const r = await chrome.storage.local.get(SETTINGS_KEY);
      const s = r[SETTINGS_KEY] as { verboseTiming?: boolean } | undefined;
      verbose = !!s?.verboseTiming;
    } catch {
      /* ignore — defaults to false */
    }
  })();

  const onChanged = chrome.storage?.onChanged;
  if (onChanged?.addListener) {
    onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[SETTINGS_KEY]) return;
      const next = changes[SETTINGS_KEY].newValue as
        | { verboseTiming?: boolean }
        | undefined;
      verbose = !!next?.verboseTiming;
    });
  }
}

/** Test-only — reset module state. */
export function _resetVerboseLogForTests(): void {
  verbose = false;
  registered = false;
}
