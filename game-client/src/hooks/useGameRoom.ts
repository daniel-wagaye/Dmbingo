import { useEffect, useState, useCallback, useRef } from 'react';
import { joinGameRoom, leaveGameRoom, forceLeaveGameRoom } from '../services/colyseusClient';

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

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const doConnect = useCallback(async () => {
    if (!mountedRef.current) return;
    clearReconnectTimer();

    try {
      forceLeaveGameRoom();
      roomRef.current = null;

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

      room.onStateChange((state: any) => {
        if (!mountedRef.current) return;
        setGameState(extractState(state));
        setPicks(extractPicks(state.picks));
      });

      room.onLeave((code: number) => {
        if (!mountedRef.current) return;
        console.log(`[useGameRoom] Room left (code ${code}). Scheduling reconnect...`);
        setConnected(false);
        roomRef.current = null;
        // Auto-reconnect after network drop (not intentional leave)
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) doConnect();
        }, 1500);
      });
    } catch (err) {
      console.error('[useGameRoom] Connect failed:', err);
      if (!mountedRef.current) return;
      setLoading(false);
      setConnected(false);
      // Retry connect after failure
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) doConnect();
      }, 2000);
    }
  }, [clearReconnectTimer]);

  useEffect(() => {
    mountedRef.current = true;
    doConnect();

    // Reconnect when app returns from background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        doConnect();
      }
    };

    // Reconnect when network comes back online
    const handleOnline = () => {
      if (mountedRef.current) {
        console.log('[useGameRoom] Network online. Reconnecting...');
        doConnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
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
