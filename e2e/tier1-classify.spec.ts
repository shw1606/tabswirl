// Tier 1 (domain rules) — the path the user wanted: open a github.com /
// youtube.com tab, the extension classifies it instantly, no LLM call,
// no key required.
//
// Strategy:
//   1. open a page on a rule-covered domain
//   2. poll `chrome.tabs.get(id).groupId` from the SW until it changes
//   3. read chrome.tabGroups.get(groupId) — assert title + color
//
// We use file:// URLs with the rule-covered hostname spoofed via
// page.route() so we don't hit the real internet. Wait — actually
// chrome.tabs.onUpdated reads tab.url which comes from Chrome's nav
// stack, not from our mock. The simplest reliable thing is to navigate
// to the actual http(s) URL but intercept the request so the page
// "loads" quickly without going to the real site.

import { expect, test, waitInSW } from "./helpers/extension";

async function loadFakedHostPage(page: import("@playwright/test").Page, host: string, title: string) {
  // Serve an empty stub page when the test navigates to the host. The
  // SW reads tab.url + tab.title from Chrome's tab state — both reflect
  // the navigation we made.
  await page.route(`https://${host}/**`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><head><title>${title}</title></head><body>test</body></html>`,
    });
  });
  await page.goto(`https://${host}/`);
}

test("github.com tab is classified into Code (purple) without an LLM call", async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await loadFakedHostPage(page, "github.com", "GitHub");

  // Wait until the tab's groupId is non-(-1) — meaning the classifier
  // grouped it.
  const groupId = await waitInSW(
    serviceWorker,
    async () => {
      const tabs = await chrome.tabs.query({ url: "https://github.com/*" });
      const tab = tabs[0];
      if (!tab) return null;
      if (tab.groupId === undefined || tab.groupId === -1) return null;
      return tab.groupId;
    },
    { timeout: 10_000 },
  );

  expect(typeof groupId).toBe("number");

  // The group should be named "Code" with the purple color.
  const group = await serviceWorker.evaluate(
    async (gid: number) => chrome.tabGroups.get(gid),
    groupId as unknown as number,
  );
  expect(group.title).toBe("Code");
  expect(group.color).toBe("purple");
});

test("youtube.com and instagram.com end up in distinct rule groups", async ({
  context,
  serviceWorker,
}) => {
  const yt = await context.newPage();
  await loadFakedHostPage(yt, "youtube.com", "YouTube");
  const ig = await context.newPage();
  await loadFakedHostPage(ig, "instagram.com", "Instagram");

  await waitInSW(
    serviceWorker,
    async () => {
      const ytTabs = await chrome.tabs.query({ url: "https://youtube.com/*" });
      const igTabs = await chrome.tabs.query({ url: "https://instagram.com/*" });
      const ytGid = ytTabs[0]?.groupId;
      const igGid = igTabs[0]?.groupId;
      const grouped = (gid: number | undefined) => typeof gid === "number" && gid !== -1;
      return grouped(ytGid) && grouped(igGid);
    },
    { timeout: 10_000 },
  );

  const titles = await serviceWorker.evaluate(async () => {
    const groups = await chrome.tabGroups.query({});
    return groups.map((g) => g.title).sort();
  });
  // Two tabs, two rule-distinct groups.
  expect(titles).toContain("Video");
  expect(titles).toContain("Social");
});

test("a domain NOT in the rules table does NOT get auto-grouped", async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await loadFakedHostPage(page, "totally-random-domain-12345.example", "Whatever");

  // Wait a debounce window + slop, then verify the tab is still ungrouped.
  // (No BYOK key → slow-path LLM call returns missing-key, no group applied.)
  await new Promise((r) => setTimeout(r, 1500));

  const groupId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({
      url: "https://totally-random-domain-12345.example/*",
    });
    return tabs[0]?.groupId ?? null;
  });
  // chrome.tabs.TAB_GROUP_ID_NONE is -1.
  expect(groupId === -1 || groupId === null).toBe(true);
});
