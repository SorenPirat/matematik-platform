"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import VerticalLayout from "@/components/VerticalLayout";
import Whiteboard from "@/components/Whiteboard";
import type { LiveEvent } from "@/utils/liveTypes";
import { sendLiveEvent } from "@/utils/liveRealtime";

type Operation = "addition" | "subtraction" | "multiplication" | "division";

type Task = {
  operation: Operation;
  layout?: "horizontal" | "vertical";
  divisionLevel?: 1 | 2 | 3 | 4;
  problem: {
    operands: number[];
    operator: string;
  };
};

type FeedbackTone = "idle" | "ok" | "warn" | "info";

const LS_STREAK = "practice_streak_v1";
const LS_BEST_STREAK = "practice_best_streak_v1";
const LS_LEVEL = "practice_level_v1";
const AUTO_NEXT_MS = 1600;
const MAX_ANSWER_LEN = 20;

// ---------- Helpers ----------
function parseDa(input: string): number {
  if (typeof input !== "string") return NaN;
  return Number(input.trim().replace(/\s+/g, "").replace(",", "."));
}

function decimalsCount(n: number): number {
  const s = String(n);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

function roundTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function truncTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.trunc(n * factor) / factor;
}

function fmtDa(n: number, decimals?: number): string {
  const d = typeof decimals === "number" ? decimals : decimalsCount(n);
  return n.toFixed(d).replace(".", ",");
}

function computeExpected(operation: Operation, operands: number[]) {
  switch (operation) {
    case "addition":
      return operands.reduce((a, b) => a + b, 0);
    case "subtraction":
      return operands.slice(1).reduce((a, b) => a - b, operands[0]);
    case "multiplication":
      return operands.reduce((a, b) => a * b, 1);
    case "division":
      return operands.slice(1).reduce((a, b) => a / b, operands[0]);
  }
}

