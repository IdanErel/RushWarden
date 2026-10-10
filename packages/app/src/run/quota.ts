import { idiv } from '@rushwarden/sim';

// The quota formula has one source: content's `roundQuota` (Lead decision; ADR-018 point 4).
// The controller calls it with the mayor's `quotaPermille`.

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
