import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, getSettings, setSettings } from "../core/settings";
import type { Settings } from "../core/types";

const BYOK_KEY = "byok:anthropic";

export function App() {
  const [apiKey, setApiKey] = useState("");
  const [settings, setLocalSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await chrome.storage.local.get(BYOK_KEY);
      const key = stored[BYOK_KEY];
      if (typeof key === "string") setApiKey(key);

      const s = await getSettings();
      setLocalSettings(s);
    })();
  }, []);

  const saveKey = async () => {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      await chrome.storage.local.remove(BYOK_KEY);
      setStatus("Cleared API key.");
    } else {
      await chrome.storage.local.set({ [BYOK_KEY]: trimmed });
      setStatus("Saved.");
    }
  };

  const clearKey = async () => {
    await chrome.storage.local.remove(BYOK_KEY);
    setApiKey("");
    setStatus("Cleared.");
  };

  const updateSetting = async <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => {
    const next = await setSettings({ [key]: value } as Partial<Settings>);
    setLocalSettings(next);
    setStatus("Saved.");
  };

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">TabSwirl Settings</h1>
      {status && (
        <div className="mt-2 rounded-md bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700">
          {status}
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-medium">Anthropic API key (BYOK)</h2>
        <p className="mt-1 text-xs text-neutral-600">
          Stored locally in <code>chrome.storage.local</code>. Used to call
          Claude Haiku for tab classification. The key never leaves your
          machine except in API calls to api.anthropic.com.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void saveKey()}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void clearKey()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Clear
          </button>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Auto-classify</h2>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.autoClassifyEnabled}
            onChange={(e) =>
              void updateSetting("autoClassifyEnabled", e.target.checked)
            }
          />
          Enable auto-classification of new tabs
        </label>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Language</h2>
        <select
          value={settings.language}
          onChange={(e) =>
            void updateSetting("language", e.target.value as "ko" | "en")
          }
          className="mt-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="en">English</option>
          <option value="ko">한국어</option>
        </select>
        <p className="mt-1 text-xs text-neutral-600">
          Controls the language of LLM-generated category names.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Confirmations</h2>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.confirmBeforeRestore}
            onChange={(e) =>
              void updateSetting("confirmBeforeRestore", e.target.checked)
            }
          />
          Confirm before restoring a Pouch
        </label>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.confirmBeforeDiscard}
            onChange={(e) =>
              void updateSetting("confirmBeforeDiscard", e.target.checked)
            }
          />
          Confirm before discarding a Pouch
        </label>
      </section>
    </div>
  );
}
