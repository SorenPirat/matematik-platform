"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { LiveEvent } from "@/utils/liveTypes";
import { useLiveSession } from "@/hooks/useLiveSession";
import { sendLiveEvent } from "@/utils/liveRealtime";

type Operation =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "mulInt"
  | "divInt";

type Range = "small" | "medium" | "large";

type Fraction = { n: number; d: number };
type Task = {
  operation: Operation;
  a: Fraction;
  b: Fraction | number;
};

type Settings = {
  operation: Operation;
  range: Range;
};

const LS_STREAK = "broeker_streak_v1";
const LS_BEST_STREAK = "broeker_best_streak_v1";
const LS_SETTINGS = "broeker_settings_v1";
const AUTO_NEXT_MS = 1600;
const operationLabels: Record<Operation, string> = {
  add: "Plus",
  subtract: "Minus",
  multiply: "Gange",
  divide: "Divider",
  mulInt: "Gange med helt tal",
  divInt: "Divider med helt tal",
};

const operationSymbols: Record<Operation, string> = {
  add: "+",
  subtract: "-",
  multiply: "x",
  divide: "/",
  mulInt: "x",
  divInt: "/",
};

const ranges: Record<Range, { maxNum: number; maxDen: number; maxInt: number }> =
  {
    small: { maxNum: 5, maxDen: 5, maxInt: 5 },
    medium: { maxNum: 15, maxDen: 15, maxInt: 15 },
    large: { maxNum: 35, maxDen: 35, maxInt: 35 },
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

function compareFractions(a: Fraction, b: Fraction) {
  return a.n * b.d - b.n * a.d;
}

function addFractions(a: Fraction, b: Fraction): Fraction {
  return simplifyFraction({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
}

function subtractFractions(a: Fraction, b: Fraction): Fraction {
  return simplifyFraction({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
}

function multiplyFractions(a: Fraction, b: Fraction): Fraction {
  return simplifyFraction({ n: a.n * b.n, d: a.d * b.d });
}

function divideFractions(a: Fraction, b: Fraction): Fraction {
  return simplifyFraction({ n: a.n * b.d, d: a.d * b.n });
}

function randomFraction(range: Range): Fraction {
  const { maxNum, maxDen } = ranges[range];
  const d = randInt(2, maxDen);
  const n = randInt(1, maxNum);
  return simplifyFraction({ n, d });
}

function randomProperFraction(range: Range): Fraction {
  const { maxDen } = ranges[range];
  const d = randInt(2, maxDen);
  const n = randInt(1, d - 1);
  return simplifyFraction({ n, d });
}

function buildTask(settings: Settings): Task {
  if (settings.operation === "mulInt") {
    const a = randomFraction(settings.range);
    const intB = randInt(2, ranges[settings.range].maxInt);
    return { operation: settings.operation, a, b: intB };
  }
  if (settings.operation === "divInt") {
    const a = randomFraction(settings.range);
    const intB = randInt(2, ranges[settings.range].maxInt);
    return { operation: settings.operation, a, b: intB };
  }
  const a = randomProperFraction(settings.range);
  const b = randomProperFraction(settings.range);
  if (settings.operation === "subtract" && compareFractions(a, b) < 0) {
    return { operation: settings.operation, a: b, b: a };
  }
  if (settings.operation === "divide") {
    return { operation: settings.operation, a, b: b.n === 0 ? { ...b, n: 1 } : b };
  }
  return { operation: settings.operation, a, b };
}

function solveTask(task: Task): Fraction {
  const a = task.a;
  const b = task.b;
  switch (task.operation) {
    case "add":
      return addFractions(a, b as Fraction);
    case "subtract":
      return subtractFractions(a, b as Fraction);
    case "multiply":
      return multiplyFractions(a, b as Fraction);
    case "divide":
      return divideFractions(a, b as Fraction);
    case "mulInt":
      return simplifyFraction({ n: a.n * (b as number), d: a.d });
    case "divInt":
      return simplifyFraction({ n: a.n, d: a.d * (b as number) });
    default:
      return simplifyFraction(a);
  }
}

function FractionView({ value }: { value: Fraction }) {
  return (
    <span className="inline-flex flex-col items-center leading-none">
      <span className="text-lg font-semibold text-slate-900">{value.n}</span>
      <span className="my-1 h-px w-8 bg-slate-900/70" />
      <span className="text-lg font-semibold text-slate-900">{value.d}</span>
    </span>
  );
}

function formatFractionText(value: Fraction) {
  return `${value.n}/${value.d}`;
}

export default function BroekerPage() {
  const defaultSettings: Settings = {
    operation: "add",
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
    storageKey: "broeker",
    trackLabel: "Brøker",
    onInvalidSession: () => router.replace("/"),
  });
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [task, setTask] = useState<Task>(() => buildTask(defaultSettings));
  const [settingsReady, setSettingsReady] = useState(false);
  const [answerNum, setAnswerNum] = useState("");
  const [answerDen, setAnswerDen] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "idle" | "correct" | "wrong" | "error" | "info";
    message: string;
  }>({ type: "idle", message: "" });
  const [revealed, setRevealed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [tool, setTool] = useState<"pen" | "eraser" | "line">("pen");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lineStartRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const autoNextRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveLastSentPointRef = useRef<{ x: number; y: number } | null>(null);
  const liveLastSentAtRef = useRef(0);
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
    localStorage.setItem(LS_STREAK, String(streak));
  }, [streak]);

  useEffect(() => {
    localStorage.setItem(LS_BEST_STREAK, String(bestStreak));
  }, [bestStreak]);

  

  

  

  

  

  

  

  

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
    function resizeCanvas() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = Math.max(320, Math.floor(parent.clientWidth));
      const height = 220;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = width;
      canvas.height = height;
      clearCanvas();
      undoStackRef.current = [];
    }

    if (showCanvas) {
      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);
      return () => window.removeEventListener("resize", resizeCanvas);
    }
  }, [showCanvas]);

  useEffect(() => {
    if (!showCanvas) return;
    clearCanvas();
    undoStackRef.current = [];
    if (roomId) emitCanvasClear();
  }, [task, showCanvas, roomId]);

  useEffect(() => {
    if (!roomId) return;
    if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current);
    const value =
      answerNum || answerDen ? `${answerNum}/${answerDen}` : "";
    inputDebounceRef.current = setTimeout(() => {
      emitLiveEvent({ type: "input", value, ts: Date.now() });
    }, 140);
    return () => {
      if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current);
    };
  }, [answerNum, answerDen, roomId]);

  useEffect(() => {
    if (!roomId || !showCanvas) return;
    const timer = setInterval(() => {
      emitCanvasSnapshot();
    }, 2000);
    return () => clearInterval(timer);
  }, [roomId, showCanvas]);

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

  const correct = useMemo(() => solveTask(task), [task]);
  const equationText = useMemo(() => {
    const aText = formatFractionText(task.a);
    const bText =
      typeof task.b === "number" ? String(task.b) : formatFractionText(task.b);
    return `${aText} ${operationSymbols[task.operation]} ${bText}`;
  }, [task]);

  useEffect(() => {
    if (!roomId) return;
    emitLiveEvent({
      type: "task",
      equation: equationText,
      operation: operationLabels[task.operation],
      ts: Date.now(),
    });
  }, [roomId, equationText, task.operation]);

  function updateSetting<K extends keyof Settings>(
    key: K,
    value: Settings[K]
  ) {
    if (autoNextRef.current) {
      clearTimeout(autoNextRef.current);
      autoNextRef.current = null;
    }
    const next = { ...settings, [key]: value };
    setSettings(next);
    setTask(buildTask(next));
    setAnswerNum("");
    setAnswerDen("");
    setFeedback({ type: "idle", message: "" });
    setRevealed(false);
  }

  function newTask() {
    if (autoNextRef.current) {
      clearTimeout(autoNextRef.current);
      autoNextRef.current = null;
    }
    setTask(buildTask(settings));
    setAnswerNum("");
    setAnswerDen("");
    setFeedback({ type: "idle", message: "" });
    setRevealed(false);
  }


  function parseAnswer(): Fraction | null {
    const n = Number.parseInt(answerNum.trim(), 10);
    if (!Number.isFinite(n)) return null;
    const denRaw = answerDen.trim();
    const d = denRaw === "" ? 1 : Number.parseInt(denRaw, 10);
    if (!Number.isFinite(d) || d === 0) return null;
    return simplifyFraction({ n, d });
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
        message: "Skriv et gyldigt svar. Nævner må ikke være 0.",
      });
      return;
    }
    const simplified = simplifyFraction(parsed);
    if (simplified.n === correct.n && simplified.d === correct.d) {
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
      message: `Facit: ${formatFractionText(correct)}.`,
    });
    setStreak(0);
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

  function getCanvasPoint(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number
  ) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function normalizePoint(
    canvas: HTMLCanvasElement,
    point: { x: number; y: number }
  ) {
    return { x: point.x / canvas.width, y: point.y / canvas.height };
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function pushUndoSnapshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const stack = undoStackRef.current;
    stack.push(snapshot);
    if (stack.length > 20) stack.shift();
  }

  function undo() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stack = undoStackRef.current;
    const snapshot = stack.pop();
    if (!snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
    emitCanvasSnapshot();
  }

  function applyStrokeStyle(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = tool === "eraser" ? 18 : 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
  }

  function emitLiveEvent(event: LiveEvent) {
    if (!roomId) return;
    sendLiveEvent(roomId, event);
  }

  function emitCanvasStroke(
    toolMode: "pen" | "eraser",
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    emitLiveEvent({
      type: "canvas-stroke",
      tool: toolMode,
      from: normalizePoint(canvas, from),
      to: normalizePoint(canvas, to),
      ts: Date.now(),
    });
  }

  function emitCanvasSnapshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    emitLiveEvent({
      type: "canvas-snapshot",
      dataUrl: canvas.toDataURL("image/png"),
      ts: Date.now(),
    });
  }

  function emitCanvasClear() {
    emitLiveEvent({ type: "canvas-clear", ts: Date.now() });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    const point = getCanvasPoint(canvas, event.clientX, event.clientY);
    pushUndoSnapshot();
    liveLastSentPointRef.current = point;
    liveLastSentAtRef.current = performance.now();
    if (tool === "line") {
      lineStartRef.current = point;
      drawingRef.current = false;
      return;
    }
    drawingRef.current = true;
    lastPointRef.current = point;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !drawingRef.current || tool === "line") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    applyStrokeStyle(ctx);
    const next = getCanvasPoint(canvas, event.clientX, event.clientY);
    const last = lastPointRef.current;
    if (!last) {
      lastPointRef.current = next;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastPointRef.current = next;

    const now = performance.now();
    const lastSent = liveLastSentPointRef.current;
    if (lastSent && now - liveLastSentAtRef.current >= 30) {
      emitCanvasStroke(tool === "eraser" ? "eraser" : "pen", lastSent, next);
      liveLastSentPointRef.current = next;
      liveLastSentAtRef.current = now;
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (tool === "line" && lineStartRef.current) {
      const end = getCanvasPoint(canvas, event.clientX, event.clientY);
      const start = lineStartRef.current;
      applyStrokeStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      emitCanvasStroke("pen", start, end);
    }

    if (tool !== "line" && liveLastSentPointRef.current) {
      const end = getCanvasPoint(canvas, event.clientX, event.clientY);
      emitCanvasStroke(
        tool === "eraser" ? "eraser" : "pen",
        liveLastSentPointRef.current,
        end
      );
    }

    drawingRef.current = false;
    lastPointRef.current = null;
    lineStartRef.current = null;
    liveLastSentPointRef.current = null;
    canvas.releasePointerCapture(event.pointerId);
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
              Brøker
            </p>
            <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
              Brøkværksted
            </h1>
            <p className="max-w-xl text-base text-slate-600">
              Træn brøkregning med plus, minus, gange og division. Skift mellem
              brøker og hele tal, og byg sikkerhed trin for trin.
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
                    Regn brøken
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
                <div className="flex flex-wrap items-center justify-center gap-6 text-2xl font-semibold text-slate-900">
                  <FractionView value={task.a} />
                  <span className="text-3xl text-slate-600">
                    {operationSymbols[task.operation]}
                  </span>
                  {typeof task.b === "number" ? (
                    <span className="text-3xl text-slate-900">{task.b}</span>
                  ) : (
                    <FractionView value={task.b} />
                  )}
                  <span className="text-3xl text-slate-600">=</span>
                  <span className="text-2xl text-slate-500">?</span>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col items-center gap-2">
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Svar
                    </label>
                    <div className="flex flex-col items-center">
                      <input
                        value={answerNum}
                        onChange={(e) => setAnswerNum(e.target.value)}
                        inputMode="numeric"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") checkAnswer();
                        }}
                        disabled={revealed}
                        className="w-20 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-center text-lg font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]"
                        placeholder="tæller"
                      />
                      <span className="my-1 h-px w-16 bg-slate-900/70" />
                      <input
                        value={answerDen}
                        onChange={(e) => setAnswerDen(e.target.value)}
                        inputMode="numeric"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") checkAnswer();
                        }}
                        disabled={revealed}
                        className="w-20 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-center text-lg font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]"
                        placeholder="nævner"
                      />
                    </div>
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

            {showCanvas && (
              <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--panel)]/90 p-6 shadow-[var(--shadow-1)] backdrop-blur">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Mellemregninger
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setTool("pen")}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      tool === "pen"
                        ? "border-transparent bg-[var(--brand-2)] text-white"
                        : "border-black/10 bg-white text-slate-700"
                    }`}
                  >
                    Pen
                  </button>
                  <button
                    onClick={() => setTool("eraser")}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      tool === "eraser"
                        ? "border-transparent bg-[var(--brand-2)] text-white"
                        : "border-black/10 bg-white text-slate-700"
                    }`}
                  >
                    Viskelæder
                  </button>
                  <button
                    onClick={() => setTool("line")}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      tool === "line"
                        ? "border-transparent bg-[var(--brand-2)] text-white"
                        : "border-black/10 bg-white text-slate-700"
                    }`}
                  >
                    Streg
                  </button>
                  <button
                    onClick={undo}
                    className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition"
                  >
                    Fortryd
                  </button>
                    <button
                      onClick={() => {
                        pushUndoSnapshot();
                        clearCanvas();
                        emitCanvasClear();
                      }}
                    className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition"
                  >
                    Ryd fladen
                  </button>
                </div>
                <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-white/80">
                  <canvas
                    ref={canvasRef}
                    className="block h-[220px] w-full touch-none"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                  />
                </div>
              </div>
            )}
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
                <>
                  <div className="mt-6 grid gap-5">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Regneart
                      </label>
                      <select
                        className={selectClass}
                        value={settings.operation}
                        onChange={(e) =>
                          updateSetting(
                            "operation",
                            e.target.value as Operation
                          )
                        }
                      >
                        <option value="add">Plus</option>
                        <option value="subtract">Minus</option>
                        <option value="multiply">Gange</option>
                        <option value="divide">Divider</option>
                        <option value="mulInt">Gange med helt tal</option>
                        <option value="divInt">Divider med helt tal</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Størrelse
                      </label>
                      <select
                        className={selectClass}
                        value={settings.range}
                        onChange={(e) =>
                          updateSetting("range", e.target.value as Range)
                        }
                      >
                        <option value="small">Små tal (1-5)</option>
                        <option value="medium">Mellem tal (1-15)</option>
                        <option value="large">Store tal (1-35)</option>
                      </select>
                    </div>
                  </div>

                </>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-slate-600">
                  Indstillingerne er skjult. Tryk "Vis" for at åbne dem igen.
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

