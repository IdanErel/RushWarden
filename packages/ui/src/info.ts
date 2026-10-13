/**
 * The information layer (playtest 2026-10-13, "put hidden rules on screen"): small pure helpers
 * for the busy-map note, the run-end table's words and the one-time first-round tip.
 */
import { t } from './i18n.js';
import type { MissReason, RoundMark, RoundOutcome, UiCard } from './run/port.js';

/** A quota this many times round 1's or more gets the "busy map" note. */
export const BUSY_FACTOR = 1.5;

/**
 * How many times round 1's quota this round's is, rounded to one decimal, when it is at least
 * `BUSY_FACTOR`; otherwise null. Quotas follow the round's traffic (ADR-032), so a high one means
 * a busier map, not a stricter rule. Round 1 itself never gets the note.
 */
export function busyFactor(quota: number, results: readonly RoundOutcome[]): number | null {
  const first = results[0]?.quota;
  if (!first || first <= 0) return null;
  const x = quota / first;
  return x >= BUSY_FACTOR ? Math.round(x * 10) / 10 : null;
}

/** The run-end table's word for a round's §5 mark. */
export function markLabel(mark: RoundMark): string {
  return t(`mark.${mark}`);
}

const TIP_KEY = 'rushwarden.tip.rules';

/** Whether the first-round tip was dismissed on this device. Storage can throw or be empty. */
export function readTipSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(TIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTipSeen(): void {
  try {
    globalThis.localStorage?.setItem(TIP_KEY, '1');
  } catch {
    // Private mode or blocked storage: the tip shows again next time.
  }
}

/** Why a map tap placed nothing (U5), from `RunPort.missReason`. */
export function missNote(
  card: UiCard | undefined,
  hasTargets: boolean,
  reason: MissReason | null,
): string {
  if (!card) return t('place.miss.noCard');
  if (!hasTargets) return t('place.miss.noTargets', { name: card.name });
  return t(reason ? `place.miss.${reason}` : 'place.miss', { name: card.name });
}
