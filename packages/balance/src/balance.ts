import { format } from 'prettier';
import { phase1Bots } from './bots.js';
import type { Preset } from './jobs.js';
import { renderReport } from './report.js';
import type { RunRecord } from './runner.js';
import { STANDIN_CARDS } from './standin-cards.js';

/** Stand-in data the current report is built on; each line becomes a warning in its header. */
export const STANDIN_WARNINGS: readonly string[] = [
  'Stand-in data: the sim test map and a seeded demand stand-in (`src/env.ts`) replace the District 1 maps (P1-CON-03) and demand generator (P1-CON-04) until they are on main.',
  "Stand-in cards: `src/standin-cards.ts` is generated from content's Phase 1 cards (#14) until the loader is on main.",
];

export const BOT_NAMES: readonly string[] = phase1Bots().map((b) => b.name);

export function roundsOf(preset: Preset): number {
  return preset === 'toy' ? 5 : 12;
}

/** Warnings derived from the records themselves (so a stub sim cannot pass silently). */
export function dataWarnings(records: readonly RunRecord[]): string[] {
  const out: string[] = [];
  if (records.length > 0 && records.every((r) => r.throughputs.every((t) => t === 0)))
    out.push(
      'Every round scored 0 throughput: the sim spawns no vehicles yet (P1-SIM-02), so every run is lost at round 3 and no win rate here means anything about the cards.',
    );
  return out;
}

/** The report for a finished set of runs, with the stand-in and data warnings in its header. */
export function buildReport(
  records: readonly RunRecord[],
  opts: { readonly preset: Preset; readonly seeds: number; readonly commit: string },
): string {
  return renderReport(
    records,
    {
      district: 1,
      rounds: roundsOf(opts.preset),
      seeds: opts.seeds,
      bots: BOT_NAMES,
      commit: opts.commit,
      warnings: [...dataWarnings(records), ...STANDIN_WARNINGS],
    },
    new Map(STANDIN_CARDS.map((c) => [c.id, c.tags])),
  );
}

/**
 * Formats the report with the repo's Prettier settings, so the committed file passes
 * `prettier --check .` as generated. Prettier is deterministic, so the output stays stable.
 */
export async function formatReport(md: string): Promise<string> {
  return format(md, { parser: 'markdown', printWidth: 100, proseWrap: 'preserve' });
}
