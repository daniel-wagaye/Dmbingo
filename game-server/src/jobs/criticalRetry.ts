import { config } from '../config';

const FALLBACK_STEPS_MS = [5000, 10000, 20000, 30000];

/**
 * Escalating wait between whole attempts of a persistent game-critical loop.
 * `attemptIndex` is 0-based: the first retry uses the first step, then they cap.
 */
export function delayForAttempt(attemptIndex: number): number {
  const steps =
    config.criticalRetryStepsMs.length > 0 ? config.criticalRetryStepsMs : FALLBACK_STEPS_MS;
  const i = Math.max(0, Math.min(attemptIndex, steps.length - 1));
  return steps[i];
}

export type FinalizeDecision = 'proceed' | 'retry' | 'already_finalized';

/**
 * How to treat a finalize_game response.
 *
 * `success: true`          → credit happened, advance to winner reveal.
 * `INVALID_PHASE`          → the row is no longer `started`. If it already moved on, treating
 *                            that as failure and calling create_next_game would skip a payout
 *                            that already landed; if it is still `started`, keep retrying.
 * any other failure/throw  → keep retrying. Never advance.
 */
export function classifyFinalizeResult(
  result: any,
  latest: { game_id?: number; phase?: string } | null,
  expectedGameId: number
): FinalizeDecision {
  if (result?.success === true) return 'proceed';

  const phase = result?.phase ?? latest?.phase;
  const reportedId = Number(result?.game_id ?? latest?.game_id);

  if (result?.error === 'INVALID_PHASE') {
    if (phase && phase !== 'started') return 'already_finalized';
    if (
      expectedGameId > 0 &&
      Number.isFinite(reportedId) &&
      reportedId > 0 &&
      reportedId !== expectedGameId
    ) {
      return 'already_finalized';
    }
    return 'retry';
  }

  return 'retry';
}

export function classifyCreateNextResult(nextGame: any): 'proceed' | 'retry' {
  if (!nextGame || typeof nextGame !== 'object') return 'retry';
  if (nextGame.success === false) return 'retry';
  if (nextGame.phase || nextGame.game_id) return 'proceed';
  return 'retry';
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
