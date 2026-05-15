// Generates the README screenshots into docs/screenshots/. Excluded
// from the default Playwright run (see playwright.config.ts testIgnore);
// run with `pnpm screenshots`.
//
// What it captures:
//   - popup-stash.png   — Stash view with several tabs grouped via Tier 1
//   - popup-pouches.png — Pouches view with one Pouch already created
//   - options.png       — Options page top-of-fold
//
// Strategy: open pages on rule-covered domains (github / youtube /
// instagram / news.ycombinator), wait for the classifier, then navigate
// the test browser to chrome-extension://<id>/src/popup/index.html and
// snapshot. The same HTML the toolbar popup renders.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, waitInSW } from "./helpers/extension";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../docs/screenshots");

const FIXTURE_HOSTS = [
  "github.com",
  "stackoverflow.com",
  "youtube.com",
  "instagram.com",
  "news.ycombinator.com",
  "vercel.com",
] as const;

async function loadHost(
  page: import("@playwright/test").Page,
  host: string,
): Promise<void> {
  await page.route(`https://${host}/**`, (route) =>
    void route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>${host}</title>${host}`,
    }),
  );
  await page.goto(`https://${host}/`);
}

test("generate README screenshots", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  // 1) seed pages so Tier 1 has something to do
  for (const host of FIXTURE_HOSTS) {
    const p = await context.newPage();
    await loadHost(p, host);
  }

  // 2) wait for the classifier to settle
  await waitInSW(
    serviceWorker,
    async () => {
      const tabs = await chrome.tabs.query({});
      const grouped = tabs.filter(
        (t) =>
          t.groupId !== undefined &&
          t.groupId !== -1 &&
          t.url?.startsWith("https://"),
      );
      return grouped.length >= 5;
    },
    { timeout: 10_000 },
  );

  // 3) Pre-create a Pouch so the Pouches tab has content to show.
  await serviceWorker.evaluate(async () => {
    const id = crypto.randomUUID();
    await chrome.storage.local.set({
      [`pouch:${id}`]: {
        id,
        createdAt: Date.now() - 1000 * 60 * 60 * 4, // 4h ago
        label: "Yesterday's research",
        groups: [
          {
            name: "Code",
            color: "purple",
            tabs: [
              { url: "https://github.com/", title: "GitHub" },
              { url: "https://stackoverflow.com/", title: "Stack Overflow" },
            ],
          },
          {
            name: "News",
            color: "yellow",
            tabs: [
              { url: "https://news.ycombinator.com/", title: "Hacker News" },
            ],
          },
        ],
        ungrouped: { tabs: [] },
        totalTabs: 3,
      },
      "pouches:index": [id],
    });
  });

  // 4) Popup — Stash view
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 480 });
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  // Let React render + queries resolve.
  await popup.waitForTimeout(400);
  await popup.screenshot({ path: path.join(OUT, "popup-stash.png") });

  // 5) Popup — Pouches view
  await popup.getByRole("button", { name: /Pouches/ }).click();
  await popup.waitForTimeout(200);
  await popup.screenshot({ path: path.join(OUT, "popup-pouches.png") });
  await popup.close();

  // 6) Options page
  const opts = await context.newPage();
  await opts.setViewportSize({ width: 720, height: 900 });
  await opts.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await opts.waitForTimeout(400);
  await opts.screenshot({
    path: path.join(OUT, "options.png"),
    fullPage: true,
  });
  await opts.close();
});
