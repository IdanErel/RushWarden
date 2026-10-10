import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOLDEN_ROUNDS, runGolden } from '../src/rounds.js';

const fixture = new URL('../fixtures/hashes.json', import.meta.url);

describe('golden determinism (Node)', () => {
  // `pnpm update` regenerates the fixture. Sim Engineer only, in a PR that explains why every
  // hash changed; the Reviewer checks the change is intended.
  if (process.env['UPDATE_GOLDEN'] === '1') {
    it('regenerates fixtures/hashes.json', () => {
      writeFileSync(fixture, JSON.stringify(runGolden(), null, 2) + '\n');
    });
    return;
  }

  it(`${GOLDEN_ROUNDS} seeded rounds match fixtures/hashes.json`, () => {
    expect(existsSync(fixture), 'fixture missing; run pnpm golden:update').toBe(true);
    const expected = JSON.parse(readFileSync(fixture, 'utf8')) as string[];
    expect(expected).toHaveLength(GOLDEN_ROUNDS);
    expect(runGolden()).toEqual(expected);
  });
});
