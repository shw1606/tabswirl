import { useCallback, useEffect, useState } from "react";
import { sendClassifyAll, sendRestorePouch } from "../core/messaging";
import { listPouches, removePouch } from "../core/pouch-store";
import { stashTabs } from "../core/stash";
import { isClassifiable } from "../core/tabs";
import type { ChromeGroupColor, Pouch } from "../core/types";
import { COLOR_DOT_CLASS } from "./colors";
import { allTabIds, buildTabTree, type TabTree } from "./tab-tree";

type View = "stash" | "pouches";

export function App() {
  const [view, setView] = useState<View>("stash");
  const [tree, setTree] = useState<TabTree | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pouches, setPouches] = useState<Pouch[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [classifyAllCount, setClassifyAllCount] = useState<number>(0);
  const [reclassifying, setReclassifying] = useState(false);

  const refreshTree = useCallback(async () => {
    const [tabs, groups, win] = await Promise.all([
      chrome.tabs.query({ currentWindow: true }),
      // chrome.tabGroups.query returns groups across all windows when no
      // filter is given; pass currentWindow via lastFocused id below.
      chrome.windows.getCurrent(),
      chrome.windows.getCurrent(),
    ]);
    const wid = win.id ?? null;
    setWindowId(wid);
    const tabGroupList =
      wid !== null
        ? await chrome.tabGroups.query({ windowId: wid })
        : [];
    const t = buildTabTree({
      tabs,
      groups: tabGroupList.map((g) => ({
        id: g.id,
        title: g.title ?? "",
        color: g.color as ChromeGroupColor,
      })),
    });
    setTree(t);
    setSelected(new Set(allTabIds(t)));
  }, []);

  const refreshPouches = useCallback(async () => {
    setPouches(await listPouches());
  }, []);

  const refreshClassifyAllCount = useCallback(async () => {
    const all = await chrome.tabs.query({});
    setClassifyAllCount(all.filter((t) => isClassifiable(t)).length);
  }, []);

  useEffect(() => {
    void refreshTree();
    void refreshPouches();
    void refreshClassifyAllCount();
  }, [refreshTree, refreshPouches, refreshClassifyAllCount]);

  const toggleTab = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (groupId: number) =>
    setSelected((prev) => {
      if (!tree) return prev;
      const group = tree.groups.find((g) => g.groupId === groupId);
      if (!group) return prev;
      const groupIds = group.tabs.map((t) => t.id);
      const allOn = groupIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) for (const id of groupIds) next.delete(id);
      else for (const id of groupIds) next.add(id);
      return next;
    });

  const handleStash = async () => {
    if (!tree || windowId === null) return;
    if (selected.size === 0) {
      setStatusMessage("Pick at least one tab to stash.");
      return;
    }
    const tabs = await chrome.tabs.query({ windowId });
    const tabGroupList = await chrome.tabGroups.query({ windowId });
    await stashTabs({
      tabs,
      groups: tabGroupList.map((g) => ({
        id: g.id,
        title: g.title ?? "",
        color: g.color as ChromeGroupColor,
      })),
      selectedTabIds: selected,
    });
    await refreshTree();
    await refreshPouches();
    setView("pouches");
    setStatusMessage(`Stashed ${selected.size} tab(s).`);
  };

  const handleRestore = async (pouchId: string) => {
    setStatusMessage("Restoring…");
    const result = await sendRestorePouch(pouchId);
    if (result.ok) {
      setStatusMessage(`Restored ${result.tabsOpened} tab(s).`);
    } else {
      setStatusMessage(`Restore failed: ${result.reason}`);
    }
    await refreshTree();
    await refreshPouches();
  };

  const handleDiscard = async (pouchId: string) => {
    if (
      !confirm("Discard this Pouch? This cannot be undone.")
    ) {
      return;
    }
    await removePouch(pouchId);
    await refreshPouches();
    setStatusMessage("Discarded.");
  };

  const handleOpenSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  const handleOpenSwDevtools = () => {
    // Jump to TabSwirl's card on chrome://extensions. From there it's
    // one click to "service worker" → devtools. There's no public API
    // to open the SW devtools directly.
    void chrome.tabs.create({
      url: `chrome://extensions/?id=${chrome.runtime.id}`,
    });
  };

  const handleReclassifyAll = async () => {
    if (reclassifying) return;
    setReclassifying(true);
    setStatusMessage("Re-classifying…");
    const result = await sendClassifyAll();
    if (result.ok) {
      setStatusMessage(
        `Classified ${result.totalClassified} tab(s) across ${result.windowsTouched} window(s). Errors: ${result.totalErrors}.`,
      );
    } else {
      setStatusMessage(`Failed: ${result.reason}`);
    }
    setReclassifying(false);
    await refreshTree();
    await refreshClassifyAllCount();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <div className="text-sm font-semibold">TabSwirl</div>
        <nav className="flex gap-1 text-xs">
          <TabButton
            active={view === "stash"}
            onClick={() => setView("stash")}
            label="Stash"
          />
          <TabButton
            active={view === "pouches"}
            onClick={() => setView("pouches")}
            label={`Pouches (${pouches.length})`}
          />
        </nav>
      </header>

      {statusMessage && (
        <div className="border-b border-neutral-200 bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700">
          {statusMessage}
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        {view === "stash" ? (
          <StashView
            tree={tree}
            selected={selected}
            onToggleTab={toggleTab}
            onToggleGroup={toggleGroup}
          />
        ) : (
          <PouchesView
            pouches={pouches}
            onRestore={handleRestore}
            onDiscard={handleDiscard}
          />
        )}
      </main>

      {view === "stash" && (
        <footer className="border-t border-neutral-200 px-3 py-2">
          <button
            type="button"
            onClick={handleStash}
            disabled={selected.size === 0}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
          >
            Stash {selected.size} tab{selected.size === 1 ? "" : "s"}
          </button>
        </footer>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] text-neutral-600">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenSettings}
            className="hover:text-neutral-900 hover:underline"
            title="Open the options page"
          >
            Settings
          </button>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={handleOpenSwDevtools}
            className="hover:text-neutral-900 hover:underline"
            title="Open chrome://extensions to access the service-worker devtools"
          >
            SW devtools
          </button>
        </div>
        <button
          type="button"
          onClick={() => void handleReclassifyAll()}
          disabled={reclassifying}
          className="hover:text-neutral-900 hover:underline disabled:text-neutral-400"
          title="Re-run domain rules + LLM cascade on every open tab"
        >
          {reclassifying
            ? "Classifying…"
            : `Re-classify ${classifyAllCount} tab${classifyAllCount === 1 ? "" : "s"}`}
        </button>
      </footer>
    </div>
  );
}

function TabButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={
        "rounded-md px-2 py-1 " +
        (props.active
          ? "bg-neutral-900 text-white"
          : "text-neutral-600 hover:bg-neutral-100")
      }
    >
      {props.label}
    </button>
  );
}

