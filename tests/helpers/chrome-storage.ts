// In-memory chrome.storage mock. Covers the subset of the API the
// pouch-store actually exercises (get/set/remove on string / string[] keys).
//
// Ref: https://developer.chrome.com/docs/extensions/reference/api/storage

import { vi } from "vitest";

type StorageRecord = Record<string, unknown>;

export interface ChromeStorageMock {
  store: Map<string, unknown>;
  local: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
}

export function installChromeStorageMock(): ChromeStorageMock {
  const store = new Map<string, unknown>();

  const local = {
    get: vi.fn(async (keys?: string | string[] | null): Promise<StorageRecord> => {
      if (keys === null || keys === undefined) {
        return Object.fromEntries(store);
      }
      const list = typeof keys === "string" ? [keys] : keys;
      const out: StorageRecord = {};
      for (const key of list) {
        if (store.has(key)) {
          out[key] = store.get(key);
        }
      }
      return out;
    }),
    set: vi.fn(async (items: StorageRecord): Promise<void> => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    }),
    remove: vi.fn(async (keys: string | string[]): Promise<void> => {
      const list = typeof keys === "string" ? [keys] : keys;
      for (const key of list) {
        store.delete(key);
      }
    }),
    clear: vi.fn(async (): Promise<void> => {
      store.clear();
    }),
  };

  vi.stubGlobal("chrome", { storage: { local } });

  return { store, local };
}
