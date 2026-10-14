import { toyRunConfig } from '@rushwarden/app';
import { describe, expect, it } from 'vitest';
import { DEV_CARDS } from '../dev/cards.js';
import { median, quotaReference } from '../src/run/quota-ref.js';

describe('quotaReference (QA re-check R3)', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([])).toBeNull();
    expect(median([3])).toBe(3);
    expect(median([1, 2, 9])).toBe(2);
    expect(median([1, 2, 4, 9])).toBe(3);
  });

  it('gives each toy round the median quota over the maps it can pick', () => {
    const cfg = toyRunConfig({ seed: 1, cards: DEV_CARDS });
    const refs = [1, 2, 3, 4, 5].map((r) => quotaReference(cfg, r));
    // On main ed4f8a7 these are content's map-bank medians, 194, 151, 181, 181 and 200. They
    // follow content's tuning, so this pins only the shape: one per round, the Parade lowest.
    for (const ref of refs) expect(ref).toBeGreaterThan(0);
    expect(Math.min(...refs.map((r) => r ?? 0))).toBe(refs[1]);
  });

  it('has no reference when quotas do not depend on the map', () => {
    const cfg = toyRunConfig({ seed: 1, cards: DEV_CARDS });
    expect(quotaReference({ ...cfg, templateDemand: false }, 1)).toBeNull();
  });
});
