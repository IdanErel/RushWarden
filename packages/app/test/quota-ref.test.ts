import { describe, expect, it } from 'vitest';
import { fullRunConfig, median, quotaReference, startRun, toyRunConfig } from '../src/index.js';
import { CARDS, fakeEnv } from './run-fixtures.js';

describe('quotaReference (QA re-check R3)', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([])).toBeNull();
    expect(median([3])).toBe(3);
    expect(median([1, 2, 9])).toBe(2);
    expect(median([1, 2, 4, 9])).toBe(3);
    expect(median([1, 2, 5, 9])).toBe(3);
  });

  it('gives each toy round the median quota over the maps it can pick', () => {
    const cfg = toyRunConfig({ seed: 1, cards: CARDS });
    const refs = [1, 2, 3, 4, 5].map((r) => quotaReference(cfg, r));
    // On main ed4f8a7 these are content's map-bank medians, 194, 151, 181, 181 and 200. They
    // follow content's tuning, so this pins only the shape: one per round, the Parade lowest.
    for (const ref of refs) expect(ref).toBeGreaterThan(0);
    expect(Math.min(...refs.map((r) => r ?? 0))).toBe(refs[1]);
  });

  it('has no reference when quotas do not depend on the map', () => {
    const cfg = toyRunConfig({ seed: 1, cards: CARDS });
    expect(quotaReference({ ...cfg, templateDemand: false }, 1)).toBeNull();
  });

  it('is filled in at round start: the toy has one, a full run none', () => {
    const cfg = toyRunConfig({ seed: 9, cards: CARDS });
    const toy = startRun(cfg, fakeEnv()).state;
    expect(toy.quotaRef).toBe(quotaReference(cfg, 1));
    expect(toy.quotaRef).toBeGreaterThan(0);
    expect(startRun(fullRunConfig({ seed: 9, cards: CARDS }), fakeEnv()).state.quotaRef).toBeNull();
  });
});
