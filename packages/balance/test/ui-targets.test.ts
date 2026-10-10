import { describe, expect, it } from 'vitest';
import { districtMaps } from '@rushwarden/content';
import type { GridMap, Target } from '@rushwarden/sim';
import { candidateTargets, directedRuns } from '../src/targets.js';

/**
 * The run screen's own functions, loaded at run time: a static import would make this package's
 * Node-only typecheck compile the UI's DOM and JSX sources. The shape is checked by the UI's tests.
 */
interface UiTargets {
  candidateTargets(kind: 'segment', map: GridMap): unknown[];
  toSimTarget(mark: unknown, map: GridMap): Target;
}
const UI_PACKAGE: string = '@rushwarden/ui';
const { candidateTargets: uiCandidates, toSimTarget } = (await import(UI_PACKAGE)) as UiTargets;

const key = (t: unknown): string => JSON.stringify(t);

describe('bot targets match the run screen (ADR-031)', () => {
  const maps = districtMaps(1);

  it('has District 1 maps to check', () => {
    expect(maps.length).toBeGreaterThan(0);
  });

  it('segment targets equal what a tap on the run screen places, on every District 1 map', () => {
    for (const map of maps) {
      const ui = [
        ...new Set(uiCandidates('segment', map).map((m) => key(toSimTarget(m, map)))),
      ].sort();
      const bots = candidateTargets(map).segment.map(key).sort();
      expect(bots).toEqual(ui);
    }
  });

  it('One-Way targets are those runs (from != to), in both directions', () => {
    for (const map of maps) {
      const runs = candidateTargets(map).segment.filter(
        (t) => t.kind === 'segment' && (t.from.x !== t.to.x || t.from.y !== t.to.y),
      );
      const both = runs.flatMap((t) =>
        t.kind === 'segment' ? [key(t), key({ kind: 'segment', from: t.to, to: t.from })] : [],
      );
      expect(directedRuns(map).map(key).sort()).toEqual(both.sort());
    }
  });
});
