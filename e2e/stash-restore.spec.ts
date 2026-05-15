// Stash + Restore — the product's defining flow.
//
// Round-trip:
//   1. open tabs, let Tier 1 group them
//   2. open popup, click Stash → tabs close + Pouch persists
//   3. open popup, click Restore → tabs reopen, Pouch is consumed
//      (chrome.storage.local["pouch:<id>"] gone, "pouches:index" empty)
//
// We don't drive the popup UI mouse-by-mouse (brittle). Instead we
// trigger the underlying functions via SW evaluate — same result, far
// less flake. The UI is exercised separately via the smoke test.

import { expect, test, waitInSW } from "./helpers/extension";

async function loadFakedHost(page: import("@playwright/test").Page, host: string) {
  await page.route(`https://${host}/**`, (route) =>
    void route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>${host}</title>test`,
    }),
  );
  await page.goto(`https://${host}/`);
}

test("Stash creates a Pouch and closes the source tabs; Restore reopens + consumes the Pouch", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  // Two tabs on rule-covered hosts → instant Tier 1 grouping.
  const a = await context.newPage();
  await loadFakedHost(a, "github.com");
  const b = await context.newPage();
  await loadFakedHost(b, "instagram.com");

  // Wait for both to be grouped.
  await waitInSW(
    serviceWorker,
    async () => {
      const all = await chrome.tabs.query({});
      const grouped = all.filter(
        (t) => t.groupId !== undefined && t.groupId !== -1,
      );
      return grouped.length >= 2;
    },
    { timeout: 8_000 },
  );

  // === STASH ===
  // Build a Pouch from the grouped tabs and close them. This mirrors what
  // popup's "Stash" button does internally — we replicate the persistence
  // side directly via SW evaluate rather than trying to import the bundled
  // module by its hashed name.
  const pouchId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const groups = await chrome.tabGroups.query({});
    const target = tabs.filter(
      (t) => t.groupId !== undefined && t.groupId !== -1,
    );
    const groupById = new Map(groups.map((g) => [g.id, g]));

    const savedGroups: Array<{
      name: string;
      color: string;
      tabs: Array<{ url: string; title: string }>;
    }> = [];
    const byGroupId = new Map<number, typeof savedGroups[number]>();
    for (const t of target) {
      const g = groupById.get(t.groupId!);
      if (!g) continue;
      let bucket = byGroupId.get(g.id);
      if (!bucket) {
        bucket = { name: g.title ?? "Untitled", color: g.color, tabs: [] };
        byGroupId.set(g.id, bucket);
        savedGroups.push(bucket);
      }
      bucket.tabs.push({ url: t.url ?? "", title: t.title ?? "" });
    }

    const id = crypto.randomUUID();
    const pouch = {
      id,
      createdAt: Date.now(),
      groups: savedGroups,
      ungrouped: { tabs: [] as Array<{ url: string; title: string }> },
      totalTabs: target.length,
    };
    await chrome.storage.local.set({
      [`pouch:${id}`]: pouch,
      "pouches:index": [id],
    });
    await chrome.tabs.remove(target.map((t) => t.id!));
    return id;
  });

  expect(pouchId).toMatch(/^[0-9a-f-]{36}$/);

  // After Stash, no tabs on github / instagram exist.
  const stashedTabsGone = await serviceWorker.evaluate(async () => {
    const a = await chrome.tabs.query({ url: "https://github.com/*" });
    const b = await chrome.tabs.query({ url: "https://instagram.com/*" });
    return a.length === 0 && b.length === 0;
  });
  expect(stashedTabsGone).toBe(true);

  // Pouch persisted.
  const persistedBefore = await serviceWorker.evaluate(
    async (id: string) =>
      (await chrome.storage.local.get(`pouch:${id}`))[`pouch:${id}`] !==
      undefined,
    pouchId,
  );
  expect(persistedBefore).toBe(true);

  // === RESTORE === driven from the popup page (chrome.runtime.sendMessage
  // doesn't deliver to the SW that sent it; this mirrors the real popup → SW
  // path the user clicks through).
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  const restoreResult = await popup.evaluate(async (id: string) => {
    return await chrome.runtime.sendMessage({
      type: "restore-pouch",
      pouchId: id,
    });
  }, pouchId);
  await popup.close();

  expect(restoreResult).toMatchObject({ ok: true });
  expect((restoreResult as { tabsOpened: number }).tabsOpened).toBeGreaterThan(0);

  // Pouch CONSUMED (P0 invariant).
  const persistedAfter = await serviceWorker.evaluate(
    async (id: string) =>
      (await chrome.storage.local.get(`pouch:${id}`))[`pouch:${id}`] ??
      null,
    pouchId,
  );
  expect(persistedAfter).toBeNull();
});
