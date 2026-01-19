const encoder = new TextEncoder();

type Subscriber = ReadableStreamDefaultController<Uint8Array>;

type LiveRoomsStore = Map<string, Set<Subscriber>>;

const globalStore = globalThis as unknown as {
  __liveRooms?: LiveRoomsStore;
};

const rooms: LiveRoomsStore = globalStore.__liveRooms ?? new Map();
globalStore.__liveRooms = rooms;

export function addSubscriber(room: string, controller: Subscriber) {
  const subscribers = rooms.get(room) ?? new Set();
  subscribers.add(controller);
  rooms.set(room, subscribers);
}

export function removeSubscriber(room: string, controller: Subscriber) {
  const subscribers = rooms.get(room);
  if (!subscribers) return;
  subscribers.delete(controller);
  if (subscribers.size === 0) rooms.delete(room);
}

export function publishEvent(room: string, event: unknown) {
  const subscribers = rooms.get(room);
  if (!subscribers) return;
  const payload = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const controller of Array.from(subscribers)) {
    try {
      controller.enqueue(payload);
    } catch {
      subscribers.delete(controller);
    }
  }
  if (subscribers.size === 0) rooms.delete(room);
}
