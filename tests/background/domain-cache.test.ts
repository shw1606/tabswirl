import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetGroupRemovalListenerForTests,
  clearWindow,
  forgetGroup,
  getDomainEntry,
  listDomainEntries,
  registerGroupRemovalInvalidator,
  seedDomainEntries,
  setDomainEntry,
} from "../../src/background/domain-cache";
import { installChromeSessionStorageMock } from "../helpers/chrome-storage";
import { installChromeTabsMock } from "../helpers/chrome-tabs";

describe("domain-cache", () => {
  beforeEach(() => {
    installChromeSessionStorageMock();
    _resetGroupRemovalListenerForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for an unseen (windowId, domain)", async () => {
    expect(await getDomainEntry(1, "example.com")).toBeNull();
  });

  it("round-trips a single entry", async () => {
    await setDomainEntry({
      windowId: 1,
      domain: "postgresql.org",
      groupId: 42,
      categoryName: "Database",
      color: "blue",
    });
    const e = await getDomainEntry(1, "postgresql.org");
    expect(e).toMatchObject({
      groupId: 42,
      categoryName: "Database",
      color: "blue",
    });
    expect(e?.lastUsed).toBeGreaterThan(0);
  });

  it("isolates entries by window", async () => {
    await setDomainEntry({
      windowId: 1,
      domain: "example.com",
      groupId: 1,
      categoryName: "A",
      color: "blue",
    });
    await setDomainEntry({
      windowId: 2,
      domain: "example.com",
      groupId: 9,
      categoryName: "Z",
      color: "red",
    });

    expect((await getDomainEntry(1, "example.com"))?.groupId).toBe(1);
    expect((await getDomainEntry(2, "example.com"))?.groupId).toBe(9);
  });

  it("seedDomainEntries writes many at once", async () => {
    await seedDomainEntries(1, [
      {
        domain: "postgresql.org",
        groupId: 1,
        categoryName: "Database",
        color: "blue",
      },
      {
        domain: "redis.io",
        groupId: 1,
        categoryName: "Database",
        color: "blue",
      },
      {
        domain: "github.com",
        groupId: 2,
        categoryName: "Code",
        color: "purple",
      },
    ]);

    const list = await listDomainEntries(1);
    expect(list).toHaveLength(3);
    const domains = list.map((x) => x.domain).sort();
    expect(domains).toEqual(["github.com", "postgresql.org", "redis.io"]);
  });

  it("seedDomainEntries is a no-op for empty input", async () => {
    await seedDomainEntries(1, []);
    expect(await listDomainEntries(1)).toEqual([]);
  });

  it("clearWindow removes the whole window cache", async () => {
    await setDomainEntry({
      windowId: 1,
      domain: "example.com",
      groupId: 1,
      categoryName: "A",
      color: "blue",
    });
    await clearWindow(1);
    expect(await getDomainEntry(1, "example.com")).toBeNull();
  });

  it("forgetGroup removes only entries pointing at the dead group", async () => {
    await seedDomainEntries(1, [
      {
        domain: "postgresql.org",
        groupId: 1,
        categoryName: "Database",
        color: "blue",
      },
      {
        domain: "redis.io",
        groupId: 1,
        categoryName: "Database",
        color: "blue",
      },
      {
        domain: "github.com",
        groupId: 2,
        categoryName: "Code",
        color: "purple",
      },
    ]);

    await forgetGroup(1, 1);

    expect(await getDomainEntry(1, "postgresql.org")).toBeNull();
    expect(await getDomainEntry(1, "redis.io")).toBeNull();
    expect((await getDomainEntry(1, "github.com"))?.groupId).toBe(2);
  });

  it("registerGroupRemovalInvalidator drops entries when chrome.tabGroups.onRemoved fires", async () => {
    // installChromeTabsMock provides chrome.tabGroups, including
    // onRemoved. It also resets the storage mock, so re-seed here.
    const tabsEnv = installChromeTabsMock();
    await seedDomainEntries(10, [
      {
        domain: "instagram.com",
        groupId: 1459190572,
        categoryName: "Social",
        color: "pink",
      },
      {
        domain: "twitter.com",
        groupId: 1459190572,
        categoryName: "Social",
        color: "pink",
      },
      {
        domain: "github.com",
        groupId: 2222,
        categoryName: "Code",
        color: "purple",
      },
    ]);
    // The listener needs a fake group object — seed it then fire removal.
    tabsEnv.groups.set(1459190572, {
      id: 1459190572,
      windowId: 10,
      title: "Social",
      color: "pink",
    });

    registerGroupRemovalInvalidator();
    tabsEnv.fireTabGroupRemoved(1459190572);

    // Give the void Promise inside the listener a tick to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(await getDomainEntry(10, "instagram.com")).toBeNull();
    expect(await getDomainEntry(10, "twitter.com")).toBeNull();
    // Other group's entries left untouched.
    expect((await getDomainEntry(10, "github.com"))?.groupId).toBe(2222);
  });

  it("registerGroupRemovalInvalidator is idempotent", () => {
    installChromeTabsMock();
    registerGroupRemovalInvalidator();
    registerGroupRemovalInvalidator();
    expect(
      (chrome.tabGroups.onRemoved.addListener as unknown as {
        mock: { calls: unknown[] };
      }).mock.calls,
    ).toHaveLength(1);
  });

  it("setDomainEntry overwrites an existing entry", async () => {
    await setDomainEntry({
      windowId: 1,
      domain: "example.com",
      groupId: 1,
      categoryName: "A",
      color: "blue",
    });
    await setDomainEntry({
      windowId: 1,
      domain: "example.com",
      groupId: 5,
      categoryName: "B",
      color: "red",
    });
    const e = await getDomainEntry(1, "example.com");
    expect(e).toMatchObject({
      groupId: 5,
      categoryName: "B",
      color: "red",
    });
  });
});
