import { format } from 'prettier';
import { phase1Bots } from './bots.js';
import type { Preset } from './jobs.js';
import { renderReport } from './report.js';
import type { RunRecord } from './runner.js';
import { CARDS } from './data.js';

/** Known caveats about the data the report is built on; each line becomes a warning in its header. */
export const TUNING_WARNINGS: readonly string[] = [
  'Pre-tuning content: quotas, demand and score values are the first-pass numbers from #28 and are being tuned in CON-05. Win rates near 100% mean the quotas are too low for the delivered throughput, not that the archetypes are balanced; do not judge gate criterion 2 from this report.',
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

/** The report for a finished set of runs, with the tuning and data warnings in its header. */
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
      warnings: [...dataWarnings(records), ...TUNING_WARNINGS],
    },
    new Map(CARDS.map((c) => [c.id, c.tags])),
  );
}

/**
 * Formats the report with the repo's Prettier settings, so the committed file passes
 * `prettier --check .` as generated. Prettier is deterministic, so the output stays stable.
 */
export async function formatReport(md: string): Promise<string> {
  return format(md, { parser: 'markdown', printWidth: 100, proseWrap: 'preserve' });
}
