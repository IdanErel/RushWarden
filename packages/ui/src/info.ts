/**
 * The information layer (playtest 2026-10-13, "put hidden rules on screen"): small pure helpers
 * for the busy-map note, the run-end table's words and the one-time first-round tip.
 */
import { t } from './i18n.js';
import type { MissReason, RoundMark, UiCard } from './run/port.js';

/** A quota this many times its round's usual one (`RunState.quotaRef`) or more is a busy map. */
export const BUSY_FACTOR = 1.3;

/**
 * How many times its round's usual quota `ref` this quota is, rounded to one decimal, when it is
 * at least `BUSY_FACTOR`; otherwise null, and null with no reference. Quotas follow the round's
 * traffic (ADR-032), so a high one means a busier map, not a stricter rule (QA re-check R3).
 */
export function busyFactor(quota: number, ref: number | null): number | null {
  if (ref === null || ref <= 0) return null;
  const x = quota / ref;
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
