"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LiveEvent } from "@/utils/liveTypes";
import { useLiveSession } from "@/hooks/useLiveSession";
import { sendLiveEvent } from "@/utils/liveRealtime";
import Whiteboard from "@/components/Whiteboard";

type Difficulty = "easy" | "medium" | "hard";
type GivenType = "fraction" | "decimal" | "percent";

type Fraction = { n: number; d: number };
type Task = {
  givenType: GivenType;
  fraction: Fraction;
  decimal: string;
  percent: string;
  label: string;
};

type Settings = {
  difficulty: Difficulty;
};

const LS_STREAK = "omskrivning_streak_v1";
const LS_BEST_STREAK = "omskrivning_best_streak_v1";
const LS_SETTINGS = "omskrivning_settings_v1";
const AUTO_NEXT_MS = 1600;
const MAX_ANSWER_LEN = 20;

const difficulties: Record<
  Difficulty,
  { denominators: number[]; numeratorMaxFactor: number; label: string }
> = {
  easy: {
    denominators: [2, 4, 5, 10, 20, 25, 50],
    numeratorMaxFactor: 1,
    label: "Let",
  },
  medium: {
    denominators: [4, 5, 8, 10, 16, 20, 25, 40, 50, 125],
    numeratorMaxFactor: 2,
    label: "Mellem",
  },
  hard: {
    denominators: [8, 10, 16, 20, 32, 40, 50, 64, 100, 125, 200, 250, 500],
    numeratorMaxFactor: 3,
    label: "SvÃ¦r",
  },
};

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function gcd(a: number, b: number) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function simplifyFraction(f: Fraction): Fraction {
  const sign = f.d < 0 ? -1 : 1;
  const n = f.n * sign;
  const d = f.d * sign;
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function decimalFromFraction(n: number, d: number) {
  const sign = n < 0 ? "-" : "";
  let nn = Math.abs(n);
  let dd = Math.abs(d);
  const g = gcd(nn, dd);
  nn /= g;
  dd /= g;
  let tmp = dd;
  let pow2 = 0;
  let pow5 = 0;
  while (tmp % 2 === 0) {
    pow2 += 1;
    tmp /= 2;
  }
  while (tmp % 5 === 0) {
    pow5 += 1;
    tmp /= 5;
  }
  if (tmp !== 1) {
    const fallback = (sign ? -1 : 1) * (nn / dd);
    return String(fallback);
  }
  const k = Math.max(pow2, pow5);
  const scale = 10 ** k;
  const value = (nn * scale) / dd;
  let digits = String(value);
  if (k === 0) return sign + digits;
  if (digits.length <= k) digits = digits.padStart(k + 1, "0");
  const intPart = digits.slice(0, digits.length - k);
  const fracPart = digits.slice(digits.length - k);
  let s = `${intPart}.${fracPart}`;
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return sign + s;
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

function normalizePercentInput(raw: string) {
  const trimmed = raw.replace("%", "");
  return normalizeNumberString(trimmed);
}

function formatFractionDisplay(value: Fraction) {
  if (value.d === 1) return String(value.n);
  return `${value.n}/${value.d}`;
}

function formatDecimalDisplay(value: string) {
  return value.replace(".", ",");
}

function parseFraction(raw: string): Fraction | null {
  const s = raw.trim().replace(/\s+/g, "");
  if (!s) return null;
  if (s.includes("/")) {
    const [nRaw, dRaw] = s.split("/");
    if (!nRaw || !dRaw) return null;
    const n = Number.parseInt(nRaw, 10);
    const d = Number.parseInt(dRaw, 10);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return simplifyFraction({ n, d });
  }
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return simplifyFraction({ n, d: 1 });
}

function buildTask(settings: Settings): Task {
  const { denominators, numeratorMaxFactor, label } =
    difficulties[settings.difficulty];
  const d = denominators[randInt(0, denominators.length - 1)];
  const maxNumerator = d * numeratorMaxFactor;
  const n = randInt(1, Math.max(1, maxNumerator));
  const fraction = simplifyFraction({ n, d });
  const decimal = decimalFromFraction(fraction.n, fraction.d);
  const percent = decimalFromFraction(fraction.n * 100, fraction.d);
  const givenType = (["fraction", "decimal", "percent"] as const)[
    randInt(0, 2)
  ];
  return { givenType, fraction, decimal, percent, label };
}

export default function OmskrivningPage() {
  const defaultSettings: Settings = { difficulty: "easy" };

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
    storageKey: "omskrivning",
    trackLabel: "Omskrivning",
    onInvalidSession: () => router.replace("/"),
  });
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [task, setTask] = useState<Task>(() => buildTask(defaultSettings));
  const [settingsReady, setSettingsReady] = useState(false);
  const [answerFraction, setAnswerFraction] = useState("");
  const [answerDecimal, setAnswerDecimal] = useState("");
  const [answerPercent, setAnswerPercent] = useState("");
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
    const value = [answerFraction, answerDecimal, answerPercent]
      .filter(Boolean)
      .join(" | ");
    inputDebounceRef.current = setTimeout(() => {
      emitLiveEvent({ type: "input", value, ts: Date.now() });
    }, 140);
    return () => {
      if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current);
    };
  }, [answerFraction, answerDecimal, answerPercent, roomId]);

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

  const givenDisplay = useMemo(() => {
    if (task.givenType === "fraction") {
      return formatFractionDisplay(task.fraction);
    }
    if (task.givenType === "decimal") {
      return formatDecimalDisplay(task.decimal);
    }
    return `${formatDecimalDisplay(task.percent)}%`;
  }, [task]);

  const givenLabel = useMemo(() => {
    if (task.givenType === "fraction") return "BrÃ¸k";
    if (task.givenType === "decimal") return "Decimaltal";
    return "Procent";
  }, [task.givenType]);

  const equationText = useMemo(() => {
    return `Omskriv: ${givenDisplay}`;
  }, [givenDisplay]);

  const operationLabel = useMemo(
    () => `Omskrivning (${task.label})`,
    [task.label]
  );

  useEffect(() => {
    if (!roomId) return;
    emitLiveEvent({
      type: "task",
      equation: equationText,
      operation: operationLabel,
      ts: Date.now(),
    });
  }, [roomId, equationText, operationLabel]);

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (autoNextRef.current) {
      clearTimeout(autoNextRef.current);
      autoNextRef.current = null;
    }
    const next = { ...settings, [key]: value };
    setSettings(next);
    setTask(buildTask(next));
    setAnswerFraction("");
    setAnswerDecimal("");
    setAnswerPercent("");
    setFeedback({ type: "idle", message: "" });
    setRevealed(false);
  }

  function newTask() {
    if (autoNextRef.current) {
      clearTimeout(autoNextRef.current);
      autoNextRef.current = null;
    }
    setTask(buildTask(settings));
    setAnswerFraction("");
    setAnswerDecimal("");
    setAnswerPercent("");
    setFeedback({ type: "idle", message: "" });
    setRevealed(false);
  }

  function checkAnswer() {
    emitLiveEvent({ type: "action", action: "check", ts: Date.now() });
    statsRef.current.attempts += 1;
    if (revealed) {
      setFeedback({
        type: "info",
        message: "Facit er vist. Lav en ny opgave for at fortsÃ¦tte.",
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

    if (task.givenType !== "fraction") {
      const parsed = parseFraction(answerFraction);
      if (!parsed) {
        setFeedback({
          type: "error",
          message: "Skriv en gyldig brÃ¸k som fx 1/2.",
        });
        return;
      }
      const expected = simplifyFraction(task.fraction);
      if (parsed.n !== expected.n || parsed.d !== expected.d) {
        setFeedback({ type: "wrong", message: "Ikke helt. PrÃ¸v igen." });
        setStreak(0);
        emitLiveEvent({
          type: "result",
          attempts: statsRef.current.attempts,
          correct: statsRef.current.correct,
          streak: 0,
          ts: Date.now(),
        });
        return;
      }
    }

    if (task.givenType !== "decimal") {
      const parsed = normalizeNumberString(answerDecimal);
      const expected = normalizeNumberString(task.decimal);
      if (!parsed || !expected) {
        setFeedback({
          type: "error",
          message: "Skriv et gyldigt decimaltal.",
        });
        return;
      }
      if (parsed !== expected) {
        setFeedback({ type: "wrong", message: "Ikke helt. PrÃ¸v igen." });
        setStreak(0);
        emitLiveEvent({
          type: "result",
          attempts: statsRef.current.attempts,
          correct: statsRef.current.correct,
          streak: 0,
          ts: Date.now(),
        });
        return;
      }
    }

    if (task.givenType !== "percent") {
      const parsed = normalizePercentInput(answerPercent);
      const expected = normalizeNumberString(task.percent);
      if (!parsed || !expected) {
        setFeedback({
          type: "error",
          message: "Skriv et gyldigt procenttal.",
        });
        return;
      }
      if (parsed !== expected) {
        setFeedback({ type: "wrong", message: "Ikke helt. PrÃ¸v igen." });
        setStreak(0);
        emitLiveEvent({
          type: "result",
          attempts: statsRef.current.attempts,
          correct: statsRef.current.correct,
          streak: 0,
          ts: Date.now(),
        });
        return;
      }
    }

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
  }

  function revealAnswer() {
    emitLiveEvent({ type: "action", action: "reveal", ts: Date.now() });
    setRevealed(true);
    const fractionText = formatFractionDisplay(task.fraction);
    const decimalText = formatDecimalDisplay(task.decimal);
    const percentText = `${formatDecimalDisplay(task.percent)}%`;
    setFeedback({
      type: "info",
      message: `Facit: ${fractionText} = ${decimalText} = ${percentText}.`,
    });
    setStreak(0);
  }

  function emitLiveEvent(event: LiveEvent) {
    if (!roomId) return;
    sendLiveEvent(roomId, event);
  }
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
                Klar om et Ã¸jeblik
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

  const level = Math.floor(streak / 5) + 1;
  const progressInLevel = streak % 5;
  const progress = progressInLevel / 5;
  const toNext = progressInLevel === 0 ? 5 : 5 - progressInLevel;

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
              Omskrivning
            </p>
            <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
              Omskrivning
            </h1>
            <p className="max-w-xl text-base text-slate-600">
              Omskriv mellem decimaltal, procent og brÃ¸ker i samme opgave.
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
                    Omskriv tallet
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
                    {toNext} til nÃ¦ste level
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-6">
                <div className="flex flex-col items-center justify-center gap-3 text-2xl font-semibold text-slate-900">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                    Givet: {givenLabel}
                  </p>
                  <span className="rounded-2xl border border-transparent bg-[var(--brand-2)]/15 px-6 py-3 text-3xl text-slate-900 shadow-sm">
                    {givenDisplay}
                  </span>
                  <p className="text-sm text-slate-500">
                    Omskriv til de to andre former.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {task.givenType !== "fraction" && (
                    <label className="flex flex-col gap-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        BrÃ¸k
                      </span>
                      <input
                        value={answerFraction}
                        onChange={(e) =>
                          setAnswerFraction(
                            e.target.value.slice(0, MAX_ANSWER_LEN)
                          )
                        }
                        inputMode="text"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") checkAnswer();
                        }}
                        maxLength={MAX_ANSWER_LEN}
                        disabled={revealed}
                        className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-center text-lg font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]"
                        placeholder="fx 1/2"
                      />
                    </label>
                  )}
                  {task.givenType !== "decimal" && (
                    <label className="flex flex-col gap-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Decimaltal
                      </span>
                      <input
                        value={answerDecimal}
                        onChange={(e) =>
                          setAnswerDecimal(
                            e.target.value.slice(0, MAX_ANSWER_LEN)
                          )
                        }
                        inputMode="decimal"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") checkAnswer();
                        }}
                        maxLength={MAX_ANSWER_LEN}
                        disabled={revealed}
                        className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-center text-lg font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]"
                        placeholder="fx 0,5"
                      />
                    </label>
                  )}
                  {task.givenType !== "percent" && (
                    <label className="flex flex-col gap-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Procent
                      </span>
                      <input
                        value={answerPercent}
                        onChange={(e) =>
                          setAnswerPercent(
                            e.target.value.slice(0, MAX_ANSWER_LEN)
                          )
                        }
                        inputMode="decimal"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") checkAnswer();
                        }}
                        maxLength={MAX_ANSWER_LEN}
                        disabled={revealed}
                        className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-center text-lg font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]"
                        placeholder="fx 50%"
                      />
                    </label>
                  )}
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
                      SvÃ¦rhedsgrad
                    </label>
                    <select
                      className={selectClass}
                      value={settings.difficulty}
                      onChange={(e) =>
                        updateSetting(
                          "difficulty",
                          e.target.value as Difficulty
                        )
                      }
                    >
                      <option value="easy">Let</option>
                      <option value="medium">Mellem</option>
                      <option value="hard">SvÃ¦r</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-slate-600">
                  Indstillingerne er skjult. Tryk pÃ¥ tandhjulet for at Ã¥bne dem
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


