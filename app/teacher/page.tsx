"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveEvent } from "@/utils/liveTypes";
import { supabase } from "@/utils/supabaseClient";

type Status = "idle" | "connecting" | "open" | "error";
type RoomState = {
  id: string;
  status: Status;
  equation: string;
  operation: string;
  answer: string;
  track: string;
  attempts: number;
  correct: number;
  streak: number;
  lastAction: null | "check" | "reveal";
  lastActionAt: number | null;
  lastEventAt: number | null;
  lastNonCanvasAt: number | null;
  lastPresenceAt: number | null;
  presenceState: "open" | "hidden" | "closed" | null;
};

const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 140;
const PRESENCE_TIMEOUT_MS = 20000;

export default function TeacherPage() {
  const [sessionCodes, setSessionCodes] = useState<string[]>([]);
  const [sessionStarts, setSessionStarts] = useState<Record<string, number>>(
    {}
  );
  const [sessionError, setSessionError] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const [activeRoom, setActiveRoom] = useState("");
  const [rooms, setRooms] = useState<RoomState[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const activeRoomRef = useRef("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const previewRefCallbacks = useRef<
    Map<string, (node: HTMLCanvasElement | null) => void>
  >(new Map());
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());
  const lastCanvasTsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function resizeCanvas(target: HTMLCanvasElement) {
      const parent = target.parentElement;
      if (!parent) return;
      const width = Math.max(320, Math.floor(parent.clientWidth));
      const height = 220;
      target.width = width;
      target.height = height;
      clearCanvas();
    }

    const onResize = () => resizeCanvas(canvas);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    const nextIds = new Set(rooms.map((room) => room.id));
    for (const [roomId, source] of sourcesRef.current.entries()) {
      if (!nextIds.has(roomId)) {
        source.close();
        sourcesRef.current.delete(roomId);
      }
    }

    for (const room of rooms) {
      if (sourcesRef.current.has(room.id)) continue;
      const source = new EventSource(
        `/api/live?room=${encodeURIComponent(room.id)}`
      );
      sourcesRef.current.set(room.id, source);

      updateRoom(room.id, { status: "connecting" });

      source.onopen = () => updateRoom(room.id, { status: "open" });
      source.onerror = () => updateRoom(room.id, { status: "error" });
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as LiveEvent;
          updateRoom(room.id, { lastEventAt: Date.now() });
          if (payload.type === "input") {
            updateRoom(room.id, {
              answer: payload.value,
              lastNonCanvasAt: Date.now(),
            });
            return;
          }
          if (payload.type === "task") {
            updateRoom(room.id, {
              equation: payload.equation,
              operation: payload.operation,
              lastNonCanvasAt: Date.now(),
            });
            return;
          }
          if (payload.type === "action") {
            updateRoom(room.id, {
              lastAction: payload.action,
              lastActionAt: Date.now(),
              lastNonCanvasAt: Date.now(),
            });
            return;
          }
          if (payload.type === "presence") {
            const patch: Partial<RoomState> = {
              lastPresenceAt: Date.now(),
              presenceState: payload.state,
            };
            if (payload.track) patch.track = payload.track;
            updateRoom(room.id, patch);
            return;
          }
          if (payload.type === "result") {
            updateRoom(room.id, {
              attempts: payload.attempts,
              correct: payload.correct,
              streak: typeof payload.streak === "number" ? payload.streak : 0,
              lastNonCanvasAt: Date.now(),
            });
            return;
          }
          if (payload.type === "canvas-clear") {
            if (shouldApplyCanvasEvent(room.id, payload.ts)) {
              clearPreviewCanvas(room.id);
              if (room.id === activeRoomRef.current) clearCanvas();
              setLastCanvasTs(room.id, payload.ts);
            }
            return;
          }
          if (payload.type === "canvas-snapshot") {
            if (shouldApplyCanvasEvent(room.id, payload.ts)) {
              drawPreviewSnapshot(room.id, payload.dataUrl);
              if (room.id === activeRoomRef.current) drawSnapshot(payload.dataUrl);
              setLastCanvasTs(room.id, payload.ts);
            }
            return;
          }
          if (payload.type === "canvas-stroke") {
            if (shouldApplyCanvasEvent(room.id, payload.ts)) {
              if (room.id === activeRoomRef.current)
                drawStroke(payload.tool, payload.from, payload.to);
              setLastCanvasTs(room.id, payload.ts);
            }
          }
        } catch {
          return;
        }
      };
    }

  }, [rooms, activeRoom]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadActiveSessions = async () => {
      const nowIso = new Date().toISOString();
      const { data: sessions } = await supabase
        .from("sessions")
        .select("id,code,expires_at,created_at")
        .gt("expires_at", nowIso);
      if (cancelled || !sessions) return;
      setSessionCodes(sessions.map((session) => session.code));
      setSessionStarts((prev) => {
        const next: Record<string, number> = { ...prev };
        for (const session of sessions) {
          if (!session.code || !session.created_at) continue;
          const ts = new Date(session.created_at).getTime();
          if (Number.isFinite(ts)) next[session.code] = ts;
        }
        return next;
      });
    };
    loadActiveSessions();
    const interval = setInterval(loadActiveSessions, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (sessionCodes.length === 0) return;
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await syncParticipants();
    };
    run();
    const interval = setInterval(run, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionCodes]);

  useEffect(() => {
    if (!activeRoom && rooms.length > 0) {
      setActiveRoom(rooms[0].id);
    }
  }, [rooms, activeRoom]);

  useEffect(() => {
    if (sessionCodes.length === 0) {
      setRooms([]);
      setActiveRoom("");
      setSessionStarts({});
      return;
    }
    setRooms((prev) =>
      prev.filter((room) =>
        sessionCodes.some((code) => room.id.startsWith(`${code}:`))
      )
    );
    setSessionStarts((prev) => {
      const next: Record<string, number> = {};
      for (const code of sessionCodes) {
        const value = prev[code];
        if (typeof value === "number") next[code] = value;
      }
      return next;
    });
  }, [sessionCodes]);

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

  function clearPreviewCanvas(roomId: string) {
    const canvas = previewCanvasRef.current.get(roomId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function getPreviewRef(roomId: string) {
    const existing = previewRefCallbacks.current.get(roomId);
    if (existing) return existing;
    const callback = (node: HTMLCanvasElement | null) => {
      if (!node) {
        previewCanvasRef.current.delete(roomId);
        previewRefCallbacks.current.delete(roomId);
        return;
      }
      const current = previewCanvasRef.current.get(roomId);
      if (current === node) return;
      previewCanvasRef.current.set(roomId, node);
      node.width = PREVIEW_WIDTH;
      node.height = PREVIEW_HEIGHT;
      clearPreviewCanvas(roomId);
    };
    previewRefCallbacks.current.set(roomId, callback);
    return callback;
  }

  function applyStrokeStyle(
    ctx: CanvasRenderingContext2D,
    tool: "pen" | "eraser"
  ) {
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = tool === "eraser" ? 18 : 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
  }

  function drawStroke(
    tool: "pen" | "eraser",
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    applyStrokeStyle(ctx, tool);
    ctx.beginPath();
    ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
    ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
    ctx.stroke();
  }

  function drawPreviewStroke(
    roomId: string,
    tool: "pen" | "eraser",
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) {
    const canvas = previewCanvasRef.current.get(roomId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    applyStrokeStyle(ctx, tool);
    ctx.beginPath();
    ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
    ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
    ctx.stroke();
  }

  function drawSnapshot(dataUrl: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      clearCanvas();
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    img.src = dataUrl;
  }

  function drawPreviewSnapshot(roomId: string, dataUrl: string) {
    const canvas = previewCanvasRef.current.get(roomId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    img.src = dataUrl;
  }

  function updateRoom(roomId: string, patch: Partial<RoomState>) {
    setRooms((prev) =>
      prev.map((room) => (room.id === roomId ? { ...room, ...patch } : room))
    );
  }

  function shouldApplyCanvasEvent(roomId: string, ts: number) {
    const last = lastCanvasTsRef.current.get(roomId) ?? 0;
    return ts >= last;
  }

  function setLastCanvasTs(roomId: string, ts: number) {
    lastCanvasTsRef.current.set(roomId, ts);
  }

  function makeRoom(id: string): RoomState {
    return {
      id,
      status: "idle",
      equation: "",
      operation: "",
      answer: "",
      track: "",
      attempts: 0,
      correct: 0,
      streak: 0,
      lastAction: null,
      lastActionAt: null,
      lastEventAt: null,
      lastNonCanvasAt: null,
      lastPresenceAt: null,
      presenceState: null,
    };
  }

  function generateSessionCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }

  function addSessionCode(code: string, createdAt?: string | null) {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setSessionError("");
    setSessionCodes((prev) => {
      if (prev.includes(trimmed)) return prev;
      return [...prev, trimmed];
    });
    if (createdAt) {
      const ts = new Date(createdAt).getTime();
      if (Number.isFinite(ts)) {
        setSessionStarts((prev) => ({ ...prev, [trimmed]: ts }));
      }
    }
  }

  async function createSession() {
    setCreatingSession(true);
    setSessionError("");
    let code = "";
    let inserted = false;
    let createdAt: string | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      code = generateSessionCode();
      const expiresAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("sessions")
        .insert({
          code,
          expires_at: expiresAt,
        })
        .select("code,created_at")
        .single();
      if (!error && data) {
        createdAt = data.created_at ?? null;
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      setSessionError("Kunne ikke oprette session. Prøv igen.");
      setCreatingSession(false);
      return;
    }
    addSessionCode(code, createdAt);
    setCreatingSession(false);
  }

  async function syncParticipants() {
    if (sessionCodes.length === 0) return;
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id,code,expires_at,created_at")
      .in("code", sessionCodes);
    if (!sessions || sessions.length === 0) return;
    const nowMs = Date.now();
    const expired = sessions.filter((session) => {
      const expiresAt = new Date(session.expires_at).getTime();
      return Number.isFinite(expiresAt) && expiresAt < nowMs;
    });
    if (expired.length > 0) {
      try {
        await supabase.rpc("delete_expired_sessions");
      } catch {
        // Ignore RPC errors; cleanup continues with direct deletes below.
      }
      await supabase
        .from("sessions")
        .delete()
        .in(
          "id",
          expired.map((session) => session.id)
        );
      setSessionCodes((prev) =>
        prev.filter((code) => !expired.some((s) => s.code === code))
      );
    }
    setSessionStarts((prev) => {
      const next = { ...prev };
      for (const session of sessions) {
        if (!session.code || !session.created_at) continue;
        const ts = new Date(session.created_at).getTime();
        if (Number.isFinite(ts)) next[session.code] = ts;
      }
      return next;
    });
    const sessionMap = new Map(
      sessions.map((session) => [session.id, session.code])
    );
    const { data: participants } = await supabase
      .from("participants")
      .select("session_id,alias,last_seen")
      .in("session_id", sessions.map((session) => session.id));
    if (!participants) return;

    setRooms((prev) => {
      const map = new Map(prev.map((room) => [room.id, room]));
      const activeIds = new Set<string>();
      for (const participant of participants) {
        const codeForSession = sessionMap.get(participant.session_id);
        if (!codeForSession) continue;
        const id = `${codeForSession}:${participant.alias}`;
        const existing = map.get(id) ?? makeRoom(id);
        map.set(id, existing);
        activeIds.add(id);
      }
      return Array.from(map.values()).filter((room) => activeIds.has(room.id));
    });
  }

  async function removeParticipant(roomId: string) {
    const [sessionCode, alias] = roomId.split(":");
    if (!sessionCode || !alias) return;
    const ok = window.confirm(
      `Vil du fjerne ${alias} fra session ${sessionCode}?`
    );
    if (!ok) return;
    const { data: session } = await supabase
      .from("sessions")
      .select("id")
      .eq("code", sessionCode)
      .maybeSingle();
    if (!session) {
      setSessionError("Sessionkode findes ikke.");
      return;
    }
    const { error } = await supabase
      .from("participants")
      .delete()
      .eq("session_id", session.id)
      .eq("alias", alias);
    if (error) {
      setSessionError("Kunne ikke fjerne elev fra sessionen.");
      return;
    }
    fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: roomId,
        event: { type: "kick", ts: Date.now() },
      }),
      keepalive: true,
    }).catch(() => {});
  }

  async function removeSessionCode(code: string) {
    const ok = window.confirm(
      `Vil du lukke session ${code}? Eleverne bliver smidt ud.`
    );
    if (!ok) return;
    const trimmed = code.trim().toUpperCase();
    const { error } = await supabase
      .from("sessions")
      .delete()
      .eq("code", trimmed);
    if (error) {
      setSessionError("Kunne ikke lukke sessionen.");
      return;
    }
    setSessionCodes((prev) => prev.filter((value) => value !== trimmed));
    setSessionStarts((prev) => {
      const next = { ...prev };
      delete next[trimmed];
      return next;
    });
  }

  function formatElapsed(fromMs?: number) {
    if (!fromMs || !Number.isFinite(fromMs)) return "--:--";
    const totalSeconds = Math.max(
      0,
      Math.floor((fromMs + 90 * 60 * 1000 - now) / 1000)
    );
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatLastSeen(fromMs?: number) {
    if (!fromMs || !Number.isFinite(fromMs)) return "-";
    const totalSeconds = Math.max(0, Math.floor((now - fromMs) / 1000));
    if (totalSeconds < 60) return `${totalSeconds || 1}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  function getSessionLink(code: string) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/?session=${encodeURIComponent(code)}`;
  }

  async function copySessionLink(code: string) {
    const link = getSessionLink(code);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setSessionError("Link kopieret.");
      window.setTimeout(() => {
        setSessionError((prev) => (prev === "Link kopieret." ? "" : prev));
      }, 1200);
    } catch {
      setSessionError("Kunne ikke kopiere link.");
    }
  }

  function removeRoom(roomId: string) {
    setRooms((prev) => prev.filter((room) => room.id !== roomId));
    if (activeRoom === roomId) {
      const next = rooms.find((room) => room.id !== roomId);
      setActiveRoom(next?.id ?? "");
    }
    removeParticipant(roomId);
  }

  function syncMainFromPreview(roomId: string) {
    const preview = previewCanvasRef.current.get(roomId);
    const main = canvasRef.current;
    if (!preview || !main) return;
    const ctx = main.getContext("2d");
    if (!ctx) return;
    clearCanvas();
    ctx.drawImage(preview, 0, 0, main.width, main.height);
  }

  const activeRoomState = useMemo(
    () => rooms.find((room) => room.id === activeRoom),
    [rooms, activeRoom]
  );
  const activeAttempts = activeRoomState?.attempts ?? 0;
  const activeCorrect = activeRoomState?.correct ?? 0;
  const activeAccuracy =
    activeAttempts > 0
      ? Math.round((activeCorrect / activeAttempts) * 100)
      : 0;
  const activeStreak = activeRoomState?.streak ?? 0;

  const statusLabel =
    activeRoomState?.status === "open"
      ? "Live"
      : activeRoomState?.status === "connecting"
      ? "Forbinder"
      : activeRoomState?.status === "error"
      ? "Fejl"
      : "Afvent";
  const activeRoomAlias = activeRoom ? activeRoom.split(":")[1] ?? activeRoom : "";
  const activeRoomSession = activeRoom ? activeRoom.split(":")[0] ?? "" : "";

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
              Lærerpanel
            </p>
            <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
              Live view
            </h1>
            <p className="max-w-xl text-base text-slate-600">
              Se elevens input og whiteboard i realtid. Indtast elevkoden for at
              følge en session.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)]/80 px-4 py-3 shadow-[var(--shadow-1)]">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Status
            </div>
            <div className="text-lg font-semibold text-slate-800">
              {statusLabel}
            </div>
          </div>
        </header>

        <section className="grid gap-6">
          <div className="rise-in rise-in-delay-1">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)]/90 p-6 shadow-[var(--shadow-1)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                    Sessioner
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-900">Overblik</h2>
                </div>
                <div className="rounded-full bg-[var(--panel-strong)] px-3 py-1 text-xs font-semibold text-slate-700">
                  {activeRoom || "Ikke valgt"}
                </div>
              </div>

              <div className="mt-6">
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    onClick={createSession}
                    disabled={creatingSession}
                    className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:translate-y-[-1px] disabled:opacity-60"
                  >
                    {creatingSession ? "Opretter..." : "Opret session"}
                  </button>
                </div>
                {sessionError && (
                  <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {sessionError}
                  </div>
                )}
                {sessionCodes.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {sessionCodes.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        {code}
                        <span className="text-[11px] font-medium text-slate-500">
                          {formatElapsed(sessionStarts[code])}
                        </span>
                        <button
                          onClick={() => copySessionLink(code)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                        >
                          Kopier link
                        </button>
                        <button
                          onClick={() => removeSessionCode(code)}
                          className="text-slate-500 hover:text-slate-800"
                        >
                          Fjern
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-sm text-slate-600">
                  Tilføj flere sessioner for multiview.
                </p>
              </div>
            </div>
          </div>

          <div className="rise-in rise-in-delay-2 grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)]/90 p-6 shadow-[var(--shadow-1)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                    Elever
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-900">Mini-views</h2>
                </div>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rooms.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-slate-600">
                    Ingen elever endnu. Tilføj en elevkode ovenfor.
                  </div>
                )}
                {rooms.map((room) => {
                  const [roomSession, roomAlias] = room.id.split(":");
                  const isPresenceStale =
                    !room.lastPresenceAt ||
                    now - room.lastPresenceAt > PRESENCE_TIMEOUT_MS;
                  const presenceLabel =
                    room.presenceState === "closed" ||
                    room.presenceState === "hidden" ||
                    isPresenceStale
                      ? "CLOSED"
                      : "OPEN";
                  const lastSeenSource =
                    room.lastNonCanvasAt ?? room.lastEventAt ?? null;
                  const lastSeen = formatLastSeen(lastSeenSource ?? undefined);
                  const actionLabel =
                    room.lastAction === "check"
                      ? "Tjek svar"
                      : room.lastAction === "reveal"
                      ? "Vis facit"
                      : "Ingen handling";
                  const accuracy =
                    room.attempts > 0
                      ? Math.round((room.correct / room.attempts) * 100)
                      : 0;
                  return (
                    <button
                      key={room.id}
                      onClick={() => {
                        setActiveRoom(room.id);
                        syncMainFromPreview(room.id);
                      }}
                      className={`group rounded-2xl border p-4 text-left shadow-sm transition ${
                        room.id === activeRoom
                          ? "border-[var(--brand-2)] bg-white"
                          : "border-black/10 bg-white/80 hover:-translate-y-1"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {roomAlias || room.id}
                        </div>
                        <div className="text-xs text-slate-500">
                          {lastSeen}
                        </div>
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                        {roomSession || "-"}
                        {room.track ? ` · ${room.track}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {room.operation || "Ingen opgave endnu"}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">
                        {room.equation ? `${room.equation} =` : "—"}
                      </div>
                      <div className="mt-3 rounded-xl border border-black/10 bg-white/90 p-2 text-sm text-slate-700">
                        {room.answer || "Ingen input"}
                      </div>
                      <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-white/80">
                        <canvas
                          ref={getPreviewRef(room.id)}
                          className="block h-[120px] w-full"
                        />
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {actionLabel}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Opgaver: {room.attempts} · Rigtige: {room.correct} ({accuracy}
                        %)
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Streak: {room.streak}
                      </div>
                      <div className="mt-3 flex justify-between">
                        <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          {presenceLabel}
                        </span>
                        <span
                          onClick={(event) => {
                            event.stopPropagation();
                            removeRoom(room.id);
                          }}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                        >
                          Fjern
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)]/90 p-6 shadow-[var(--shadow-1)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                    Live view
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    {activeRoomAlias || "Vælg elev"}
                  </h2>
                  {activeRoomSession && (
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                      {activeRoomSession}
                    </div>
                  )}
                </div>
                <div className="rounded-full bg-[var(--panel-strong)] px-3 py-1 text-xs font-semibold text-slate-700">
                  {statusLabel}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 px-4 py-4 text-lg font-semibold text-slate-900 shadow-sm">
                {activeRoomState?.answer || "Ingen input endnu"}
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 px-4 py-4 shadow-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Aktiv opgave
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-600">
                  {activeRoomState?.operation || "Ikke modtaget endnu"}
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {activeRoomState?.equation
                    ? `${activeRoomState.equation} =`
                    : "—"}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 px-4 py-4 shadow-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Løste opgaver
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {activeAttempts} opgaver · {activeCorrect} rigtige ({activeAccuracy}
                  %)
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-600">
                  Streak: {activeStreak}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 px-4 py-4 shadow-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Elevens handling
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {activeRoomState?.lastActionAt && activeRoomState.lastAction
                    ? `${activeRoomState.lastAction === "check" ? "Tjek svar" : "Vis facit"} for ${Math.max(
                        1,
                        Math.floor((now - activeRoomState.lastActionAt) / 1000)
                      )}s siden`
                    : "Ingen handling endnu."}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Whiteboard
                </div>
                <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-white/80">
                  <canvas ref={canvasRef} className="block h-[220px] w-full" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
