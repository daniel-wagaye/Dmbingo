import { Room } from '@colyseus/core';
import { GameState, PlayerPick } from './schema/GameState';
import { ArraySchema } from '@colyseus/schema';

export let activeRoom: GameRoom | null = null;

export class GameRoom extends Room<{ state: GameState }> {
  onCreate() {
    this.setState(new GameState());
    activeRoom = this;
    this.autoDispose = false;
    console.log('[GameRoom] onCreate — room created, activeRoom set');
  }

  onJoin(client: any) {
    console.log(`[GameRoom] Client joined: ${client.sessionId}. State: phase=${this.state.phase}, stake=${this.state.stakeAmount}, pickingEndsAt=${this.state.pickingEndsAt}`);
  }

  onLeave(client: any, code?: number) {
    console.log(`[GameRoom] Client left: ${client.sessionId} (code=${code})`);
  }

  public setNewGame(gameData: {
    phase: string;
    game_id?: number;
    picking_ends_at?: string | null;
    stake_amount?: number;
    minimum_player?: number;
  }) {
    this.state.phase = gameData.phase;
    this.state.gameId = gameData.game_id ?? 0;
    this.state.pickingEndsAt = gameData.picking_ends_at
      ? new Date(gameData.picking_ends_at).getTime()
      : 0;
    this.state.winnerRevealEndsAt = 0;
    this.state.stakeAmount = gameData.stake_amount ?? 0;
    this.state.minimumPlayer = gameData.minimum_player ?? 0;
    console.log(`[GameRoom] setNewGame: phase=${gameData.phase}, gameId=${this.state.gameId}, stake=${this.state.stakeAmount}`);
    this.state.activePlayers = 0;
    this.state.shuffledNums = new ArraySchema<number>();
    this.state.callingStarted = false;
    this.state.calledIndex = 0;
    this.state.prizeAmount = 0;
    this.state.picks.clear();
  }

  public updatePick(
    boardId: number,
    telegramId: number,
    winner: boolean,
    winnerName: string
  ) {
    const key = boardId.toString();
    if (telegramId === 0) {
      this.state.picks.delete(key);
      return;
    }
    let pick = this.state.picks.get(key);
    if (!pick) {
      pick = new PlayerPick();
      this.state.picks.set(key, pick);
    }
    pick.telegramId = telegramId;
    pick.winner = winner;
    pick.winnerName = winnerName;
  }

  public setCalledIndex(index: number) {
    this.state.calledIndex = index;
  }

  public startGame(
    shuffledNums: number[],
    prizeAmount: number,
    activePlayers: number
  ) {
    this.state.phase = 'started';
    this.state.shuffledNums = new ArraySchema<number>(...shuffledNums);
    this.state.prizeAmount = prizeAmount;
    this.state.activePlayers = activePlayers;
    this.state.callingStarted = false;
    this.state.calledIndex = 0;
    this.state.pickingEndsAt = 0;
  }

  public setCallingStarted() {
    this.state.callingStarted = true;
  }

  public setWinnerReveal(endsAtMs: number) {
    this.state.phase = 'winner_reveal';
    this.state.winnerRevealEndsAt = endsAtMs;
  }

  public setPickingEndsAt(endsAtMs: number) {
    this.state.pickingEndsAt = endsAtMs;
  }

  public getWinnerBoardIds(): number[] {
    const ids: number[] = [];
    this.state.picks.forEach((pick, key) => {
      if (pick.winner) ids.push(Number(key));
    });
    return ids;
  }
}
