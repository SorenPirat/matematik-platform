"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { LiveEvent } from "@/utils/liveTypes";
import { useLiveSession } from "@/hooks/useLiveSession";
import { sendLiveEvent } from "@/utils/liveRealtime";

type Difficulty = "easy" | "medium" | "hard";

type OrderCategory = "parens" | "power" | "multiply" | "addsub";

type TermCategory = "parens" | "power" | "multiply" | "number";

type Term = {
  id: string;
  display: string;
  value: number;
  category: TermCategory;
};

type Task = {
  expression: string;
  result: number;
  label: string;
  terms: Term[];
  ops: ("+" | "-")[];
};

type Settings = {
  difficulty: Difficulty;
};

const LS_STREAK = "regnehierarkiet_streak_v1";
const LS_BEST_STREAK = "regnehierarkiet_best_streak_v1";
const LS_SETTINGS = "regnehierarkiet_settings_v1";
const AUTO_NEXT_MS = 1600;


function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(items: T[]) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

function parseNumber(raw: string) {
  const normalized = normalizeNumberString(raw);
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value;
}

function makeParenTerm(min: number, max: number): Term {
  const a = randInt(min, max);
  const b = randInt(min, max);
  const useSub = Math.random() < 0.5;
  if (useSub) {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return {
      id: "",
      display: `( ${hi} - ${lo} )`,
      value: hi - lo,
      category: "parens",
    };
  }
  return {
    id: "",
    display: `( ${a} + ${b} )`,
    value: a + b,
    category: "parens",
  };
}

function makeMultiplyTerm(min: number, max: number): Term {
  const useDivision = Math.random() < 0.4;
  if (useDivision) {
    const b = randInt(min, max);
    const c = randInt(min, max);
    const a = b * c;
    return {
      id: "",
      display: `${a} ÷ ${b}`,
      value: c,
      category: "multiply",
    };
  }
  const a = randInt(min, max);
  const b = randInt(min, max);
  return {
    id: "",
    display: `${a} x ${b}`,
    value: a * b,
    category: "multiply",
  };
}


function makePowerTerm(min: number, max: number, allowRoot: boolean): Term {
  const useRoot = allowRoot && Math.random() < 0.4;
  if (useRoot) {
    const base = randInt(min, max);
    const value = base * base;
    return {
      id: "",
      display: `\u221a${value}`,
      value: base,
      category: "power",
    };
  }
  const base = randInt(min, max);
  const exponent = Math.random() < 0.6 ? 2 : 3;
  const superExp = exponent === 2 ? "\u00b2" : "\u00b3";
  return {
    id: "",
    display: `${base}${superExp}`,
    value: base ** exponent,
    category: "power",
  };
}


function makeNumberTerm(min: number, max: number): Term {
  const n = randInt(min, max);
  return {
    id: "",
    display: String(n),
    value: n,
    category: "number",
  };
}

function buildExpression(terms: Term[], label: string): Task {
  const ops = Array.from({ length: Math.max(terms.length - 1, 0) }, () =>
    Math.random() < 0.5 ? "+" : "-"
  );
  const withIds = terms.map((term, index) => ({
    ...term,
    id: `term-${index}`,
  }));
  const expression = withIds
    .map((term, index) =>
      index < ops.length ? `${term.display} ${ops[index]}` : term.display
    )
    .join(" ");
  let result = withIds[0]?.value ?? 0;
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    const next = withIds[i + 1].value;
    result = op === "+" ? result + next : result - next;
  }
  return { expression, result, label, terms: withIds, ops };
}

function buildEasy(): Task {
  const terms = shuffle([
    makeParenTerm(2, 9),
    makePowerTerm(2, 8, false),
    makeMultiplyTerm(2, 9),
  ]);
  return buildExpression(terms, "Let");
}


function buildMedium(): Task {
  const terms = shuffle([
    makeParenTerm(2, 12),
    makePowerTerm(2, 10, false),
    makeMultiplyTerm(2, 12),
    makeNumberTerm(2, 15),
  ]);
  return buildExpression(terms, "Mellem");
}


function buildHard(): Task {
  const terms = shuffle([
    makeParenTerm(3, 18),
    makePowerTerm(2, 12, true),
    makeMultiplyTerm(3, 15),
    makeNumberTerm(3, 20),
    makeNumberTerm(3, 20),
  ]);
  return buildExpression(terms, "Sv?r");
}


function buildTask(settings: Settings): Task {
  if (settings.difficulty === "easy") return buildEasy();
  if (settings.difficulty === "medium") return buildMedium();
  return buildHard();
}

