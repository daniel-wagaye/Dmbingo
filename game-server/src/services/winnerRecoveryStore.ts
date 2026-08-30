import fsp from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import path from 'path';
import { config } from '../config';

/**
 * Durable record of the winners detected for a game, written to the local SSD the moment a
 * bingo is accepted and removed again once finalize_game has committed the payout.
 *
 * It exists for exactly one failure mode: the process dies between "winner detected in memory"
 * and "finalize_game committed". Without it, recover_game_state() sees a started game with no
 * winner rows in Postgres and refunds every player, silently erasing a real win.
 *
 * Nothing in the live game path reads this directory — it is write-only until the next boot.
 */

export interface StoredWinner {
  telegram_id: number;
  board_id: number;
}

export interface WinnerRecoveryRecord {
  game_id: number;
  winners: StoredWinner[];
  stored_at: string;
}

const DIR = config.winnerRecoveryDir;
// The plan requires exactly three attempts before giving up and logging.
const WRITE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 50;
const FILE_PATTERN = /^game-(\d+)\.json$/;
const MAX_BOARD_ID = 500;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let dirReady = false;
let dirSyncWarned = false;
let tmpCounter = 0;

const fileFor = (gameId: number): string => path.join(DIR, `game-${gameId}.json`);

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await fsp.mkdir(DIR, { recursive: true });
  dirReady = true;
}

/**
 * Persists the rename itself. Windows cannot fsync a directory handle and some filesystems
 * reject it, so a failure here only warns: the rename is still atomic, which is what protects
 * against a torn file after a process crash.
 */
async function syncDir(): Promise<void> {
  if (process.platform === 'win32') return;
  let handle: FileHandle | null = null;
  try {
    handle = await fsp.open(DIR, 'r');
    await handle.sync();
  } catch (err) {
    if (!dirSyncWarned) {
      dirSyncWarned = true;
      console.warn('[winnerStore] Directory fsync unavailable; relying on atomic rename.', err);
    }
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * write temp -> fsync temp -> close -> atomic rename -> fsync dir.
 * The final file is never opened for writing, so a crash can never expose a partial record.
 */
async function writeAtomic(record: WinnerRecoveryRecord): Promise<void> {
  await ensureDir();

  const finalPath = fileFor(record.game_id);
  const tmpPath = path.join(DIR, `.game-${record.game_id}.${process.pid}.${++tmpCounter}.tmp`);
  const payload = JSON.stringify(record);

  let handle: FileHandle | null = null;
  try {
    handle = await fsp.open(tmpPath, 'w');
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;

    await fsp.rename(tmpPath, finalPath);
    await syncDir();
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* ignore */
      }
    }
    // Never leave a half-written temp file behind for the pruner to trip over.
    try {
      await fsp.unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// Every mutation runs through one chain. Two bingo requests landing in the same millisecond
// therefore replace the file one after the other, each with a complete snapshot, instead of
// racing read-modify-write cycles that could drop a winner.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

function normalize(winners: StoredWinner[]): StoredWinner[] {
  const seen = new Map<number, StoredWinner>();
  for (const w of winners) {
    const boardId = Number(w?.board_id);
    const telegramId = Number(w?.telegram_id);
    if (!Number.isInteger(boardId) || boardId < 1 || boardId > MAX_BOARD_ID) continue;
    if (!Number.isFinite(telegramId) || telegramId <= 0) continue;
    if (!seen.has(boardId)) seen.set(boardId, { telegram_id: telegramId, board_id: boardId });
  }
  return [...seen.values()].sort((a, b) => a.board_id - b.board_id);
}

/**
 * Replaces the game's file with a full snapshot of the winners known so far.
 * Resolves `false` when all three attempts failed — callers must carry on regardless, because
 * a disk fault must never stop a game from finalizing.
 */
export function saveWinners(gameId: number, winners: StoredWinner[]): Promise<boolean> {
  const record: WinnerRecoveryRecord = {
    game_id: Number(gameId),
    winners: normalize(winners),
    stored_at: new Date().toISOString(),
  };

  return enqueue(async () => {
    for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
      try {
        await writeAtomic(record);
        return true;
      } catch (err) {
        // The directory may have been removed underneath us; force a recreate on retry.
        dirReady = false;
        if (attempt >= WRITE_ATTEMPTS) {
          console.error(
            '[winnerStore] CRITICAL: winner snapshot NOT persisted after ' +
              `${WRITE_ATTEMPTS} attempts. A crash before finalize_game would refund these winners.`,
            {
              operation: 'saveWinners',
              game_id: record.game_id,
              winners: record.winners,
              path: fileFor(record.game_id),
              error: err instanceof Error ? err.message : String(err),
            }
          );
          return false;
        }
        // Escalating, but small enough that three attempts stay well inside the
        // acceptance window even in the worst case.
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
    return false;
  });
}

/**
 * Reads one game's record straight by filename — no directory scan, the same way the game id
 * is used as a key against the database.
 */
export async function readWinners(gameId: number): Promise<WinnerRecoveryRecord | null> {
  const target = Number(gameId);
  let raw: string;
  try {
    raw = await fsp.readFile(fileFor(target), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`[winnerStore] Could not read winner file for game ${target}:`, err);
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WinnerRecoveryRecord>;
    // A file whose contents disagree with its name is corrupt; refuse it rather than
    // finalizing the wrong game.
    if (!parsed || Number(parsed.game_id) !== target || !Array.isArray(parsed.winners)) {
      console.error(`[winnerStore] Winner file for game ${target} is malformed. Ignoring it.`);
      return null;
    }
    const winners = normalize(parsed.winners as StoredWinner[]);
    if (winners.length === 0) return null;
    return { game_id: target, winners, stored_at: String(parsed.stored_at ?? '') };
  } catch (err) {
    console.error(`[winnerStore] Winner file for game ${target} is not valid JSON. Ignoring it.`, err);
    return null;
  }
}

/** Called once the payout is committed, so the record can never be replayed. */
export async function clearWinners(gameId: number): Promise<void> {
  try {
    await fsp.unlink(fileFor(Number(gameId)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[winnerStore] Could not remove winner file for game ${gameId}:`, err);
    }
  }
}

/**
 * Startup sweep. Only records for games older than the one now in play can still be around,
 * and keeping them would let a stale file outlive its game. Bounded work: the directory holds
 * at most a couple of files.
 */
export async function pruneWinnerFilesBelow(currentGameId: number): Promise<void> {
  let entries: string[];
  try {
    entries = await fsp.readdir(DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[winnerStore] Could not list the winner directory:', err);
    }
    return;
  }

  for (const name of entries) {
    const match = FILE_PATTERN.exec(name);
    const isStaleTemp = name.endsWith('.tmp');
    if (!match && !isStaleTemp) continue;
    if (match && Number(match[1]) >= Number(currentGameId)) continue;

    try {
      await fsp.unlink(path.join(DIR, name));
      console.log(`[winnerStore] Pruned stale winner file ${name}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[winnerStore] Could not prune ${name}:`, err);
      }
    }
  }
}

/** Resolves once every queued write has settled. */
export function flushWinnerWrites(): Promise<void> {
  return enqueue(async () => undefined);
}

export const winnerRecoveryDir = DIR;
