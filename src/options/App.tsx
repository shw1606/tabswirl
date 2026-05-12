import { useEffect, useState } from "react";
import { sendClassifyAll } from "../core/messaging";
import { DEFAULT_SETTINGS, getSettings, setSettings } from "../core/settings";
import type { Settings } from "../core/types";

const GEMINI_KEY_STORAGE = "byok:gemini";
const ANTHROPIC_KEY_STORAGE = "byok:anthropic";

type ProviderName = Settings["llmProvider"];

interface ProviderMeta {
  label: string;
  badge: string;
  badgeClass: string;
  blurb: string;
  keyPlaceholder: string;
  signupUrl: string;
  steps: string[];
}

const PROVIDERS: Record<ProviderName, ProviderMeta> = {
  gemini: {
    label: "Google Gemini Flash-Lite",
    badge: "Free",
    badgeClass: "bg-emerald-100 text-emerald-700",
    blurb: "1,000 requests/day. No credit card. ~30-second key setup.",
    keyPlaceholder: "AIza...",
    signupUrl: "https://aistudio.google.com/apikey",
    steps: [
      "Open Google AI Studio (link below)",
      'Click "Get API key" → "Create API key"',
      "Sign in with Google and accept terms (no card required)",
      'Copy the key (starts with "AIza...") and paste below',
    ],
  },
  anthropic: {
    label: "Anthropic Claude Haiku 4.5",
    badge: "Paid",
    badgeClass: "bg-amber-100 text-amber-700",
    blurb: "~$0.50/month at typical usage. Requires credit card.",
    keyPlaceholder: "sk-ant-...",
    signupUrl: "https://console.anthropic.com/settings/keys",
    steps: [
      "Open Anthropic Console (link below)",
      "Sign up and add billing info",
      'Settings → API Keys → "Create Key"',
      "Copy and paste below",
    ],
  },
};

export function App() {
  const [settings, setLocalSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [geminiKey, setGeminiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await chrome.storage.local.get([
        GEMINI_KEY_STORAGE,
        ANTHROPIC_KEY_STORAGE,
      ]);
      if (typeof stored[GEMINI_KEY_STORAGE] === "string") {
        setGeminiKey(stored[GEMINI_KEY_STORAGE] as string);
      }
      if (typeof stored[ANTHROPIC_KEY_STORAGE] === "string") {
        setAnthropicKey(stored[ANTHROPIC_KEY_STORAGE] as string);
      }

      const s = await getSettings();
      setLocalSettings(s);
    })();
  }, []);

  const activeProvider = settings.llmProvider;
  const activeMeta = PROVIDERS[activeProvider];
  const activeKey = activeProvider === "gemini" ? geminiKey : anthropicKey;
  const activeStorageKey =
    activeProvider === "gemini" ? GEMINI_KEY_STORAGE : ANTHROPIC_KEY_STORAGE;
  const setActiveKey =
    activeProvider === "gemini" ? setGeminiKey : setAnthropicKey;

  const saveKey = async () => {
    const trimmed = activeKey.trim();
    if (trimmed.length === 0) {
      await chrome.storage.local.remove(activeStorageKey);
      setStatus(`Cleared ${activeMeta.label} key.`);
    } else {
      await chrome.storage.local.set({ [activeStorageKey]: trimmed });
      setStatus(`Saved ${activeMeta.label} key.`);
    }
  };

  const clearKey = async () => {
    await chrome.storage.local.remove(activeStorageKey);
    setActiveKey("");
    setStatus(`Cleared ${activeMeta.label} key.`);
  };

  const updateSetting = async <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => {
    const next = await setSettings({ [key]: value } as Partial<Settings>);
    setLocalSettings(next);
    setStatus("Saved.");
  };

  const handleClassifyAll = async () => {
    setClassifying(true);
    setClassifyResult(
      "Classifying… (watch the SW devtools console for details)",
    );
    const result = await sendClassifyAll();
    if (result.ok) {
      setClassifyResult(
        `Done. Classified ${result.totalClassified} tab(s) across ` +
          `${result.windowsTouched} window(s). Errors: ${result.totalErrors}.`,
      );
    } else {
      setClassifyResult(`Failed: ${result.reason}`);
    }
    setClassifying(false);
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
        <h2 className="text-sm font-medium">LLM Provider</h2>
        <p className="mt-1 text-xs text-neutral-600">
          Which model classifies your tabs. Switch any time — keys are stored
          per provider.
        </p>
        <div className="mt-3 space-y-2">
          {(Object.keys(PROVIDERS) as ProviderName[]).map((name) => {
            const meta = PROVIDERS[name];
            const selected = activeProvider === name;
            return (
              <label
                key={name}
                className={
                  "flex cursor-pointer items-start gap-2 rounded-md border p-3 " +
                  (selected
                    ? "border-neutral-900 bg-white"
                    : "border-neutral-200 bg-white")
                }
              >
                <input
                  type="radio"
                  name="provider"
                  checked={selected}
                  onChange={() => void updateSetting("llmProvider", name)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm font-medium">
                    <span>{meta.label}</span>
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] " + meta.badgeClass
                      }
                    >
                      {meta.badge}
                    </span>
                    {name === "gemini" && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-neutral-600">
                    {meta.blurb}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">API Key — {activeMeta.label}</h2>
        <p className="mt-1 text-xs text-neutral-600">
          Stored locally in <code>chrome.storage.local</code>. The key only
          leaves your machine when making API calls to the provider.
        </p>
        <ol className="ml-5 mt-2 list-decimal space-y-1 text-xs text-neutral-700">
          {activeMeta.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <a
          href={activeMeta.signupUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-block text-xs text-blue-600 underline"
        >
          Open {activeProvider === "gemini" ? "Google AI Studio" : "Anthropic Console"}
          {" "}→
        </a>
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={activeKey}
            onChange={(e) => setActiveKey(e.target.value)}
            placeholder={activeMeta.keyPlaceholder}
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
        <div className="mt-3 rounded-md border border-neutral-200 bg-white p-3">
          <p className="text-xs text-neutral-600">
            Auto-classification of <em>already-open</em> tabs only runs once
            on install. If you set the API key after installing, click below
            to classify your current windows now.
          </p>
          <button
            type="button"
            onClick={() => void handleClassifyAll()}
            disabled={classifying}
            className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-neutral-300"
          >
            {classifying ? "Classifying…" : "Re-classify all open tabs now"}
          </button>
          {classifyResult && (
            <div className="mt-2 text-xs text-neutral-700">{classifyResult}</div>
          )}
        </div>
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
