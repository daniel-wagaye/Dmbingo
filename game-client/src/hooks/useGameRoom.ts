import { useEffect, useState, useCallback, useRef } from 'react';
import { joinGameRoom, leaveGameRoom, forceLeaveGameRoom, isRoomAlive } from '../services/colyseusClient';

export interface PlayerPick {
  telegramId: number;
  winner: boolean;
  winnerName: string;
}

export interface GameRoomState {
  phase: string;
  gameId: number;
  activePlayers: number;
  shuffledNums: number[];
  callingStarted: boolean;
  pickingEndsAt: number;
  winnerRevealEndsAt: number;
  calledIndex: number;
  stakeAmount: number;
  prizeAmount: number;
  minimumPlayer: number;
  picks: Map<string, PlayerPick>;
}

interface UseGameRoomReturn {
  gameState: GameRoomState | null;
  picks: Map<string, PlayerPick>;
  loading: boolean;
  connected: boolean;
}

export function useGameRoom(): UseGameRoomReturn {
  const [gameState, setGameState] = useState<GameRoomState | null>(null);
  const [picks, setPicks] = useState<Map<string, PlayerPick>>(new Map());
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);
  const roomRef = useRef<any>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingRef = useRef(false);
  const subscribedRoomRef = useRef<any>(null);
  const suppressLeaveCountRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const doConnect = useCallback(async (options?: { force?: boolean }) => {
    if (!mountedRef.current) return;
    if (connectingRef.current) return;
    if (!options?.force && roomRef.current) return;

    // If force requested but current room is alive and healthy, skip
    if (options?.force && roomRef.current && isRoomAlive(roomRef.current)) {
      console.log('[useGameRoom] Room is alive, skipping force reconnect.');
      return;
    }

    connectingRef.current = true;
    clearReconnectTimer();

    try {
      if (options?.force && roomRef.current) {
        suppressLeaveCountRef.current += 1;
        forceLeaveGameRoom();
        roomRef.current = null;
        subscribedRoomRef.current = null;
        setConnected(false);
      }

      const room = await joinGameRoom();
      if (!mountedRef.current) return;

      roomRef.current = room;
      const s = room.state as any;
      if (s) {
        setGameState(extractState(s));
        setPicks(extractPicks(s.picks));
      }
      setConnected(true);
      setLoading(false);

      if (subscribedRoomRef.current !== room) {
        subscribedRoomRef.current = room;
        room.onStateChange((state: any) => {
          if (!mountedRef.current) return;
          setGameState(extractState(state));
          setPicks(extractPicks(state.picks));
        });

        room.onLeave((code: number) => {
          if (!mountedRef.current) return;
          if (suppressLeaveCountRef.current > 0) {
            suppressLeaveCountRef.current -= 1;
            return;
          }
          // Code 4000 = intentional leave (from leave(true)) — do not reconnect
          if (code === 4000) {
            console.log('[useGameRoom] Intentional leave (4000), no reconnect.');
            return;
          }
          console.log(`[useGameRoom] Room left unexpectedly (code ${code}). Auto-reconnecting in 2s...`);
          setConnected(false);
          roomRef.current = null;
          subscribedRoomRef.current = null;
          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) doConnect();
          }, 2000);
        });
      }
    } catch (err) {
      console.error('[useGameRoom] Connect failed:', err);
      if (!mountedRef.current) return;
      setLoading(false);
      setConnected(false);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) doConnect();
      }, 3000);
    } finally {
      connectingRef.current = false;
    }
  }, [clearReconnectTimer]);

  useEffect(() => {
    mountedRef.current = true;
    doConnect();

    const debouncedForceConnect = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (mountedRef.current) doConnect({ force: true });
      }, 500);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        console.log('[useGameRoom] Visibility restored. Reconnecting (debounced)...');
        debouncedForceConnect();
      }
    };

    const handleOnline = () => {
      if (mountedRef.current) {
        console.log('[useGameRoom] Network online. Reconnecting (debounced)...');
        debouncedForceConnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      subscribedRoomRef.current = null;
      leaveGameRoom();
    };
  }, [doConnect, clearReconnectTimer]);

  return { gameState, picks, loading, connected };
}

function extractState(s: any): GameRoomState {
  return {
    phase: s.phase ?? 'maintenance',
    gameId: s.gameId ?? 0,
    activePlayers: s.activePlayers ?? 0,
    shuffledNums: s.shuffledNums ? Array.from(s.shuffledNums) : [],
    callingStarted: !!s.callingStarted,
    pickingEndsAt: s.pickingEndsAt ?? 0,
    winnerRevealEndsAt: s.winnerRevealEndsAt ?? 0,
    calledIndex: s.calledIndex ?? 0,
    stakeAmount: s.stakeAmount ?? 0,
    prizeAmount: s.prizeAmount ?? 0,
    minimumPlayer: s.minimumPlayer ?? 0,
    picks: extractPicks(s.picks),
  };
}

function extractPicks(picksMap: any): Map<string, PlayerPick> {
  const result = new Map<string, PlayerPick>();
  if (!picksMap) return result;
  if (typeof picksMap.forEach === 'function') {
    picksMap.forEach((pick: any, key: string) => {
      result.set(key, {
        telegramId: pick.telegramId ?? 0,
        winner: !!pick.winner,
        winnerName: pick.winnerName ?? '',
      });
    });
  }
  return result;
}
