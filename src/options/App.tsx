import { useEffect, useState } from "react";
import { isChromeAiAvailable } from "../llm/chrome-ai";
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

// Gemini is intentionally not listed — its 15-20 RPM free-tier limit
// makes it impractical for continuous tab classification. The provider
// implementation stays in the codebase for users who opt in via storage,
// but it isn't surfaced here. See WORK_LOG (Step-4 of the cascade work)
// for rationale.
const PROVIDERS: Partial<Record<ProviderName, ProviderMeta>> = {
  anthropic: {
    label: "Anthropic Claude Haiku 4.5",
    badge: "BYOK",
    badgeClass: "bg-amber-100 text-amber-700",
    blurb:
      "Used as fallback when Chrome's built-in AI isn't ready. ~$0.01/month at typical usage. Requires credit card on Anthropic.",
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
  const [anthropicKey, setAnthropicKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<string | null>(null);
  const [chromeAiReady, setChromeAiReady] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await chrome.storage.local.get([ANTHROPIC_KEY_STORAGE]);
      if (typeof stored[ANTHROPIC_KEY_STORAGE] === "string") {
        setAnthropicKey(stored[ANTHROPIC_KEY_STORAGE] as string);
      }
      const s = await getSettings();
      setLocalSettings(s);
      setChromeAiReady(await isChromeAiAvailable());
    })();
  }, []);

  // Anthropic is the only user-facing BYOK option. Gemini support stays
  // in the codebase for power-users who flip llmProvider via storage.
  const activeMeta = PROVIDERS.anthropic!;

  const saveKey = async () => {
    const trimmed = anthropicKey.trim();
    if (trimmed.length === 0) {
      await chrome.storage.local.remove(ANTHROPIC_KEY_STORAGE);
      setStatus(`Cleared ${activeMeta.label} key.`);
    } else {
      await chrome.storage.local.set({ [ANTHROPIC_KEY_STORAGE]: trimmed });
      setStatus(`Saved ${activeMeta.label} key.`);
    }
  };

  const clearKey = async () => {
    await chrome.storage.local.remove(ANTHROPIC_KEY_STORAGE);
    setAnthropicKey("");
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
        <h2 className="text-sm font-medium">Classification</h2>
        <p className="mt-1 text-xs text-neutral-600">
          TabSwirl classifies in three tiers, cheapest first:
        </p>
        <ol className="ml-5 mt-2 list-decimal space-y-1 text-xs text-neutral-700">
          <li>
            <strong>Domain rules</strong> — well-known sites like youtube.com /
            github.com are categorized instantly with no LLM call.
          </li>
          <li>
            <strong>Chrome built-in AI</strong> — on-device Gemini Nano. Free,
            no key, no network.{" "}
            {chromeAiReady === null ? (
              <em>Checking availability…</em>
            ) : chromeAiReady ? (
              <span className="rounded bg-emerald-100 px-1 py-0.5 text-emerald-700">
                ✓ Ready
              </span>
            ) : (
              <span className="rounded bg-neutral-200 px-1 py-0.5 text-neutral-600">
                ✗ Unavailable — install Chrome 148+, sign in with Sync, and try
                again. Falls back to your BYOK key below.
              </span>
            )}
          </li>
          <li>
            <strong>BYOK provider</strong> — used when the first two tiers
            don't fire.
          </li>
        </ol>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">{activeMeta.label} (BYOK)</h2>
        <p className="mt-1 text-xs text-neutral-600">{activeMeta.blurb}</p>
        <p className="mt-1 text-xs text-neutral-600">
          Stored locally in <code>chrome.storage.local</code>. The key only
          leaves your machine when making API calls to Anthropic.
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
          Open Anthropic Console →
        </a>
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
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
