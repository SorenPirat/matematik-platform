"use client";

import type { LiveEvent } from "@/utils/liveTypes";
import { supabase } from "@/utils/supabaseClient";
import type { RealtimeChannel } from "@supabase/supabase-js";

const channels = new Map<string, RealtimeChannel>();
const handlers = new Map<string, Set<(event: LiveEvent) => void>>();

function ensureChannel(roomId: string) {
  let channel = channels.get(roomId);
  if (channel) return channel;

  channel = supabase.channel(`live:${roomId}`, {
    config: {
      broadcast: { self: true },
    },
  });

  channel.on("broadcast", { event: "live" }, (payload) => {
    const event = payload.payload as LiveEvent;
    const roomHandlers = handlers.get(roomId);
    if (!roomHandlers) return;
    for (const handler of Array.from(roomHandlers)) {
      handler(event);
    }
  });

  channel.subscribe();
  channels.set(roomId, channel);
  return channel;
}

export function sendLiveEvent(roomId: string, event: LiveEvent) {
  if (!roomId) return;
  const channel = ensureChannel(roomId);
  channel.send({ type: "broadcast", event: "live", payload: event });
}

export function subscribeLiveEvents(
  roomId: string,
  handler: (event: LiveEvent) => void
) {
  if (!roomId) return () => {};
  const roomHandlers = handlers.get(roomId) ?? new Set();
  roomHandlers.add(handler);
  handlers.set(roomId, roomHandlers);
  ensureChannel(roomId);

  return () => {
    const set = handlers.get(roomId);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      handlers.delete(roomId);
      const channel = channels.get(roomId);
      if (channel) {
        channel.unsubscribe();
        channels.delete(roomId);
      }
    }
  };
}
