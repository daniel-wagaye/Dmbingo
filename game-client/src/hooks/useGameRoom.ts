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

  const attachListeners = useCallback((room: any) => {
    roomRef.current = room;
    const s = room.state as any;
    if (s) {
      const state = extractState(s);
      setGameState(state);
      setPicks(extractPicks(s.picks));
    }
    setConnected(true);
    setLoading(false);

    room.onStateChange((state: any) => {
      if (!mountedRef.current) return;
      setGameState(extractState(state));
      setPicks(extractPicks(state.picks));
    });

    room.onLeave(() => {
      if (!mountedRef.current) return;
      setConnected(false);
      roomRef.current = null;
    });
  }, []);

  const connect = useCallback(async () => {
    try {
      const room = await joinGameRoom();
      if (!mountedRef.current) return;
      attachListeners(room);
    } catch (err) {
      console.error('[useGameRoom] Failed to connect:', err);
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, [attachListeners]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    // Reconnect when app returns from background (screen on, tab focus, etc.)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        // Force-kill the old (potentially dead) connection immediately, then create fresh
        forceLeaveGameRoom();
        roomRef.current = null;
        setConnected(false);
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      leaveGameRoom();
    };
  }, [connect]);

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
