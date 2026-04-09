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
let pendingLeaveTimeout: ReturnType<typeof setTimeout> | null = null;
let intentionalLeave = false;
const JOIN_CANCELLED = 'JOIN_CANCELLED';

export function isRoomAlive(r: Room | null): boolean {
  if (!r) return false;
  try {
    const ws = (r.connection as any)?.ws ?? (r as any).connection?.transport?.ws;
    if (ws && typeof ws.readyState === 'number') {
      return ws.readyState === WebSocket.OPEN;
    }
  } catch { /* ignore */ }
  return true; // can't check — assume alive
}

function clearPendingLeaveTimeout(): void {
  if (pendingLeaveTimeout) {
    clearTimeout(pendingLeaveTimeout);
    pendingLeaveTimeout = null;
  }
}

export async function joinGameRoom(): Promise<Room> {
  clearPendingLeaveTimeout();
  intentionalLeave = false;
  if (room && isRoomAlive(room)) return room;
  if (room && !isRoomAlive(room)) {
    console.warn('[colyseus] Discarding zombie room (WebSocket not OPEN)');
    try { room.leave(true); } catch { /* ignore */ }
    room = null;
    joinPromise = null;
  }
  if (joinPromise) return joinPromise;
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

      joinedRoom.onLeave((code) => {
        console.log(`[colyseus] Left room (code ${code})`);
        if (room !== joinedRoom) return;
        room = null;
        joinPromise = null;
      });

      return joinedRoom;
    } catch (error) {
      if (error instanceof Error && error.message === JOIN_CANCELLED) {
        throw error;
      }
      console.error('[colyseus] Failed to join room:', error);
      room = null;
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
  joinGeneration++;
  joinPromise = null;
  const currentRoom = room;
  room = null;
  if (currentRoom) {
    try { currentRoom.leave(true); } catch { /* ignore */ }
    try {
      const ws = (currentRoom.connection as any)?.ws ?? (currentRoom as any).connection?.transport?.ws;
      if (ws && typeof ws.close === 'function') ws.close();
    } catch { /* ignore */ }
  }
}

/**
 * Force-kill the room connection immediately (no 60s delay).
 * Used when returning from background after the WebSocket is dead.
 */
export function forceLeaveGameRoom(): void {
  intentionalLeave = true;
  clearPendingLeaveTimeout();
  joinGeneration++;
  joinPromise = null;
  const currentRoom = room;
  room = null;
  if (currentRoom) {
    try { currentRoom.leave(true); } catch { /* ignore */ }
    // Force-close the raw WebSocket in case leave() didn't work (zombie)
    try {
      const ws = (currentRoom.connection as any)?.ws ?? (currentRoom as any).connection?.transport?.ws;
      if (ws && typeof ws.close === 'function') ws.close();
    } catch { /* ignore */ }
  }
}

export function getRoom(): Room | null {
  return room;
}
