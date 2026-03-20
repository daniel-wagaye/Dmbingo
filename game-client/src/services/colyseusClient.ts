import { Client, Room } from '@colyseus/sdk';

function deriveWsUrl(): string {
  const colyseusUrl = import.meta.env.VITE_COLYSEUS_URL as string | undefined;
  if (colyseusUrl && colyseusUrl.trim().length > 0) {
    return colyseusUrl.trim();
  }
  const apiUrl = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';
  return apiUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
}

const client = new Client(deriveWsUrl());

let room: Room | null = null;
let joinPromise: Promise<Room> | null = null;
let joinGeneration = 0;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingLeaveTimeout: ReturnType<typeof setTimeout> | null = null;
let intentionalLeave = false;
const JOIN_CANCELLED = 'JOIN_CANCELLED';

const getReconnectDelay = (attempt: number): number =>
  Math.min(1000 * Math.pow(2, attempt), 30000);

function clearReconnectTimeout(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

function clearPendingLeaveTimeout(): void {
  if (pendingLeaveTimeout) {
    clearTimeout(pendingLeaveTimeout);
    pendingLeaveTimeout = null;
  }
}

function scheduleReconnect(): void {
  if (intentionalLeave || reconnectTimeout) return;
  const delay = getReconnectDelay(reconnectAttempts);
  console.log(`[colyseus] Reconnecting in ${delay}ms...`);
  reconnectTimeout = setTimeout(async () => {
    reconnectTimeout = null;
    reconnectAttempts++;
    try { await joinGameRoom(); } catch { return; }
  }, delay);
}

export async function joinGameRoom(): Promise<Room> {
  clearPendingLeaveTimeout();
  intentionalLeave = false;
  if (room) return room;
  if (joinPromise) return joinPromise;
  clearReconnectTimeout();
  const generation = ++joinGeneration;

  joinPromise = (async () => {
    try {
      const joinedRoom = await client.joinOrCreate('game_room');
      if (generation !== joinGeneration || intentionalLeave) {
        try {
          await joinedRoom.leave();
        } catch {
          void 0;
        }
        throw new Error(JOIN_CANCELLED);
      }
      room = joinedRoom;
      reconnectAttempts = 0;

      joinedRoom.onLeave((code) => {
        console.log(`[colyseus] Left room (code ${code})`);
        if (room !== joinedRoom) return;
        room = null;
        joinPromise = null;
        scheduleReconnect();
      });

      return joinedRoom;
    } catch (error) {
      if (error instanceof Error && error.message === JOIN_CANCELLED) {
        throw error;
      }
      console.error('[colyseus] Failed to join room:', error);
      room = null;
      scheduleReconnect();
      throw error;
    } finally {
      if (generation === joinGeneration) {
        joinPromise = null;
      }
    }
  })();

  return joinPromise;
}

export function leaveGameRoom(): void {
  intentionalLeave = true;
  clearPendingLeaveTimeout();
  clearReconnectTimeout();
  joinGeneration++;
  joinPromise = null;
  const currentRoom = room;
  if (currentRoom) {
    pendingLeaveTimeout = setTimeout(() => {
      pendingLeaveTimeout = null;
      if (room !== currentRoom) return;
      room = null;
      currentRoom.leave();
    }, 60000);
  }
  reconnectAttempts = 0;
}

export function getRoom(): Room | null {
  return room;
}
