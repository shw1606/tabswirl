import { describe, expect, it } from "vitest";
import { extractDomain, isClassifiable, isInternalUrl } from "../../src/core/tabs";

function tab(overrides: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: true,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: "https://example.com",
    title: "Example",
    ...overrides,
  } as chrome.tabs.Tab;
}

describe("isClassifiable", () => {
  it("accepts a normal http(s) tab with title", () => {
    expect(isClassifiable(tab({}))).toBe(true);
  });

  it("rejects incognito tabs", () => {
    expect(isClassifiable(tab({ incognito: true }))).toBe(false);
  });

  it("rejects pinned tabs", () => {
    expect(isClassifiable(tab({ pinned: true }))).toBe(false);
  });

  it.each([
    "chrome://settings/",
    "chrome-extension://abc/popup.html",
    "about:blank",
    "edge://flags",
    "view-source:https://example.com",
    "devtools://devtools/bundled/",
  ])("rejects internal url %s", (url) => {
    expect(isClassifiable(tab({ url }))).toBe(false);
  });

  it("rejects tabs with no title", () => {
    expect(isClassifiable(tab({ title: "" }))).toBe(false);
    expect(isClassifiable(tab({ title: "   " }))).toBe(false);
  });

  it("rejects tabs with no url", () => {
    expect(isClassifiable(tab({ url: undefined }))).toBe(false);
  });
});

describe("isInternalUrl", () => {
  it("returns true for empty/undefined", () => {
    expect(isInternalUrl(undefined)).toBe(true);
    expect(isInternalUrl("")).toBe(true);
  });

  it("returns false for http(s) urls", () => {
    expect(isInternalUrl("https://example.com")).toBe(false);
    expect(isInternalUrl("http://localhost:3000")).toBe(false);
  });
});

describe("extractDomain", () => {
  it("returns hostname for valid URLs", () => {
    expect(extractDomain("https://www.postgresql.org/docs/")).toBe(
      "www.postgresql.org",
    );
    expect(extractDomain("http://localhost:3000/foo")).toBe("localhost");
  });

  it("falls back to the raw input for unparseable strings", () => {
    expect(extractDomain("not a url")).toBe("not a url");
  });
});
