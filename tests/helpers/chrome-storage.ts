// In-memory chrome.storage mock. Covers the subset of the API the
// extension actually exercises (get/set/remove on string / string[] keys).
//
// Ref: https://developer.chrome.com/docs/extensions/reference/api/storage

import { vi } from "vitest";

type StorageRecord = Record<string, unknown>;

interface MockArea {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

export interface ChromeStorageMock {
  store: Map<string, unknown>;
  local: MockArea;
  session: MockArea;
}

function makeArea(store: Map<string, unknown>): MockArea {
  return {
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
}

/**
 * Installs a chrome.storage mock with both `local` and `session` areas,
 * each backed by an independent in-memory store. Returns refs to both.
 */
export function installChromeStorageMock(): ChromeStorageMock {
  const localStore = new Map<string, unknown>();
  const sessionStore = new Map<string, unknown>();

  const local = makeArea(localStore);
  const session = makeArea(sessionStore);

  vi.stubGlobal("chrome", { storage: { local, session } });

  return { store: localStore, local, session };
}

/**
 * Convenience for tests that only care about chrome.storage.session.
 * Returns the session area mock directly.
 */
export function installChromeSessionStorageMock(): MockArea {
  return installChromeStorageMock().session;
}