function StashView(props: {
  tree: TabTree | null;
  selected: Set<number>;
  onToggleTab: (id: number) => void;
  onToggleGroup: (groupId: number) => void;
}) {
  if (!props.tree) {
    return <div className="px-3 py-2 text-xs text-neutral-500">Loading…</div>;
  }
  if (
    props.tree.groups.length === 0 &&
    props.tree.ungrouped.length === 0
  ) {
    return (
      <div className="px-3 py-2 text-xs text-neutral-500">
        No tabs in this window.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-2">
      {props.tree.groups.map((g) => {
        const ids = g.tabs.map((t) => t.id);
        const allOn = ids.length > 0 && ids.every((id) => props.selected.has(id));
        const someOn = ids.some((id) => props.selected.has(id));
        return (
          <section key={g.groupId} className="rounded-md border border-neutral-200 bg-white">
            <header className="flex items-center gap-2 px-2 py-1.5">
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = !allOn && someOn;
                }}
                onChange={() => props.onToggleGroup(g.groupId)}
              />
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_DOT_CLASS[g.color]}`} />
              <span className="text-sm font-medium">{g.name}</span>
              <span className="text-xs text-neutral-500">({g.tabs.length})</span>
            </header>
            <ul>
              {g.tabs.map((t) => (
                <TabRow
                  key={t.id}
                  tab={t}
                  checked={props.selected.has(t.id)}
                  onToggle={() => props.onToggleTab(t.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {props.tree.ungrouped.length > 0 && (
        <section className="rounded-md border border-neutral-200 bg-white">
          <header className="flex items-center gap-2 px-2 py-1.5">
            <span className="text-sm font-medium text-neutral-700">
              Ungrouped
            </span>
            <span className="text-xs text-neutral-500">
              ({props.tree.ungrouped.length})
            </span>
          </header>
          <ul>
            {props.tree.ungrouped.map((t) => (
              <TabRow
                key={t.id}
                tab={t}
                checked={props.selected.has(t.id)}
                onToggle={() => props.onToggleTab(t.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TabRow(props: {
  tab: { id: number; title: string; url: string; favIconUrl?: string };
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-2 border-t border-neutral-100 px-2 py-1.5">
      <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
      {props.tab.favIconUrl ? (
        <img src={props.tab.favIconUrl} alt="" className="h-4 w-4" />
      ) : (
        <span className="h-4 w-4 rounded bg-neutral-200" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs text-neutral-900">
          {props.tab.title || props.tab.url}
        </span>
        <span className="truncate text-[10px] text-neutral-500">
          {props.tab.url}
        </span>
      </div>
    </li>
  );
}

function PouchesView(props: {
  pouches: Pouch[];
  onRestore: (id: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}) {
  if (props.pouches.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-neutral-500">
        No pouches yet. Stash some tabs to create one.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2 p-2">
      {props.pouches.map((p) => (
        <li
          key={p.id}
          className="rounded-md border border-neutral-200 bg-white p-2"
        >
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium">
              {p.label ?? "Pouch"}
            </div>
            <div className="text-[10px] text-neutral-500">
              {new Date(p.createdAt).toLocaleString()}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {p.groups.map((g) => (
              <span
                key={g.name}
                className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px]"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${COLOR_DOT_CLASS[g.color]}`}
                />
                {g.name} ({g.tabs.length})
              </span>
            ))}
            {p.ungrouped.tabs.length > 0 && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                +{p.ungrouped.tabs.length} ungrouped
              </span>
            )}
            <span className="text-[10px] text-neutral-500">
              · {p.totalTabs} tab{p.totalTabs === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void props.onRestore(p.id)}
              className="flex-1 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => void props.onDiscard(p.id)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700"
            >
              Discard
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
