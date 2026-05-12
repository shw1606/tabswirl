import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWindow,
  forgetGroup,
  getDomainEntry,
  listDomainEntries,
  seedDomainEntries,
  setDomainEntry,
} from "../../src/background/domain-cache";
import { installChromeSessionStorageMock } from "../helpers/chrome-storage";

describe("domain-cache", () => {
  beforeEach(() => {
    installChromeSessionStorageMock();
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
