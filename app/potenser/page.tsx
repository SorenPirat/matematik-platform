
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LiveEvent } from "@/utils/liveTypes";
import { useLiveSession } from "@/hooks/useLiveSession";
import { sendLiveEvent } from "@/utils/liveRealtime";
import Whiteboard from "@/components/Whiteboard";

type Operation = "multiply" | "divide" | "mixed";
type Range = "small" | "medium" | "large";

type Task = {
  operation: Exclude<Operation, "mixed">;
  base: string;
  exponent: number;
  expected: string;
};

type Settings = {
  operation: Operation;
  range: Range;
};

const LS_STREAK = "potenser_streak_v1";
const LS_BEST_STREAK = "potenser_best_streak_v1";
const LS_SETTINGS = "potenser_settings_v1";
const AUTO_NEXT_MS = 1600;
const MAX_ANSWER_LEN = 20;

const ranges: Record<
  Range,
  { expMax: number; digits: [number, number]; decMax: number }
> = {
  small: { expMax: 3, digits: [1, 2], decMax: 1 },
  medium: { expMax: 6, digits: [2, 3], decMax: 2 },
  large: { expMax: 9, digits: [2, 4], decMax: 3 },
};

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeNumberString(raw: string) {
  let s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!s) return null;
  if (!/^-?\d*(\.\d*)?$/.test(s)) return null;
  if (s === "." || s === "-") return null;
  if (s.startsWith(".")) s = `0${s}`;
  const [intPartRaw, fracPartRaw] = s.split(".");
  const intPart = intPartRaw.replace(/^(-?)0+(?=\d)/, "$1") || "0";
  const fracPart = fracPartRaw?.replace(/0+$/, "") ?? "";
  if (!fracPart) return intPart;
  return `${intPart}.${fracPart}`;
}

function shiftDecimal(base: string, exponent: number, op: "multiply" | "divide") {
  const normalized = normalizeNumberString(base);
  if (!normalized) return "0";
  const parts = normalized.split(".");
  let digits = parts.join("");
  let pos = parts[0].startsWith("-") ? parts[0].length - 1 : parts[0].length;
  const negative = parts[0].startsWith("-");
  if (negative) digits = digits.replace("-", "");

  let newPos = op === "multiply" ? pos + exponent : pos - exponent;
  if (newPos <= 0) {
    digits = "0".repeat(-newPos) + digits;
    newPos = 0;
  }
  if (newPos >= digits.length) {
    digits = digits + "0".repeat(newPos - digits.length);
    newPos = digits.length;
  }

  const withDot =
    newPos === digits.length
      ? digits
      : `${digits.slice(0, newPos)}.${digits.slice(newPos)}`;
  const result = normalizeNumberString(withDot) ?? "0";
  return negative ? `-${result}` : result;
}

function randomBase(range: Range) {
  const { digits, decMax } = ranges[range];
  const digitsCount = randInt(digits[0], digits[1]);
  const decimals = randInt(0, decMax);
  const first = String(randInt(1, 9));
  let rest = "";
  for (let i = 1; i < digitsCount; i += 1) {
    rest += String(randInt(0, 9));
  }
  let frac = "";
  for (let i = 0; i < decimals; i += 1) {
    frac += String(randInt(0, 9));
  }
  const base = decimals > 0 ? `${first}${rest}.${frac}` : `${first}${rest}`;
  return normalizeNumberString(base) ?? "1";
}

function buildTask(settings: Settings): Task {
  const op =
    settings.operation === "mixed"
      ? Math.random() < 0.5
        ? "multiply"
        : "divide"
      : settings.operation;
  const exponent = randInt(1, ranges[settings.range].expMax);
  const base = randomBase(settings.range);
  const expected = shiftDecimal(base, exponent, op);
  return { operation: op, exponent, base, expected };
}

function formatDisplay(value: string) {
  return value.replace(".", ",");
}

