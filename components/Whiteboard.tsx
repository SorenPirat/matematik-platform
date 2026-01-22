"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import type { LiveEvent } from "@/utils/liveTypes";
import { sendLiveEvent } from "@/utils/liveRealtime";

type WhiteboardProps = {
  visible: boolean;
  roomId?: string;
  resetKey?: unknown;
  height?: number;
  enableWheelZoom?: boolean;
  enablePinchZoom?: boolean;
  showZoomButtons?: boolean;
  blockPageScroll?: boolean;
};

const MAX_ZOOM = 2;
const MIN_ZOOM = 0.6;
const WORLD_SIZE = 3000;

export default function Whiteboard({
  visible,
  roomId,
  resetKey,
  height = 280,
  enableWheelZoom = false,
  enablePinchZoom = false,
  showZoomButtons = true,
  blockPageScroll = false,
}: WhiteboardProps) {
  const [tool, setTool] = useState<"pen" | "eraser" | "line">("pen");
  const [canvasSize, setCanvasSize] = useState({ width: 0, height });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastWorldPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastViewPointRef = useRef<{ x: number; y: number } | null>(null);
  const lineStartWorldRef = useRef<{ x: number; y: number } | null>(null);
  const lineStartViewRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const liveLastSentViewPointRef = useRef<{ x: number; y: number } | null>(
    null
  );
  const liveLastSentAtRef = useRef(0);
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const lastPanViewRef = useRef<{ x: number; y: number } | null>(null);
  const spacePressedRef = useRef(false);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const isPinchingRef = useRef(false);
  const pinchStartDistanceRef = useRef(0);
  const pinchStartZoomRef = useRef(1);
  const pinchStartWorldMidRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space") {
        spacePressedRef.current = true;
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        spacePressedRef.current = false;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;

    function resizeCanvas() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = Math.max(320, Math.floor(parent.clientWidth));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = width;
      canvas.height = height;
      setCanvasSize({ width, height });
      ensureWorldCanvas();
      resetView();
      renderView();
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [visible, height]);

  useEffect(() => {
    if (!visible) return;
    ensureWorldCanvas();
    clearWorld();
    undoStackRef.current = [];
    resetView();
    renderView();
    if (roomId) emitCanvasClear();
  }, [resetKey, visible, roomId]);

  useEffect(() => {
    if (!roomId || !visible) return;
    const timer = setInterval(() => {
      emitCanvasSnapshot();
    }, 2000);
    return () => clearInterval(timer);
  }, [roomId, visible]);

  useEffect(() => {
    if (!blockPageScroll) return;
    const node = containerRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
    };
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault();
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("touchmove", onTouchMove);
    };
  }, [blockPageScroll]);

  function ensureWorldCanvas() {
    if (worldCanvasRef.current) return;
    const world = document.createElement("canvas");
    world.width = WORLD_SIZE;
    world.height = WORLD_SIZE;
    const ctx = world.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, world.width, world.height);
    }
    worldCanvasRef.current = world;
  }

  function resetView() {
    const viewWidth = canvasSize.width || 1;
    const viewHeight = canvasSize.height || height;
    zoomRef.current = 1;
    offsetRef.current = {
      x: (WORLD_SIZE - viewWidth) / 2,
      y: (WORLD_SIZE - viewHeight) / 2,
    };
  }

  function clampZoom(next: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  }

  function getViewPoint(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number
  ) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function viewToWorld(point: { x: number; y: number }) {
    return {
      x: offsetRef.current.x + point.x / zoomRef.current,
      y: offsetRef.current.y + point.y / zoomRef.current,
    };
  }

  function renderView() {
    const canvas = canvasRef.current;
    const world = worldCanvasRef.current;
    if (!canvas || !world) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const zoom = zoomRef.current;
    const viewW = canvas.width;
    const viewH = canvas.height;
    const srcW = viewW / zoom;
    const srcH = viewH / zoom;
    let sx = offsetRef.current.x;
    let sy = offsetRef.current.y;
    let sw = srcW;
    let sh = srcH;
    let dx = 0;
    let dy = 0;

    if (sx < 0) {
      dx = -sx * zoom;
      sw += sx;
      sx = 0;
    }
    if (sy < 0) {
      dy = -sy * zoom;
      sh += sy;
      sy = 0;
    }
    if (sx + sw > world.width) {
      sw = world.width - sx;
    }
    if (sy + sh > world.height) {
      sh = world.height - sy;
    }

    if (sw > 0 && sh > 0) {
      ctx.drawImage(world, sx, sy, sw, sh, dx, dy, sw * zoom, sh * zoom);
    }
  }

  function clearWorld() {
    const world = worldCanvasRef.current;
    if (!world) return;
    const ctx = world.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.restore();
  }

  function pushUndoSnapshot() {
    const world = worldCanvasRef.current;
    if (!world) return;
    const ctx = world.getContext("2d");
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, world.width, world.height);
    const stack = undoStackRef.current;
    stack.push(snapshot);
    if (stack.length > 20) stack.shift();
  }

  function undo() {
    const world = worldCanvasRef.current;
    if (!world) return;
    const ctx = world.getContext("2d");
    if (!ctx) return;
    const stack = undoStackRef.current;
    const snapshot = stack.pop();
    if (!snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
    renderView();
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

  function normalizePoint(
    canvas: HTMLCanvasElement,
    point: { x: number; y: number }
  ) {
    return { x: point.x / canvas.width, y: point.y / canvas.height };
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

  function zoomAtViewPoint(nextZoom: number, viewPoint: { x: number; y: number }) {
    const clamped = clampZoom(nextZoom);
    const worldPoint = viewToWorld(viewPoint);
    zoomRef.current = clamped;
    offsetRef.current = {
      x: worldPoint.x - viewPoint.x / clamped,
      y: worldPoint.y - viewPoint.y / clamped,
    };
    renderView();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const world = worldCanvasRef.current;
    if (!canvas || !world) return;
    canvas.setPointerCapture(event.pointerId);
    const viewPoint = getViewPoint(canvas, event.clientX, event.clientY);

    if (enablePinchZoom && event.pointerType === "touch") {
      activePointersRef.current.set(event.pointerId, viewPoint);
      if (activePointersRef.current.size >= 2) {
        const points = Array.from(activePointersRef.current.values());
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        pinchStartDistanceRef.current = Math.hypot(dx, dy);
        pinchStartZoomRef.current = zoomRef.current;
        pinchStartWorldMidRef.current = viewToWorld({
          x: (points[0].x + points[1].x) / 2,
          y: (points[0].y + points[1].y) / 2,
        });
        isPinchingRef.current = true;
        drawingRef.current = false;
        lastWorldPointRef.current = null;
        lineStartWorldRef.current = null;
        return;
      }
    }

    if (event.pointerType !== "touch" && spacePressedRef.current) {
      isPanningRef.current = true;
      lastPanViewRef.current = viewPoint;
      drawingRef.current = false;
      return;
    }

    if (isPinchingRef.current) return;
    pushUndoSnapshot();
    liveLastSentViewPointRef.current = viewPoint;
    liveLastSentAtRef.current = performance.now();
    const worldPoint = viewToWorld(viewPoint);
    if (tool === "line") {
      lineStartWorldRef.current = worldPoint;
      lineStartViewRef.current = viewPoint;
      drawingRef.current = false;
      return;
    }
    drawingRef.current = true;
    lastWorldPointRef.current = worldPoint;
    lastViewPointRef.current = viewPoint;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const world = worldCanvasRef.current;
    if (!canvas || !world) return;
    const viewPoint = getViewPoint(canvas, event.clientX, event.clientY);

    if (enablePinchZoom && event.pointerType === "touch") {
      activePointersRef.current.set(event.pointerId, viewPoint);
      if (activePointersRef.current.size >= 2) {
        const points = Array.from(activePointersRef.current.values());
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        const distance = Math.hypot(dx, dy);
        if (pinchStartDistanceRef.current > 0 && pinchStartWorldMidRef.current) {
          const nextZoom = clampZoom(
            pinchStartZoomRef.current *
              (distance / pinchStartDistanceRef.current)
          );
          const mid = {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2,
          };
          zoomRef.current = nextZoom;
          offsetRef.current = {
            x: pinchStartWorldMidRef.current.x - mid.x / nextZoom,
            y: pinchStartWorldMidRef.current.y - mid.y / nextZoom,
          };
          renderView();
        }
        return;
      }
    }

    if (isPanningRef.current && lastPanViewRef.current) {
      const dx = viewPoint.x - lastPanViewRef.current.x;
      const dy = viewPoint.y - lastPanViewRef.current.y;
      offsetRef.current = {
        x: offsetRef.current.x - dx / zoomRef.current,
        y: offsetRef.current.y - dy / zoomRef.current,
      };
      lastPanViewRef.current = viewPoint;
      renderView();
      return;
    }

    if (!drawingRef.current || tool === "line") return;
    if (isPinchingRef.current) return;

    const ctx = world.getContext("2d");
    if (!ctx) return;
    applyStrokeStyle(ctx);
    const nextWorld = viewToWorld(viewPoint);
    const lastWorld = lastWorldPointRef.current;
    if (!lastWorld) {
      lastWorldPointRef.current = nextWorld;
      lastViewPointRef.current = viewPoint;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(lastWorld.x, lastWorld.y);
    ctx.lineTo(nextWorld.x, nextWorld.y);
    ctx.stroke();
    lastWorldPointRef.current = nextWorld;
    lastViewPointRef.current = viewPoint;
    renderView();

    const now = performance.now();
    const lastSent = liveLastSentViewPointRef.current;
    if (lastSent && now - liveLastSentAtRef.current >= 30) {
      emitCanvasStroke(tool === "eraser" ? "eraser" : "pen", lastSent, viewPoint);
      liveLastSentViewPointRef.current = viewPoint;
      liveLastSentAtRef.current = now;
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const world = worldCanvasRef.current;
    if (!canvas || !world) return;
    const viewPoint = getViewPoint(canvas, event.clientX, event.clientY);

    if (enablePinchZoom && event.pointerType === "touch") {
      activePointersRef.current.delete(event.pointerId);
      if (activePointersRef.current.size < 2) {
        isPinchingRef.current = false;
        pinchStartDistanceRef.current = 0;
        pinchStartZoomRef.current = zoomRef.current;
        pinchStartWorldMidRef.current = null;
      }
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
      lastPanViewRef.current = null;
      canvas.releasePointerCapture(event.pointerId);
      return;
    }

    if (isPinchingRef.current) {
      canvas.releasePointerCapture(event.pointerId);
      return;
    }

    const ctx = world.getContext("2d");
    if (!ctx) return;

    if (tool === "line" && lineStartWorldRef.current && lineStartViewRef.current) {
      const startWorld = lineStartWorldRef.current;
      const endWorld = viewToWorld(viewPoint);
      applyStrokeStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(startWorld.x, startWorld.y);
      ctx.lineTo(endWorld.x, endWorld.y);
      ctx.stroke();
      renderView();
      emitCanvasStroke("pen", lineStartViewRef.current, viewPoint);
    }

    if (tool !== "line" && liveLastSentViewPointRef.current) {
      emitCanvasStroke(
        tool === "eraser" ? "eraser" : "pen",
        liveLastSentViewPointRef.current,
        viewPoint
      );
    }

    drawingRef.current = false;
    lastWorldPointRef.current = null;
    lastViewPointRef.current = null;
    lineStartWorldRef.current = null;
    lineStartViewRef.current = null;
    liveLastSentViewPointRef.current = null;
    canvas.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (blockPageScroll || enableWheelZoom) {
      event.preventDefault();
    }
    if (!enableWheelZoom) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewPoint = getViewPoint(canvas, event.clientX, event.clientY);
    const delta = event.deltaY;
    const next = zoomRef.current + (delta > 0 ? -0.1 : 0.1);
    zoomAtViewPoint(next, viewPoint);
  }


  if (!visible) return null;

  return (
    <div className="rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm">
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
        {showZoomButtons && (
          <>
            <button
              onClick={() =>
                zoomAtViewPoint(zoomRef.current - 0.2, {
                  x: canvasSize.width / 2,
                  y: canvasSize.height / 2,
                })
              }
              className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition"
              aria-label="Zoom ud"
            >
              Zoom -
            </button>
            <button
              onClick={() =>
                zoomAtViewPoint(1, {
                  x: canvasSize.width / 2,
                  y: canvasSize.height / 2,
                })
              }
              className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition"
              aria-label="Nulstil zoom"
            >
              100%
            </button>
            <button
              onClick={() =>
                zoomAtViewPoint(zoomRef.current + 0.2, {
                  x: canvasSize.width / 2,
                  y: canvasSize.height / 2,
                })
              }
              className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition"
              aria-label="Zoom ind"
            >
              Zoom +
            </button>
          </>
        )}
        <button
          onClick={() => {
            pushUndoSnapshot();
            clearWorld();
            renderView();
            emitCanvasClear();
          }}
          className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition"
        >
          Ryd fladen
        </button>
      </div>
      <div
        className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-white/80"
        onWheel={handleWheel}
        ref={containerRef}
      >
        <canvas
          ref={canvasRef}
          className="block touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
    </div>
  );
}
