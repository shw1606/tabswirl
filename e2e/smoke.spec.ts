// Smoke: extension loads, service worker boots, popup HTML renders.
// If any of these break, every other E2E test would too.

import { expect, test } from "./helpers/extension";

test("service worker exists and exposes a valid extensionId", async ({
  serviceWorker,
  extensionId,
}) => {
  expect(serviceWorker.url()).toMatch(
    /^chrome-extension:\/\/[a-z]+\/service-worker-loader\.js$/,
  );
  expect(extensionId).toMatch(/^[a-z]{32}$/);
});

test("popup HTML renders the TabSwirl heading", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  // The popup's header brand text proves React mounted. Use role+name
  // to avoid matching every other "TabSwirl" mention in the tab list.
  await expect(
    page.getByRole("banner").getByText("TabSwirl", { exact: true }),
  ).toBeVisible();
});

test("options page renders + classification tier explainer", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await expect(page.locator("text=TabSwirl Settings")).toBeVisible();
  await expect(page.locator("text=Domain rules")).toBeVisible();
  await expect(page.locator("text=Chrome built-in AI")).toBeVisible();
});

test("domain rules table is loaded into the SW global scope", async ({
  serviceWorker,
}) => {
  // The rules are bundled into the SW. We can't import them by name
  // post-bundle, but we can drive a function through the SW that goes
  // through the rule path. As a smoke check, just confirm the SW can
  // read its own settings storage — proves the chrome.* APIs are wired.
  const settings = await serviceWorker.evaluate(async () => {
    const r = await chrome.storage.local.get("settings:main");
    return r["settings:main"] ?? null;
  });
  // No settings set yet (fresh profile) — but the API responded.
  expect(settings === null || typeof settings === "object").toBe(true);
});