function toSuperscript(value: number) {
  const map: Record<string, string> = {
    "0": "°",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "4",
    "5": "5",
    "6": "6",
    "7": "7",
    "8": "8",
    "9": "?",
    "-": "?",
  };
  return String(value)
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("");
}
export default function PotenserPage() {
  const defaultSettings: Settings = {
    operation: "mixed",
    range: "small",
  };

  const loadSettings = () => {
    if (typeof window === "undefined") return defaultSettings;
    const saved = localStorage.getItem(LS_SETTINGS);
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

  const router = useRouter();
  const {
    isJoined,
    joining,
    hasGlobalIdentity,
    identityChecked,
    roomId,
  } = useLiveSession({
    storageKey: "potenser",
    trackLabel: "Potenser af 10",
    onInvalidSession: () => router.replace("/"),
  });
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [task, setTask] = useState<Task>(() => buildTask(defaultSettings));
  const [settingsReady, setSettingsReady] = useState(false);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "idle" | "correct" | "wrong" | "error" | "info";
    message: string;
  }>({ type: "idle", message: "" });
  const [revealed, setRevealed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const autoNextRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readNumber = (key: string, fallback: number) => {
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const [streak, setStreak] = useState(() => readNumber(LS_STREAK, 0));
  const [bestStreak, setBestStreak] = useState(() =>
    readNumber(LS_BEST_STREAK, 0)
  );
  const statsRef = useRef({ attempts: 0, correct: 0 });

  useEffect(() => {
    if (!settingsReady) return;
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  }, [settings, settingsReady]);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setTask(buildTask(loaded));
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    if (!identityChecked) return;
    if (isJoined || joining) return;
    if (hasGlobalIdentity) return;
    router.replace("/");
  }, [identityChecked, isJoined, joining, hasGlobalIdentity, router]);
  useEffect(() => {
    if (!roomId) return;
    if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current);
    inputDebounceRef.current = setTimeout(() => {
      emitLiveEvent({ type: "input", value: answer, ts: Date.now() });
    }, 140);
    return () => {
      if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current);
    };
  }, [answer, roomId]);

  useEffect(() => {
    return () => {
      if (autoNextRef.current) {
        clearTimeout(autoNextRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    localStorage.setItem(LS_STREAK, String(streak));
  }, [streak]);

  useEffect(() => {
    localStorage.setItem(LS_BEST_STREAK, String(bestStreak));
  }, [bestStreak]);

  const equationText = useMemo(() => {
    const base = formatDisplay(task.base);
    const symbol = task.operation === "multiply" ? "×" : "÷";
    return `${base} ${symbol} 10${toSuperscript(task.exponent)}`;
  }, [task]);

  useEffect(() => {
    if (!roomId) return;
    emitLiveEvent({
      type: "task",
      equation: equationText,
      operation: "Potenser af 10",
      ts: Date.now(),
    });
  }, [roomId, equationText]);

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (autoNextRef.current) {
      clearTimeout(autoNextRef.current);
      autoNextRef.current = null;
    }
    const next = { ...settings, [key]: value };
    setSettings(next);
    setTask(buildTask(next));
    setAnswer("");
    setFeedback({ type: "idle", message: "" });
    setRevealed(false);
  }

  function newTask() {
    if (autoNextRef.current) {
      clearTimeout(autoNextRef.current);
      autoNextRef.current = null;
    }
    setTask(buildTask(settings));
    setAnswer("");
    setFeedback({ type: "idle", message: "" });
    setRevealed(false);
  }

  function parseAnswer() {
    return normalizeNumberString(answer);
  }

  function checkAnswer() {
    emitLiveEvent({ type: "action", action: "check", ts: Date.now() });
    statsRef.current.attempts += 1;
    if (revealed) {
      setFeedback({
        type: "info",
        message: "Facit er vist. Lav en ny opgave for at fortsætte.",
      });
      emitLiveEvent({
        type: "result",
        attempts: statsRef.current.attempts,
        correct: statsRef.current.correct,
        streak,
        ts: Date.now(),
      });
      return;
    }
    const parsed = parseAnswer();
    if (!parsed) {
      setFeedback({
        type: "error",
        message: "Skriv et gyldigt tal. Brug komma ved decimaltal.",
      });
      return;
    }
    const expected = normalizeNumberString(task.expected) ?? task.expected;
    if (parsed === expected) {
      setFeedback({ type: "correct", message: "Korrekt! Flot arbejde." });
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      statsRef.current.correct += 1;
      emitLiveEvent({
        type: "result",
        attempts: statsRef.current.attempts,
        correct: statsRef.current.correct,
        streak: nextStreak,
        ts: Date.now(),
      });
      if (nextStreak > bestStreak) {
        setBestStreak(nextStreak);
      }
      setRevealed(true);
      if (autoNextRef.current) {
        clearTimeout(autoNextRef.current);
      }
      autoNextRef.current = setTimeout(() => {
        newTask();
      }, AUTO_NEXT_MS);
      return;
    }
    setFeedback({
      type: "wrong",
      message: "Ikke helt. Prøv igen.",
    });
    setStreak(0);
    emitLiveEvent({
      type: "result",
      attempts: statsRef.current.attempts,
      correct: statsRef.current.correct,
      streak: 0,
      ts: Date.now(),
    });
  }

  function revealAnswer() {
    emitLiveEvent({ type: "action", action: "reveal", ts: Date.now() });
    setRevealed(true);
    setFeedback({
      type: "info",
      message: `Facit: ${formatDisplay(task.expected)}.`,
    });
    setStreak(0);
    emitLiveEvent({
      type: "result",
      attempts: statsRef.current.attempts,
      correct: statsRef.current.correct,
      streak: 0,
      ts: Date.now(),
    });
  }
  function emitLiveEvent(event: LiveEvent) {
    if (!roomId) return;
    sendLiveEvent(roomId, event);
  }

  const level = Math.floor(streak / 5) + 1;
  const progressInLevel = streak % 5;
  const progress = progressInLevel / 5;
  const toNext = progressInLevel === 0 ? 5 : 5 - progressInLevel;

  const selectClass =
    "mt-2 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]";

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
              Potenser af 10
            </p>
            <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
              Potensværksted
            </h1>
            <p className="max-w-xl text-base text-slate-600">
              Træn at flytte kommaet ved at gange og dividere med 10^n.
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
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)]/90 p-6 shadow-[var(--shadow-1)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                    Opgave
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    Flyt kommaet
                  </h2>
                </div>
                <div className="min-w-[180px] rounded-2xl border border-[var(--border)] bg-[var(--panel)]/80 px-4 py-3 shadow-[var(--shadow-1)]">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Niveau {level}
                  </div>
                  <div className="text-lg font-semibold text-slate-800">
                    {streak} streak
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full rounded-full bg-[var(--brand-2)] transition-all"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {toNext} til næste level
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-center gap-4 text-2xl font-semibold text-slate-900">
                  <span>{formatDisplay(task.base)}</span>
                  <span className="text-3xl text-slate-600">
                    {task.operation === "multiply" ? "×" : "÷"}
                  </span>
                  <span>
                    10<sup className="text-base">{task.exponent}</sup>
                  </span>
                  <span className="text-3xl text-slate-600">=</span>
                  <span className="text-2xl text-slate-500">?</span>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col items-center gap-2">
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Svar
                    </label>
                    <input
                      value={answer}
                      onChange={(e) =>
                        setAnswer(e.target.value.slice(0, MAX_ANSWER_LEN))
                      }
                      inputMode="decimal"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") checkAnswer();
                      }}
                      disabled={revealed}
                      maxLength={MAX_ANSWER_LEN}
                      className="w-44 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-center text-lg font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]"
                      placeholder="Skriv dit svar"
                    />
                  </div>

                  <div className="flex w-full flex-col gap-3 sm:flex-row">
                    <button
                      onClick={checkAnswer}
                      disabled={revealed}
                      className="flex-1 rounded-full bg-[var(--brand-2)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200/50 transition hover:translate-y-[-1px] hover:bg-blue-600 disabled:opacity-50"
                    >
                      Tjek svar
                    </button>
                    <button
                      onClick={revealAnswer}
                      disabled={revealed}
                      className="flex-1 rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:translate-y-[-1px] disabled:opacity-50"
                    >
                      Vis facit
                    </button>
                    <button
                      onClick={() => setShowCanvas((prev) => !prev)}
                      className="flex-1 rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:translate-y-[-1px]"
                    >
                      {showCanvas ? "Skjul whiteboard" : "Whiteboard"}
                    </button>
                  </div>
                </div>

                {feedback.type !== "idle" && (
                  <div
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      feedback.type === "correct"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : feedback.type === "wrong"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : feedback.type === "info"
                        ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    {feedback.message}
                  </div>
                )}
                <p className="text-sm text-slate-500">
                  Tip: Tryk Enter for at tjekke, og N for ny opgave.
                </p>
              </div>
            </div>

            <Whiteboard
              visible={showCanvas}
              roomId={roomId}
              resetKey={task}
              enableWheelZoom
              enablePinchZoom
              showZoomButtons={false}
              blockPageScroll
            />
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
                  <button
                    onClick={() => setShowSettings((prev) => !prev)}
                    aria-label={
                      showSettings ? "Skjul indstillinger" : "Vis indstillinger"
                    }
                    title={
                      showSettings ? "Skjul indstillinger" : "Vis indstillinger"
                    }
                    className="flex items-center justify-center rounded-full border border-black/10 bg-white p-2 text-slate-700 shadow-sm transition"
                  >
                    <img
                      src="/gear.png"
                      alt=""
                      aria-hidden="true"
                      className="h-4 w-4"
                    />
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
                      <option value="mixed">Blandet</option>
                      <option value="multiply">Gange</option>
                      <option value="divide">Divider</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Sværhedsgrad
                    </label>
                    <select
                      className={selectClass}
                      value={settings.range}
                      onChange={(e) =>
                        updateSetting("range", e.target.value as Range)
                      }
                    >
                      <option value="small">Level 1</option>
                      <option value="medium">Level 2</option>
                      <option value="large">Level 3</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-slate-600">
                  Indstillingerne er skjult. Tryk på tandhjulet for at åbne dem
                  igen.
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


