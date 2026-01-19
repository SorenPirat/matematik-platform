import type { NextRequest } from "next/server";
import { addSubscriber, publishEvent, removeSubscriber } from "@/utils/liveRooms";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.room !== "string" || !body.event) {
    return Response.json({ ok: false }, { status: 400 });
  }
  publishEvent(body.room, body.event);
  return Response.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const room = url.searchParams.get("room");
  if (!room) {
    return new Response("Missing room", { status: 400 });
  }

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      addSubscriber(room, controller);
      controller.enqueue(encoder.encode(": ok\n\n"));
      ping = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);
    },
    cancel() {
      if (ping) clearInterval(ping);
      if (controllerRef) removeSubscriber(room, controllerRef);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
