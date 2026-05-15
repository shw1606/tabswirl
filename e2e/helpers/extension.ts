// Test fixture: launches Chromium with TabSwirl loaded from dist/, finds
// the service-worker, exposes its extensionId.
//
// Usage:
//   import { test, expect } from "./helpers/extension";
//   test("...", async ({ context, extensionId, serviceWorker }) => { ... })
//
// Notes on Chrome extension testing with Playwright:
//   - Extensions only work in `launchPersistentContext` (not regular
//     `launch` + `newContext`).
//   - Manifest V3 service workers DO run in modern Chromium even in
//     headless: false mode. Headless "new" works in Chromium 144+; we
//     keep headless: true for speed and switch to false only when
//     debugging.
//   - The SW URL looks like chrome-extension://<id>/service-worker-loader.js
//     (crxjs wraps the actual TS module). The id is what manifest paths
//     resolve against.

import {
  chromium,
  test as base,
  type BrowserContext,
  type Worker,
} from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "../../dist");

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    // Per Playwright docs (https://playwright.dev/docs/chrome-extensions):
    //   - extensions only work in `launchPersistentContext`
    //   - use `channel: 'chromium'` for the full browser (not headless-shell)
    //   - headless=false in dev; the MV3 SW boot in newer headless modes
    //     is flaky enough that running headed locally is the safer bet.
    const ctx = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    await use(ctx);
    await ctx.close();
  },

  serviceWorker: async ({ context }, use) => {
    // MV3 SWs don't always register at launch — Chrome waits for an
    // event. Touch about:blank to nudge the browser into a steady state,
    // then look for the worker. The waitForEvent path catches the case
    // where the SW boots a beat later.
    let [sw] = context.serviceWorkers();
    if (!sw) {
      try {
        sw = await context.waitForEvent("serviceworker", { timeout: 5_000 });
      } catch {
        const page = await context.newPage();
        await page.goto("about:blank");
        [sw] = context.serviceWorkers();
        if (!sw) {
          sw = await context.waitForEvent("serviceworker", { timeout: 10_000 });
        }
        await page.close();
      }
    }
    await use(sw);
  },

  extensionId: async ({ serviceWorker }, use) => {
    // URL: chrome-extension://<id>/service-worker-loader.js
    const url = new URL(serviceWorker.url());
    await use(url.host);
  },
});

export const expect = test.expect;

/**
 * Wait until `predicate()` (evaluated in the service worker) returns
 * truthy. Useful for "wait for classification to finish".
 */
export async function waitInSW<T>(
  sw: Worker,
  predicate: () => Promise<T> | T,
  options: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const timeout = options.timeout ?? 5_000;
  const interval = options.interval ?? 100;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await sw.evaluate(predicate);
    if (result) return result;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitInSW: predicate never returned truthy within ${timeout}ms`);
}
