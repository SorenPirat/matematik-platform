"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TaskRenderer from "@/components/TaskRenderer";
import {
  generateTask,
  Operation,
  DigitsSel,
  DecimalsSel,
  BorrowMode,
} from "@/utils/generateTask";
import { useLiveSession } from "@/hooks/useLiveSession";

type LayoutMode = "horizontal" | "vertical";
type Task = {
  operation: Operation;
  layout?: LayoutMode;
  problem: { operands: number[]; operator: string };
};

const LS_KEY = "practice_settings_v1";
type Settings = {
  operation: Operation;
  digitsSel: DigitsSel;
  decimalsSel: DecimalsSel;
  borrowMode: BorrowMode;
  layout: LayoutMode;
};

export default function PracticePage() {
  // --------------------------
  // 1) LOAD DEFAULTS
  // --------------------------
  const defaultSettings: Settings = {
    operation: "addition",
    digitsSel: 1,
    decimalsSel: 0,
    borrowMode: "mixed",
    layout: "horizontal",
  };

  const loadSettings = () => {
    if (typeof window === "undefined") return defaultSettings;
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return defaultSettings;
    try {
      const parsed = JSON.parse(saved);
      return {
        ...defaultSettings,
        ...parsed,
      };
    } catch {
      return defaultSettings;
    }
  };

  const createTaskFromSettings = (next: Settings): Task => ({
    ...generateTask({
      operation: next.operation,
      digitsSel: next.digitsSel,
      decimalsSel: next.decimalsSel,
      borrowMode: next.borrowMode,
    }),
    layout: next.layout,
  });

  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const router = useRouter();
  const {
    sessionCode,
    setSessionCode,
    alias,
    setAlias,
    isJoined,
    joining,
    joinError,
    hasGlobalIdentity,
    identityChecked,
    roomId,
    joinSession,
  } = useLiveSession({
    storageKey: "practice",
    trackLabel: "\u00d8velseszone",
    onInvalidSession: () => router.replace("/"),
  });

  
  useEffect(() => {
    if (!identityChecked) return;
    if (isJoined || joining) return;
    if (hasGlobalIdentity) return;
    router.replace("/");
  }, [identityChecked, isJoined, joining, hasGlobalIdentity, router]);

  // --------------------------
  // 2) SAVE SETTINGS
  // --------------------------
  useEffect(() => {
    if (!settingsReady) return;
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }, [settings, settingsReady]);

  // --------------------------
  // 3) TASK-STATE
  // --------------------------
  const [task, setTask] = useState<Task>(() =>
    createTaskFromSettings(defaultSettings)
  );

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setTask(createTaskFromSettings(loaded));
    setSettingsReady(true);
  }, []);

  // Rebuild task when settings change
  function rebuildTask(s: Settings = settings) {
    setTask(createTaskFromSettings(s));
  }

  function newTask() {
    rebuildTask(settings);
  }

  // --------------------------
  // 4) HANDLERS FOR UI-VALG
  // --------------------------
  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    rebuildTask(newSettings);
  }

  // --------------------------
  // 5) GLOBAL N-SHORTCUT
  // --------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key.toLowerCase() === "n" && !e.repeat) {
        e.preventDefault();
        newTask();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings]);

  const selectClass =
    "mt-2 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]";

  // --------------------------
  // 6) RENDER
  // --------------------------
  if (!isJoined) {
    if (hasGlobalIdentity) {
      return (
        <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-[var(--brand-2)]/20 blur-3xl float-slow"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-[var(--brand-1)]/20 blur-3xl float-slow"
          />
          <div className="relative mx-auto flex max-w-3xl flex-col gap-6">
            <header className="flex flex-col gap-4 rise-in">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Forbinder
              </p>
              <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
                Klar om et øjeblik
              </h1>
              <p className="max-w-2xl text-base text-slate-600">
                Vi forbinder til din session.
              </p>
            </header>
          </div>
        </main>
      );
    }

    return null;
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-[var(--brand-2)]/20 blur-3xl float-slow"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-[var(--brand-1)]/20 blur-3xl float-slow"
      />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between rise-in">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              {"\u00d8velsesarena"}
            </p>
            <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
              {"\u00d8velseszone"}
            </h1>
            <p className="max-w-xl text-base text-slate-600">
              {"Tr\u00e6n hurtige regnef\u00e6rdigheder i korte, energiske runder. Byg"}
              {" stime, skift mission, og hold tempoet h\u00f8jt."}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)]/80 px-4 py-3 shadow-[var(--shadow-1)]">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Genvej
              </div>
              <div className="text-lg font-semibold text-slate-800">
                N = ny opgave
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <div className="rise-in rise-in-delay-1">
            <TaskRenderer task={task} onRequestNewTask={newTask} roomId={roomId} />
          </div>

          <div className="rise-in rise-in-delay-2">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)]/90 p-6 shadow-[var(--shadow-1)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                    Missionskontrol
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    Indstillinger
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-[var(--panel-strong)] px-3 py-1 text-xs font-semibold text-slate-700">
                    Banevalg
                  </div>
                  <button
                    onClick={() => setShowSettings((prev) => !prev)}
                    className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:translate-y-[-1px]"
                  >
                    {showSettings ? "Skjul" : "Vis"}
                  </button>
                </div>
              </div>

              {showSettings ? (
                <div className="mt-6 grid gap-5">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Regneart
                    </label>
                    <select
                      className={selectClass}
                      value={settings.operation}
                      onChange={(e) =>
                        updateSetting("operation", e.target.value as Operation)
                      }
                    >
                      <option value="addition">Plus</option>
                      <option value="subtraction">Minus</option>
                      <option value="multiplication">Gange</option>
                      <option value="division">Division</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      {"Cifre f\u00f8r komma"}
                    </label>
                    <select
                      className={selectClass}
                      value={settings.digitsSel}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateSetting(
                          "digitsSel",
                          v === "mix" ? "mix" : (Number(v) as DigitsSel)
                        );
                      }}
                    >
                      <option value="1">1-cifret</option>
                      <option value="2">2-cifret</option>
                      <option value="3">3-cifret</option>
                      <option value="mix">Blandet</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Decimaler
                    </label>
                    <select
                      className={selectClass}
                      value={settings.decimalsSel}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateSetting(
                          "decimalsSel",
                          v === "mix" ? "mix" : (Number(v) as DecimalsSel)
                        );
                      }}
                    >
                      <option value="0">0 decimaler</option>
                      <option value="1">1 decimal</option>
                      <option value="2">2 decimaler</option>
                      <option value="mix">Blandet</option>
                    </select>
                  </div>

                  {settings.operation === "subtraction" && (
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        {"L\u00e5n ved minus"}
                      </label>
                      <select
                        className={selectClass}
                        value={settings.borrowMode}
                        onChange={(e) =>
                          updateSetting(
                            "borrowMode",
                            e.target.value as BorrowMode
                          )
                        }
                      >
                        <option value="mixed">Blandet</option>
                        <option value="with">{"Med l\u00e5n"}</option>
                        <option value="without">{"Uden l\u00e5n"}</option>
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Layout
                    </label>
                    <select
                      className={selectClass}
                      value={settings.layout}
                      onChange={(e) =>
                        updateSetting("layout", e.target.value as LayoutMode)
                      }
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-slate-600">
                  {"Indstillingerne er skjult. Tryk \"Vis\" for at \u00e5bne dem igen."}
                </div>
              )}

              <button
                onClick={newTask}
                className="mt-6 w-full rounded-full bg-[var(--brand-3)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200/40 transition hover:translate-y-[-1px] hover:bg-emerald-600"
              >
                Ny opgave
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}