export default function TaskRenderer({
  task,
  onRequestNewTask,
  roomId,
}: {
  task: Task;
  onRequestNewTask?: () => void;
  roomId?: string;
}) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>("idle");
  const [revealed, setRevealed] = useState(false);
  const [nudge, setNudge] = useState<{
    message: string;
    tone: FeedbackTone;
  } | null>(null);
  const [showCanvas, setShowCanvas] = useState(false);
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
  const nudgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsRef = useRef({ attempts: 0, correct: 0 });

  useEffect(() => {
    setAnswer("");
    setFeedback("");
    setFeedbackTone("idle");
    setRevealed(false);
    setNudge(null);
    if (nudgeTimeoutRef.current) {
      clearTimeout(nudgeTimeoutRef.current);
      nudgeTimeoutRef.current = null;
    }
  }, [task]);

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
    localStorage.setItem(LS_STREAK, String(streak));
    localStorage.setItem(LS_LEVEL, String(Math.floor(streak / 5) + 1));
  }, [streak]);

  useEffect(() => {
    localStorage.setItem(LS_BEST_STREAK, String(bestStreak));
  }, [bestStreak]);

  const expectedRaw = computeExpected(task.operation, task.problem.operands);
  const precision = useMemo(() => {
    const base = Math.max(...task.problem.operands.map(decimalsCount), 0);
    if (task.operation !== "division") return base;
    const level = task.divisionLevel ?? 1;
    if (level <= 2) return 0;
    return 2;
  }, [task.problem.operands, task.operation, task.divisionLevel]);
  const expected =
    task.operation === "division"
      ? truncTo(expectedRaw, precision)
      : roundTo(expectedRaw, precision);

  const equationText = useMemo(() => {
    const parts = task.problem.operands.map((n) => fmtDa(n));
    return parts.join(` ${task.problem.operator} `);
  }, [task.problem.operands, task.problem.operator]);

  const level = Math.floor(streak / 5) + 1;
  const progressInLevel = streak % 5;
  const progress = progressInLevel / 5;
  const toNext = progressInLevel === 0 ? 5 : 5 - progressInLevel;

  const operationLabel: Record<Operation, string> = {
    addition: "Plus",
    subtraction: "Minus",
    multiplication: "Gange",
    division: "Division",
  };

  const operationBadge: Record<Operation, string> = {
    addition: "bg-[var(--brand-3)]/15 text-emerald-800",
    subtraction: "bg-[var(--brand-1)]/20 text-orange-800",
    multiplication: "bg-[var(--brand-2)]/20 text-blue-800",
    division: "bg-amber-100 text-amber-800",
  };

  useEffect(() => {
    if (!roomId) return;
    emitLiveEvent({
      type: "task",
      equation: equationText,
      operation: operationLabel[task.operation],
      ts: Date.now(),
    });
  }, [equationText, roomId, task.operation]);

  const feedbackStyles: Record<FeedbackTone, string> = {
    idle: "text-slate-600",
    ok: "text-emerald-700",
    warn: "text-orange-700",
    info: "text-blue-700",
  };

  function showNudge(message: string, tone: FeedbackTone, durationMs: number) {
    setNudge({ message, tone });
    if (nudgeTimeoutRef.current) clearTimeout(nudgeTimeoutRef.current);
    nudgeTimeoutRef.current = setTimeout(() => {
      setNudge(null);
    }, durationMs);
  }

  function emitLiveEvent(event: LiveEvent) {
    if (!roomId) return;
    sendLiveEvent(roomId, event);
  }

  // -------------------------------------------------------
  //                     CHECK ANSWER
  // -------------------------------------------------------
  function check() {
    emitLiveEvent({ type: "action", action: "check", ts: Date.now() });
    statsRef.current.attempts += 1;
    if (revealed) {
      setFeedbackTone("info");
      setFeedback("Facit er vist. Lav en ny opgave for at fortsætte.");
      emitLiveEvent({
        type: "result",
        attempts: statsRef.current.attempts,
        correct: statsRef.current.correct,
        streak,
        ts: Date.now(),
      });
      return;
    }

    const studentRaw = parseDa(answer);
    if (!Number.isFinite(studentRaw)) {
      setFeedbackTone("warn");
      setFeedback("Skriv et tal (brug komma ved kommatal).");
      return;
    }

    const student =
      task.operation === "division"
        ? truncTo(studentRaw, precision)
        : roundTo(studentRaw, precision);

    let ok = student === expected;
    if (task.operation === "division") {
      const expectedTrunc = truncTo(expectedRaw, precision);
      const expectedRound = roundTo(expectedRaw, precision);
      const studentTrunc = truncTo(studentRaw, precision);
      const studentRound = roundTo(studentRaw, precision);
      ok =
        studentTrunc === expectedTrunc ||
        studentRound === expectedRound ||
        studentTrunc === expectedRound ||
        studentRound === expectedTrunc;
    }

    if (ok) {
      setFeedbackTone("ok");
      setFeedback("Rigtigt! Godt klaret.");

      const newStreak = streak + 1;
      setStreak(newStreak);

      statsRef.current.correct += 1;
      emitLiveEvent({
        type: "result",
        attempts: statsRef.current.attempts,
        correct: statsRef.current.correct,
        streak: newStreak,
        ts: Date.now(),
      });

      if (newStreak > bestStreak) {
        setBestStreak(newStreak);
      }

      setRevealed(true);
      showNudge("Klar! Ny opgave om et øjeblik.", "ok", AUTO_NEXT_MS);

      if (onRequestNewTask) {
        setTimeout(() => {
          onRequestNewTask();
        }, AUTO_NEXT_MS);
      }

      return;
    }

    setFeedbackTone("warn");
    setFeedback("Ikke helt. Prøv igen.");
    showNudge("Tæt på - Prøv igen!", "warn", 1200);
    setStreak(0);
    emitLiveEvent({
      type: "result",
      attempts: statsRef.current.attempts,
      correct: statsRef.current.correct,
      streak: 0,
      ts: Date.now(),
    });
  }

  // -------------------------------------------------------
  //                     REVEAL ANSWER
  // -------------------------------------------------------
  function reveal() {
    emitLiveEvent({ type: "action", action: "reveal", ts: Date.now() });
    setRevealed(true);
    setFeedbackTone("info");
    setFeedback(
      `Facit: ${fmtDa(expected, precision)}. Start en ny opgave for at fortsætte.`
    );
    showNudge("Facit vist - klar til ny opgave.", "info", 1400);
    setStreak(0);
  }

  // -------------------------------------------------------
  //                     RENDER
  // -------------------------------------------------------
  return (
    <div className="relative overflow-hidden rounded-3xl border border-black/10 bg-[var(--panel)]/90 p-6 shadow-[var(--shadow-1)] backdrop-blur">
      <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[var(--brand-2)]/10 blur-2xl" />

      <div className="relative flex flex-col gap-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${operationBadge[task.operation]}`}
              >
                {operationLabel[task.operation]}
              </span>
              {task.operation !== "division" && (
                <span className="text-sm text-slate-600">
                  {precision} decimaler
                </span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 bg-white/80 px-4 py-3 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Niveau {level}
            </div>
            <div className="text-lg font-semibold text-slate-900">
              {streak} streak
            </div>
            <div className="mt-2 h-2 w-44 overflow-hidden rounded-full bg-black/10">
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

        <div className="rounded-2xl border border-black/10 bg-white/90 p-6 shadow-sm">
          <div className="mt-4">
            {(task.layout ?? "horizontal") === "vertical" ? (
              <VerticalLayout
                operands={task.problem.operands}
                operator={task.problem.operator}
              />
            ) : (
              <div className="text-3xl font-semibold text-slate-900">
                {equationText} =
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Svar
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-lg shadow-sm outline-none transition focus:ring-2 focus:ring-[var(--brand-2)] disabled:opacity-60"
            placeholder="Skriv fx 53"
            value={answer}
            disabled={revealed}
            maxLength={MAX_ANSWER_LEN}
            onChange={(e) => setAnswer(e.target.value.slice(0, MAX_ANSWER_LEN))}
            onKeyDown={(e) => {
              if (e.key === "Enter") check();
              if (e.key.toLowerCase() === "n" && onRequestNewTask) {
                e.preventDefault();
                onRequestNewTask();
              }
            }}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={check}
            className="flex-1 rounded-full bg-[var(--brand-2)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200/50 transition hover:translate-y-[-1px] hover:bg-blue-600 disabled:opacity-50"
            disabled={revealed}
          >
            Tjek svar
          </button>
          <button
            onClick={reveal}
            className="flex-1 rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:translate-y-[-1px] disabled:opacity-50"
            disabled={revealed}
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

        <Whiteboard
          visible={showCanvas}
          roomId={roomId}
          resetKey={task}
          enableWheelZoom
          enablePinchZoom
          showZoomButtons={false}
          blockPageScroll
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`text-sm ${feedbackStyles[feedbackTone]}`}>
            {feedback || "Tip: Tryk Enter for at tjekke, og N for ny opgave."}
          </p>
          {nudge ? (
            <span className={`text-xs font-semibold ${feedbackStyles[nudge.tone]}`}>
              {nudge.message}
            </span>
          ) : (
            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Ny opgave efter korrekt svar
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

