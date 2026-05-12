import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPouch,
  getPouch,
  listPouches,
  removePouch,
} from "../../src/core/pouch-store";
import type { SavedGroup, UngroupedBucket } from "../../src/core/types";
import {
  installChromeStorageMock,
  type ChromeStorageMock,
} from "../helpers/chrome-storage";

const sampleGroup: SavedGroup = {
  name: "Database",
  color: "blue",
  tabs: [
    { url: "https://www.postgresql.org/", title: "PostgreSQL" },
    { url: "https://redis.io/", title: "Redis" },
  ],
};

const emptyUngrouped: UngroupedBucket = { tabs: [] };

describe("pouch-store", () => {
  let mock: ChromeStorageMock;

  beforeEach(() => {
    mock = installChromeStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createPouch persists a pouch and updates the index", async () => {
    const pouch = await createPouch({
      groups: [sampleGroup],
      ungrouped: emptyUngrouped,
    });

    expect(pouch.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pouch.createdAt).toBeGreaterThan(0);
    expect(pouch.totalTabs).toBe(2);

    const stored = await getPouch(pouch.id);
    expect(stored).toEqual(pouch);

    const list = await listPouches();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(pouch.id);
  });

  it("counts both grouped and ungrouped tabs in totalTabs", async () => {
    const pouch = await createPouch({
      groups: [sampleGroup],
      ungrouped: { tabs: [{ url: "https://example.com", title: "Misc" }] },
    });
    expect(pouch.totalTabs).toBe(3);
  });

  it("listPouches returns newest first", async () => {
    const a = await createPouch({ groups: [], ungrouped: emptyUngrouped });
    const b = await createPouch({ groups: [], ungrouped: emptyUngrouped });
    const c = await createPouch({ groups: [], ungrouped: emptyUngrouped });

    const list = await listPouches();
    expect(list.map((p) => p.id)).toEqual([c.id, b.id, a.id]);
  });

  it("getPouch returns null for missing id", async () => {
    expect(await getPouch("missing-id")).toBeNull();
  });

  it("removePouch deletes the backing record and prunes the index — consume-on-restore", async () => {
    const a = await createPouch({
      groups: [sampleGroup],
      ungrouped: emptyUngrouped,
      label: "morning",
    });
    const b = await createPouch({
      groups: [],
      ungrouped: emptyUngrouped,
      label: "afternoon",
    });

    await removePouch(a.id);

    expect(await getPouch(a.id)).toBeNull();
    expect(mock.store.has(`pouch:${a.id}`)).toBe(false);

    const list = await listPouches();
    expect(list.map((p) => p.id)).toEqual([b.id]);
  });

  it("removePouch is idempotent on an unknown id", async () => {
    await expect(removePouch("never-existed")).resolves.toBeUndefined();
  });

  it("listPouches self-heals when an index entry has no backing pouch", async () => {
    const a = await createPouch({ groups: [], ungrouped: emptyUngrouped });

    // Inject a corrupt index: a stale id whose backing pouch is gone.
    await mock.local.set({ "pouches:index": ["ghost-id", a.id] });

    const list = await listPouches();
    expect(list.map((p) => p.id)).toEqual([a.id]);

    const repaired = await mock.local.get("pouches:index");
    expect(repaired["pouches:index"]).toEqual([a.id]);
  });

  it("preserves optional label and sourceWindowTitle through a round-trip", async () => {
    const pouch = await createPouch({
      groups: [],
      ungrouped: emptyUngrouped,
      label: "research",
      sourceWindowTitle: "Window 2",
    });
    const stored = await getPouch(pouch.id);
    expect(stored?.label).toBe("research");
    expect(stored?.sourceWindowTitle).toBe("Window 2");
  });

  it("listPouches returns an empty array when no pouches exist", async () => {
    expect(await listPouches()).toEqual([]);
  });
});
