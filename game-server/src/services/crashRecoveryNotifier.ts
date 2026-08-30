import { isBotTelegramId } from '../constants/bots';
import { sendPaced, type PacedMessage } from '../utils/telegramSend';

/**
 * Tells everyone who played a game that died mid-flight what happened to it: the winner
 * reveal never rendered, but the prize was still paid out from the SSD winner record.
 */

export interface RecoveryWinner {
  telegram_id: number;
  board_id: number;
  /** Already formatted to two decimals. */
  amount: string;
  name: string;
}

export interface RecoveryPlayer {
  telegram_id: number;
  board_id: number;
}

const PLAY_BUTTON = {
  reply_markup: {
    inline_keyboard: [[{ text: 'Play Again 🎱', url: 'https://t.me/dmbingobot/startapp' }]],
  },
};

const nonWinnerText = (gameId: number, winnerLines: string, totalPrize: string): string =>
  `🎯 ጨዋታው እንደገና ተጀምሯል!\n\n` +
  `Game #${gameId} የአሸናፊ ማሳያው ከመታየቱ በፊት በሰርቨር ምክንያት ተቋርጦ ነበር።\n\n` +
  `የጨዋታው ውርርድ ሂሳብ ለአሸናፊው/አሸናፊዎቹ በስርዓቱ ወደ ዋሌታቸው ገቢ ተደርጓል፣ እና ጨዋታው አሁን እንደገና ተጀምሯል።\n\n` +
  `🏆 አሸናፊዎች፦\n${winnerLines}\n\n` +
  `💰 ጠቅላላ ሽልማት፦ ${totalPrize} ETB\n\n` +
  `ተመልሰው ይጫወቱ! 🎯`;

const winnerText = (
  gameId: number,
  boards: string,
  yourAmount: string,
  winnerLines: string,
  totalPrize: string
): string =>
  `🎉 እንኳን ደስ አለዎት! አሸንፈዋል!\n\n` +
  `በGame #${gameId} በBoard #${boards} ${yourAmount} ብር አሸንፈዋል።\n\n` +
  `የጨዋታው አሸናፊ ማሳያ ከመታየቱ በፊት ጨዋታው በሰርቨር ምክንያት ተቋርጦ ነበር፤ ነገር ግን ሽልማትዎ ተጠብቆ ወደ ዋሌትዎ ገቢ ሁኗል፡፡\n\n` +
  `🏆 አሸናፊዎች፦\n${winnerLines}\n\n` +
  `💰 ጠቅላላ ሽልማት፦ ${totalPrize} ETB\n\n` +
  `ጨዋታው እንደገና ተጀምሯል። ተመልሰው ይጫወቱ! 🎯`;

/** One player can hold several winning boards, so their prize lines are merged. */
interface WinnerTotals {
  boards: number[];
  amount: number;
  name: string;
}

function groupByPlayer(winners: RecoveryWinner[]): Map<number, WinnerTotals> {
  const totals = new Map<number, WinnerTotals>();
  for (const w of winners) {
    const existing = totals.get(w.telegram_id);
    if (existing) {
      existing.boards.push(w.board_id);
      existing.amount += Number(w.amount);
    } else {
      totals.set(w.telegram_id, {
        boards: [w.board_id],
        amount: Number(w.amount),
        name: w.name,
      });
    }
  }
  return totals;
}

export function buildCrashRecoveryMessages(
  gameId: number,
  players: RecoveryPlayer[],
  winners: RecoveryWinner[],
  totalPrize: string
): PacedMessage[] {
  if (players.length === 0) return [];

  // Bots hold real user rows but no reachable chat, so messaging them only produces noise.
  const recipients = [
    ...new Set(
      players
        .map((p) => Number(p.telegram_id))
        .filter((id) => Number.isFinite(id) && id > 0 && !isBotTelegramId(id))
    ),
  ];
  if (recipients.length === 0) return [];

  const detailedLines = winners
    .map((w) => `• ${w.name} — ${w.amount} ETB (Board #${w.board_id})`)
    .join('\n');
  const plainLines = winners.map((w) => `• ${w.name} — ${w.amount} ETB`).join('\n');

  const totals = groupByPlayer(winners);

  const messages: PacedMessage[] = recipients.map((telegramId) => {
    const mine = totals.get(telegramId);
    if (mine) {
      return {
        telegram_id: telegramId,
        text: winnerText(
          gameId,
          mine.boards.sort((a, b) => a - b).join(', #'),
          mine.amount.toFixed(2),
          plainLines,
          totalPrize
        ),
        extra: PLAY_BUTTON,
      };
    }
    return {
      telegram_id: telegramId,
      text: nonWinnerText(gameId, detailedLines, totalPrize),
      extra: PLAY_BUTTON,
    };
  });

  return messages;
}

export async function sendCrashRecoveryMessages(
  gameId: number,
  players: RecoveryPlayer[],
  winners: RecoveryWinner[],
  totalPrize: string
): Promise<void> {
  const messages = buildCrashRecoveryMessages(gameId, players, winners, totalPrize);
  if (messages.length === 0) return;

  console.log(
    `[crashRecovery] Notifying ${messages.length} player(s) about recovered game ${gameId}.`
  );
  await sendPaced(messages, 'crashRecovery');
}
