// Playwright config for the E2E suite that loads the built dist/ as an
// unpacked Chrome extension and drives it through real Chromium.
//
// We deliberately keep this small and isolated from the Vitest setup —
// `pnpm test` stays fast (unit, no browser). `pnpm e2e` is the slower
// "does it actually work in Chrome" check.
//
// Why fullyParallel: false / workers: 1:
//   Each test launches a persistent context that owns the entire Chrome
//   profile (storage, tabs, etc). Running them in parallel would fight
//   over chrome.storage and the SW lifecycle. Speed isn't the win here
//   — repeatability is.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The screenshot generator is its own thing — see `pnpm screenshots`.
  // Default `pnpm e2e` filters it out via --grep-invert in package.json.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    // Trace + video on first retry. Cheap insurance when SW timing bugs
    // appear in CI but not locally.
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  // Each test gets up to 30s. Most are under 5s; the budget covers
  // SW boot + classification debounce + LLM mock turnaround.
  timeout: 30_000,
  expect: { timeout: 5_000 },
});