export default function RegnehierarkietPage() {
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
    storageKey: "regnehierarkiet",
    trackLabel: "Regnehierarkiet",
    onInvalidSession: () => router.replace("/"),
  });
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [task, setTask] = useState<Task>(() => buildTask(defaultSettings));
  const [settingsReady, setSettingsReady] = useState(false);
  const [orderSteps, setOrderSteps] = useState<OrderCategory[]>([]);
  const [answer, setAnswer] = useState("");
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
    const value = [orderSteps.join(","), answer].filter(Boolean).join(" | ");
    inputDebounceRef.current = setTimeout(() => {
      emitLiveEvent({ type: "input", value, ts: Date.now() });
    }, 140);
    return () => {
      if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current);
    };
  }, [orderSteps, answer, roomId]);

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

  useEffect(() => {
    localStorage.setItem(LS_STREAK, String(streak));
  }, [streak]);

  useEffect(() => {
    localStorage.setItem(LS_BEST_STREAK, String(bestStreak));
  }, [bestStreak]);

  const equationText = useMemo(() => `${task.expression} = ?`, [task.expression]);

  const operationLabel = useMemo(
    () => `Regnehierarkiet (${task.label})`,
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
    setOrderSteps([]);
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
    setOrderSteps([]);
    setAnswer("");
    setFeedback({ type: "idle", message: "" });
    setRevealed(false);
  }

  function handleOrderClick(category: OrderCategory) {
    if (orderSteps.includes(category)) {
      setOrderSteps(orderSteps.filter((item) => item != category));
      return;
    }
    if (orderSteps.length >= 4) return;
    setOrderSteps([...orderSteps, category]);
  }

  function getOrderNumber(category: OrderCategory) {
    const index = orderSteps.indexOf(category);
    return index >= 0 ? index + 1 : null;
  }

  function isOrderCorrect() {
    return orderSteps.join(",") === "parens,power,multiply,addsub";
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

    if (orderSteps.length < 4) {
      setFeedback({
        type: "error",
        message: "Klik på rækkefølgen (1-4), før du tjekker.",
      });
      return;
    }

    if (!isOrderCorrect()) {
      setFeedback({ type: "wrong", message: "Rækkefølgen er ikke korrekt." });
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

    const value = parseNumber(answer);
    if (value === null) {
      setFeedback({
        type: "error",
        message: "Skriv et gyldigt svar.",
      });
      return;
    }

    if (value !== task.result) {
      setFeedback({ type: "wrong", message: "Ikke helt. Prøv igen." });
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
    setFeedback({
      type: "info",
      message: `Rækkefølge: ()=1, potenser/\u221a=2, x/\u00f7=3, + og -=4. Facit: ${task.result}.`,
    });
    setStreak(0);
  }

  function emitLiveEvent(event: LiveEvent) {
    if (!roomId) return;
    sendLiveEvent(roomId, event);
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

  const selectClass =
    "mt-2 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]";

  const renderOrderBadge = (category: OrderCategory) => {
    const orderNumber = getOrderNumber(category);
    if (orderNumber == null) return null;
    return (
      <span className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-2)] text-xs font-semibold text-white">
        {orderNumber}
      </span>
    );
  };

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
              Regnehierarkiet
            </p>
            <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
              Regnehierarkiet
            </h1>
            <p className="max-w-xl text-base text-slate-600">
              Find rækkefølgen og regn regnestykket korrekt.
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
                    Regn regnestykket
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
                <div className="flex flex-wrap items-center justify-center gap-2 text-2xl font-semibold text-slate-900">
                  {task.terms.map((term, index) => (
                    <span key={term.id} className="flex items-center gap-2">
                      {term.category === "number" ? (
                        <span className="rounded-2xl border border-black/10 bg-white/80 px-4 py-2 shadow-sm">
                          {term.display}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            handleOrderClick(
                              term.category === "parens" ? "parens" : term.category === "power" ? "power" : "multiply"
                            )
                          }
                          className="relative rounded-2xl border border-black/10 bg-white/90 px-4 py-2 shadow-sm transition hover:translate-y-[-1px]"
                        >
                          {term.display}
                          {renderOrderBadge(
                            term.category === "parens" ? "parens" : term.category === "power" ? "power" : "multiply"
                          )}
                        </button>
                      )}
                      {index < task.ops.length && (
                        <button
                          type="button"
                          onClick={() =>
                            handleOrderClick("addsub")
                          }
                          className="relative rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-xl text-slate-700 shadow-sm transition hover:translate-y-[-1px]"
                        >
                          {task.ops[index]}
                          {renderOrderBadge("addsub")}
                        </button>
                      )}
                    </span>
                  ))}
                  <span className="text-3xl text-slate-600">=</span>
                  <span className="text-2xl text-slate-500">?</span>
                </div>

                <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-center text-sm text-slate-600">
                  Klik på den rigtige fækkefølge og skriv resultatet.
                </div>

                <div className="flex flex-col items-center gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Facit
                  </label>
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    inputMode="decimal"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") checkAnswer();
                    }}
                    disabled={revealed}
                    className="w-48 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-center text-lg font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]"
                    placeholder="Skriv resultatet"
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
                  Tip: Start med parenteser, så gange/division, så plus og minus.
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
                <div className="mt-6 grid gap-5">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Sværhedsgrad
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
                      <option value="hard">Svær</option>
                    </select>
                  </div>
                </div>
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