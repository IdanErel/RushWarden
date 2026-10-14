/**
 * The usual quota for a round of a run (QA re-check R3, 2026-10-14), for the "busy map" note:
 * the median of the round's quota over every map its pool can pick, computed from content's own
 * exports so it follows any retune. The pool is `setupRoundFrom`'s: a toy Parade picks only maps
 * with a segment it can close and at least `TOY_PARADE_MIN_EDGES` edges. Each round index keeps
 * its own reference, events included (Market Day, Parade, Festival).
 */
import type { RunConfig } from '@rushwarden/app';
import {
  TOY_PARADE_MIN_EDGES,
  districtMaps,
  paradeCandidates,
  roundQuota,
} from '@rushwarden/content';

/** Null unless quotas depend on the map (`templateDemand`, the toy; District 1 only). */
export function quotaReference(config: RunConfig, round: number): number | null {
  if (config.templateDemand !== true || config.district !== 1) return null;
  const curveRound = config.curveRounds?.[round - 1] ?? round;
  const rush = config.rushRounds.find((r) => r.round === round) ?? null;
  const bank = districtMaps(1);
  const pool =
    rush?.boss === 'parade'
      ? bank.filter((m) => paradeCandidates(m).length > 0 && m.edges.length >= TOY_PARADE_MIN_EDGES)
      : bank;
  const quotas = pool
    .map((m) => roundQuota(1, curveRound, rush !== null, config.quotaPermille, m.id))
    .sort((a, b) => a - b);
  return median(quotas);
}

/** The middle value, or the mean of the two middle ones; null for none. */
export function median(xs: readonly number[]): number | null {
  const n = xs.length;
  if (n === 0) return null;
  const hi = xs[n >> 1] ?? 0;
  return n % 2 === 1 ? hi : ((xs[(n >> 1) - 1] ?? 0) + hi) / 2;
}
