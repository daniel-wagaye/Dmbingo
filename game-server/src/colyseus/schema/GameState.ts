import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';

export class PlayerPick extends Schema {
  @type('number') telegramId: number = 0;
  @type('boolean') winner: boolean = false;
  @type('string') winnerName: string = '';
  @type('boolean') auto: boolean = true;
}

export class GameState extends Schema {
  @type('string') phase: string = 'maintenance';
  @type('number') gameId: number = 0;
  @type('number') activePlayers: number = 0;
  @type(['number']) shuffledNums = new ArraySchema<number>();
  @type('boolean') callingStarted: boolean = false;
  @type('number') pickingEndsAt: number = 0;
  @type('number') winnerRevealEndsAt: number = 0;
  @type('number') calledIndex: number = 0;
  @type('number') stakeAmount: number = 0;
  @type('number') prizeAmount: number = 0;
  @type('number') minimumPlayer: number = 0;
  @type({ map: PlayerPick }) picks = new MapSchema<PlayerPick>();
}
