import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTests,
  getWindowType,
  isGroupableWindow,
  registerWindowTypeListeners,
} from "../../src/background/window-type";
import { installChromeTabsMock, type ChromeTabsMock } from "../helpers/chrome-tabs";

describe("window-type", () => {
  let env: ChromeTabsMock;

  beforeEach(() => {
    env = installChromeTabsMock();
    _resetForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "normal" for default seeded windows', async () => {
    env.seedWindow(10);
    expect(await getWindowType(10)).toBe("normal");
    expect(await isGroupableWindow(10)).toBe(true);
  });

  it("treats PWA / app / popup / panel / devtools as non-groupable", async () => {
    env.seedWindow(11, "app");
    env.seedWindow(12, "popup");
    env.seedWindow(13, "panel");
    env.seedWindow(14, "devtools");

    expect(await isGroupableWindow(11)).toBe(false);
    expect(await isGroupableWindow(12)).toBe(false);
    expect(await isGroupableWindow(13)).toBe(false);
    expect(await isGroupableWindow(14)).toBe(false);
  });

  it("returns null for unknown windows and treats them as non-groupable", async () => {
    expect(await getWindowType(999)).toBeNull();
    expect(await isGroupableWindow(999)).toBe(false);
  });

  it("caches the result — second lookup does not hit chrome.windows.get", async () => {
    env.seedWindow(10);
    await getWindowType(10);
    await getWindowType(10);
    await getWindowType(10);
    expect((chrome.windows.get as unknown as { mock: { calls: unknown[] } }).mock.calls)
      .toHaveLength(1);
  });

  it("invalidates the cache when chrome.windows.onRemoved fires", async () => {
    env.seedWindow(10);
    registerWindowTypeListeners();

    await getWindowType(10);
    env.fireWindowRemoved(10);

    // Re-seed under a different type — the cache must not return the old value.
    env.seedWindow(10, "app");
    expect(await isGroupableWindow(10)).toBe(false);
  });

  it("registerWindowTypeListeners is idempotent", () => {
    registerWindowTypeListeners();
    registerWindowTypeListeners();
    // Only one listener should have been added.
    expect(
      (chrome.windows.onRemoved.addListener as unknown as { mock: { calls: unknown[] } })
        .mock.calls,
    ).toHaveLength(1);
  });
});
