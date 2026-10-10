import { idiv } from '@rushwarden/sim';

/** GDD §2 base quota per district. */
export const BASE_QUOTA = [26, 34, 42] as const;
/** GDD §2: rush rounds multiply demand and quota by 1.6. */
export const RUSH_PERMILLE = 1600;

/**
 * `quota = base[d] * (1 + 0.11*(r-1)) * rushMult` (GDD §2) in integers: per-mille factors,
 * rounded half up (ADR-018). `quotaPermille` is the mayor's modifier (1000 = none).
 */
export function quotaFor(
  district: 1 | 2 | 3,
  round: number,
  rush: boolean,
  quotaPermille = 1000,
): number {
  const base = BASE_QUOTA[district - 1] ?? BASE_QUOTA[0];
  const num = base * (1000 + 110 * (round - 1)) * (rush ? RUSH_PERMILLE : 1000) * quotaPermille;
  const den = 1_000_000_000;
  return idiv(num + idiv(den, 2), den);
}

/**
 * Funds for a round (GDD §2): +4 for a pass, plus +1 per full 10% over quota (bonus capped at
 * +6, ADR-018), plus funds earned by in-round effects (Toll Booth).
 */
export function fundsFor(
  throughput: number,
  quota: number,
  pass: boolean,
  effectFunds: number,
): number {
  if (!pass) return effectFunds;
  const over = quota > 0 ? idiv((throughput - quota) * 10, quota) : 0;
  return 4 + Math.min(6, Math.max(0, over)) + effectFunds;
}
