import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORE_GUARD_MS, restorePouch } from "../../src/background/restore";
import { _resetForTests, isRestoring, markRestoring } from "../../src/background/tab-listener";
import { createPouch, getPouch } from "../../src/core/pouch-store";
import { installChromeStorageMock } from "../helpers/chrome-storage";
import { installChromeTabsMock, type ChromeTabsMock } from "../helpers/chrome-tabs";

function installChromeWindowsMock(focusedWindowId: number): void {
  const existing =
    (globalThis as { chrome?: Record<string, unknown> }).chrome ?? {};
  vi.stubGlobal("chrome", {
    ...existing,
    windows: {
      getLastFocused: vi.fn(async () => ({ id: focusedWindowId })),
    },
  });
}

function setup(focusedWindowId = 10) {
  installChromeStorageMock();
  const tabs = installChromeTabsMock();
  installChromeWindowsMock(focusedWindowId);
  _resetForTests();
  return { tabs };
}

describe("restorePouch", () => {
  let env: { tabs: ChromeTabsMock };

  beforeEach(() => {
    vi.useFakeTimers();
    env = setup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("recreates groups, marks new tabs as restoring, then deletes the pouch", async () => {
    const pouch = await createPouch({
      groups: [
        {
          name: "Database",
          color: "blue",
          tabs: [
            { url: "https://postgresql.org/", title: "PG" },
            { url: "https://redis.io/", title: "Redis" },
          ],
        },
      ],
      ungrouped: { tabs: [{ url: "https://example.com/", title: "Misc" }] },
    });

    const result = await restorePouch(pouch.id);

    expect(result).toMatchObject({ ok: true, tabsOpened: 3, groupsOpened: 1 });
    expect(await getPouch(pouch.id)).toBeNull();

    const newTabIds = [...env.tabs.tabs.keys()];
    expect(newTabIds.length).toBe(3);
    for (const id of newTabIds) {
      expect(isRestoring(id)).toBe(true);
    }

    const groups = [...env.tabs.groups.values()];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: "Database", color: "blue" });

    // After the guard fires, restoring marks clear.
    vi.advanceTimersByTime(RESTORE_GUARD_MS + 10);
    for (const id of newTabIds) {
      expect(isRestoring(id)).toBe(false);
    }
  });

  it("returns not-found when the pouchId is unknown", async () => {
    const result = await restorePouch("missing-pouch");
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("consumes the pouch even if a tab create fails partway through", async () => {
    // Wrap the existing chrome.tabs.create to fail on the 2nd call.
    const existing =
      (globalThis as { chrome?: Record<string, unknown> }).chrome ?? {};
    const existingTabs = existing["tabs"] as Record<string, unknown>;
    const originalCreate = existingTabs["create"] as (
      props: chrome.tabs.CreateProperties,
    ) => Promise<chrome.tabs.Tab>;
    let call = 0;
    existingTabs["create"] = vi.fn(async (props: chrome.tabs.CreateProperties) => {
      call++;
      if (call === 2) throw new Error("network blocked");
      return originalCreate(props);
    });

    const pouch = await createPouch({
      groups: [
        {
          name: "Database",
          color: "blue",
          tabs: [
            { url: "https://postgresql.org/", title: "PG" },
            { url: "https://redis.io/", title: "Redis" }, // fails
          ],
        },
      ],
      ungrouped: { tabs: [] },
    });

    const result = await restorePouch(pouch.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tabsOpened).toBe(1);

    // Pouch consumed despite the partial failure (P0 invariant).
    expect(await getPouch(pouch.id)).toBeNull();
  });

  it("succeeds on an empty pouch (no tabs at all)", async () => {
    const pouch = await createPouch({
      groups: [],
      ungrouped: { tabs: [] },
    });
    const result = await restorePouch(pouch.id);
    expect(result).toMatchObject({ ok: true, tabsOpened: 0, groupsOpened: 0 });
    expect(await getPouch(pouch.id)).toBeNull();
  });

  it("does not clear pre-existing restoring marks set by another caller", async () => {
    markRestoring([12345]); // not one of ours
    const pouch = await createPouch({
      groups: [],
      ungrouped: { tabs: [{ url: "https://x.example/", title: "X" }] },
    });

    await restorePouch(pouch.id);
    expect(isRestoring(12345)).toBe(true);

    vi.advanceTimersByTime(RESTORE_GUARD_MS + 10);
    // Our restore unmarks only the ids it created.
    expect(isRestoring(12345)).toBe(true);
  });

  it("opens tabs into the last-focused window when windowId is omitted", async () => {
    installChromeWindowsMock(42);

    const pouch = await createPouch({
      groups: [
        {
          name: "G",
          color: "blue",
          tabs: [{ url: "https://x.example/", title: "X" }],
        },
      ],
      ungrouped: { tabs: [] },
    });

    await restorePouch(pouch.id);

    const newTabs = [...env.tabs.tabs.values()];
    expect(newTabs).toHaveLength(1);
    expect(newTabs[0]?.windowId).toBe(42);
  });
});
