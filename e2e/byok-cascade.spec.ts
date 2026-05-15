// BYOK fallback path: domain is NOT in Tier 1 rules → slow path → LLM.
// We mock the Anthropic Messages endpoint via context.route() so the
// test never hits the real API. The SW gets a deterministic response
// and the extension classifies the tab.
//
// This exercises the same code path that fails in real Chrome when
// chrome-ai is unavailable (the common case) and the user has set the
// Anthropic key.

import { expect, test, waitInSW } from "./helpers/extension";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

test("cache miss + no rule match → BYOK Anthropic gets called and groups the tab", async ({
  context,
  serviceWorker,
}) => {
  // Seed the BYOK key in chrome.storage.local.
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({ "byok:anthropic": "sk-ant-fake" });
  });

  // Mock the Anthropic endpoint — any request to api.anthropic.com
  // returns a tool_use response that maps the test tab to a "Test" group.
  await context.route(ANTHROPIC_URL, async (route, request) => {
    const body = JSON.parse(request.postData() || "{}") as {
      messages?: Array<{ content?: string }>;
    };
    // Pull the tab_id out of the user message so the response covers
    // exactly what the SW sent.
    const userText = body.messages?.[0]?.content ?? "";
    const idMatch = userText.match(/id=(\d+)/);
    const tabId = idMatch ? Number(idMatch[1]) : 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: [
          {
            type: "tool_use",
            id: "toolu_e2e",
            name: "classify_tabs",
            input: {
              assignments: [
                {
                  tab_id: tabId,
                  group_name: "Test",
                  color: "cyan",
                  is_new_group: true,
                },
              ],
            },
          },
        ],
      }),
    });
  });

  const page = await context.newPage();
  await page.route(
    "https://niche-rule-miss-87651.example/**",
    (route) =>
      void route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Niche</title>test",
      }),
  );
  await page.goto("https://niche-rule-miss-87651.example/");

  // Wait through 500ms debounce + mock response.
  const groupId = await waitInSW(
    serviceWorker,
    async () => {
      const tabs = await chrome.tabs.query({
        url: "https://niche-rule-miss-87651.example/*",
      });
      const tab = tabs[0];
      if (!tab || tab.groupId === undefined || tab.groupId === -1) return null;
      return tab.groupId;
    },
    { timeout: 8_000 },
  );

  const group = await serviceWorker.evaluate(
    async (gid: number) => chrome.tabGroups.get(gid),
    groupId as unknown as number,
  );
  expect(group.title).toBe("Test");
  expect(group.color).toBe("cyan");
});
