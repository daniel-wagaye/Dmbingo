import { useEffect, useState, useCallback, useRef } from 'react';
import { joinGameRoom, leaveGameRoom } from '../services/colyseusClient';

export interface PlayerPick {
  telegramId: number;
  winner: boolean;
  invalid: boolean;
  winnerName: string;
}

export interface GameRoomState {
  phase: string;
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

  const connect = useCallback(async () => {
    try {
      const room = await joinGameRoom();
      if (!mountedRef.current) return;

      console.log('[useGameRoom] Connected to room. Initial state:', room.state);
      setConnected(true);
      setLoading(false);

      // Read initial state
      const s = room.state as any;
      if (s) {
        const initial = extractState(s);
        console.log('[useGameRoom] Initial extracted state:', initial.phase, 'pickingEndsAt:', initial.pickingEndsAt, 'stake:', initial.stakeAmount);
        setGameState(initial);
        setPicks(extractPicks(s.picks));
      }

      // Listen for ALL state changes — Colyseus sends binary patches
      room.onStateChange((state: any) => {
        if (!mountedRef.current) return;
        const extracted = extractState(state);
        setGameState(extracted);
        setPicks(extractPicks(state.picks));
      });

      room.onLeave(() => {
        if (!mountedRef.current) return;
        console.log('[useGameRoom] Disconnected from room');
        setConnected(false);
      });
    } catch (err) {
      console.error('[useGameRoom] Failed to connect:', err);
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      leaveGameRoom();
    };
  }, [connect]);

  return { gameState, picks, loading, connected };
}

function extractState(s: any): GameRoomState {
  return {
    phase: s.phase ?? 'maintenance',
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
        invalid: !!pick.invalid,
        winnerName: pick.winnerName ?? '',
      });
    });
  }
  return result;
}
