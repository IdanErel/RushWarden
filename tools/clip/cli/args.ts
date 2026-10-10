/**
 * Command-line options for `pnpm clip`. Plain TypeScript with erasable types only, so Node runs
 * it directly; no workspace imports (those need a bundler).
 */

export type Format = 'mp4' | 'gif';

/** The subset of the page's `ClipSpec` the CLI builds or reads from `--spec`. */
export interface SpecArg {
  readonly seed: number;
  readonly round?: number;
  readonly plays?: 'greedy' | 'none';
  readonly actions?: readonly unknown[];
}

export interface CliOptions {
  readonly spec: SpecArg;
  /** Timeline overrides; anything unset keeps the page's defaults. */
  readonly timeline: {
    readonly fps?: number;
    readonly speed?: number;
    readonly fromTick?: number;
    readonly toTick?: number;
    readonly leadMs?: number;
    readonly holdMs?: number;
  };
  readonly reducedMotion: boolean;
  readonly scale: number;
  readonly formats: readonly Format[];
  readonly gifWidth: number;
  readonly gifFps: number;
  readonly outDir: string;
  readonly name: string | null;
  readonly keepFrames: boolean;
  readonly specPath: string | null;
  /** Browsers rendering in parallel; null = up to 4, by CPU count. Output does not depend on it. */
  readonly workers: number | null;
}

export const USAGE = `Usage: pnpm clip [options]

Renders one round of a seeded toy run (default: the round 5 Market Day rush round) from its
replay to a 9:16 MP4 (1080x1920) and GIF, plus a .json sidecar that reproduces it.

  --spec <file>        clip spec JSON: { "seed": 4, "round"?: 5, "plays"?: "greedy"|"none",
                       "actions"?: [...] } (e.g. tools/clip/clips/market-day.json)
  --seed <u32>         run seed, instead of --spec
  --round <n>          round to show (default: the run's rush round, 5)
  --plays greedy|none  how the shown round is played when there are no actions (default greedy)
  --fps <n>            video frames per second (default 30)
  --speed <x>          sim speed, 1 = the game's 1x, 2 = hold-for-2x (default 1)
  --from <tick>        first tick shown moving (default 0 = Go)
  --to <tick>          last tick shown (default: end of round)
  --lead <ms>          still frames before Go (default 500)
  --hold <ms>          still frames on the result (default 1500)
  --scale <x>          device pixels per logical pixel of the 432x768 frame (default 2.5)
  --gif-width <px>     GIF width; height follows 9:16 (default 540)
  --gif-fps <n>        GIF frame rate (default 15)
  --formats <list>     mp4,gif (default both)
  --reduced-motion     GDD section 8 reduced motion (no trails, no shake)
  --out <dir>          output directory (default tools/clip/out)
  --name <base>        output file base name (default rushwarden-s<seed>-r<round>[-<plays>])
  --keep-frames        keep the PNG frames next to the outputs
  --workers <n>        browsers rendering in parallel (default: up to 4); output is identical
  -h, --help           this text`;

function num(flag: string, v: string | undefined, int = false): number {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n) || (int && !Number.isInteger(n)))
    throw new Error(`${flag} needs ${int ? 'an integer' : 'a number'}, got ${v ?? 'nothing'}`);
  return n;
}

/**
 * Reads a clip spec. A sidecar written by a previous render is accepted too: its recorded
 * `actions` pin the replay, so it re-renders the same round even if the director changes.
 */
export function parseSpec(json: unknown, source: string): SpecArg {
  if (typeof json !== 'object' || json === null) throw new Error(`${source}: not a JSON object`);
  let o = json as Record<string, unknown>;
  if (o['tool'] === 'rushwarden-clip') {
    const spec = o['spec'];
    if (typeof spec !== 'object' || spec === null)
      throw new Error(`${source}: sidecar has no spec`);
    o = { ...(spec as Record<string, unknown>), actions: o['actions'] };
  }
  const seed = o['seed'];
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error(`${source}: "seed" must be a uint32`);
  const round = o['round'];
  if (round !== undefined && (typeof round !== 'number' || !Number.isInteger(round)))
    throw new Error(`${source}: "round" must be an integer`);
  const plays = o['plays'];
  if (plays !== undefined && plays !== 'greedy' && plays !== 'none')
    throw new Error(`${source}: "plays" must be "greedy" or "none"`);
  const actions = o['actions'];
  if (actions !== undefined && !Array.isArray(actions))
    throw new Error(`${source}: "actions" must be an array`);
  return {
    seed,
    ...(round !== undefined ? { round } : {}),
    ...(plays !== undefined ? { plays } : {}),
    ...(actions !== undefined ? { actions } : {}),
  };
}

/**
 * Parses argv (without node and the script). `readJson` loads `--spec`; returns null for
 * `--help`.
 */
export function parseArgs(
  argv: readonly string[],
  readJson: (path: string) => unknown,
): CliOptions | null {
  let spec: SpecArg | null = null;
  let specPath: string | null = null;
  let seed: number | null = null;
  let round: number | undefined;
  let plays: 'greedy' | 'none' | undefined;
  const timeline: Record<string, number> = {};
  let reducedMotion = false;
  let scale = 2.5;
  let formats: Format[] = ['mp4', 'gif'];
  let gifWidth = 540;
  let gifFps = 15;
  let outDir = 'out';
  let name: string | null = null;
  let keepFrames = false;
  let workers: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const next = (): string | undefined => argv[++i];
    switch (a) {
      case '-h':
      case '--help':
        return null;
      case '--spec':
        specPath = next() ?? '';
        spec = parseSpec(readJson(specPath), specPath);
        break;
      case '--seed':
        seed = num(a, next(), true);
        if (seed < 0 || seed > 0xffffffff) throw new Error('--seed must be a uint32');
        break;
      case '--round':
        round = num(a, next(), true);
        break;
      case '--plays': {
        const p = next();
        if (p !== 'greedy' && p !== 'none') throw new Error('--plays must be greedy or none');
        plays = p;
        break;
      }
      case '--fps':
        timeline['fps'] = num(a, next(), true);
        break;
      case '--speed':
        timeline['speed'] = num(a, next());
        break;
      case '--from':
        timeline['fromTick'] = num(a, next(), true);
        break;
      case '--to':
        timeline['toTick'] = num(a, next(), true);
        break;
      case '--lead':
        timeline['leadMs'] = num(a, next());
        break;
      case '--hold':
        timeline['holdMs'] = num(a, next());
        break;
      case '--scale':
        scale = num(a, next());
        if (!(scale > 0 && scale <= 5)) throw new Error('--scale must be in (0, 5]');
        break;
      case '--gif-width':
        gifWidth = num(a, next(), true);
        if (gifWidth < 90 || gifWidth % 2 !== 0) throw new Error('--gif-width must be even, >= 90');
        break;
      case '--gif-fps':
        gifFps = num(a, next(), true);
        break;
      case '--formats': {
        const list = (next() ?? '').split(',').filter(Boolean);
        if (list.length === 0 || list.some((f) => f !== 'mp4' && f !== 'gif'))
          throw new Error('--formats takes mp4, gif or mp4,gif');
        formats = list as Format[];
        break;
      }
      case '--reduced-motion':
        reducedMotion = true;
        break;
      case '--out':
        outDir = next() ?? '';
        break;
      case '--name':
        name = next() ?? '';
        if (!/^[\w.-]+$/.test(name)) throw new Error('--name may use letters, digits, . _ - only');
        break;
      case '--keep-frames':
        keepFrames = true;
        break;
      case '--workers':
        workers = num(a, next(), true);
        if (workers < 1 || workers > 16) throw new Error('--workers must be 1..16');
        break;
      default:
        throw new Error(`unknown option ${a}\n\n${USAGE}`);
    }
  }
  if (spec && seed !== null) throw new Error('use --spec or --seed, not both');
  if (!spec) {
    if (seed === null) throw new Error(`--spec or --seed is required\n\n${USAGE}`);
    spec = { seed };
  }
  spec = {
    ...spec,
    ...(round !== undefined ? { round } : {}),
    ...(plays !== undefined ? { plays } : {}),
  };
  return {
    spec,
    timeline,
    reducedMotion,
    scale,
    formats,
    gifWidth,
    gifFps,
    outDir,
    name,
    keepFrames,
    specPath,
    workers,
  };
}

/** The flags that re-render the same clip from its sidecar (`<name>.json`). */
export function reproduceArgs(opts: CliOptions, sidecar: string): string[] {
  const t = opts.timeline;
  const out = ['--spec', sidecar];
  const add = (flag: string, v: number | undefined): void => {
    if (v !== undefined) out.push(flag, String(v));
  };
  add('--fps', t.fps);
  add('--speed', t.speed);
  add('--from', t.fromTick);
  add('--to', t.toTick);
  add('--lead', t.leadMs);
  add('--hold', t.holdMs);
  out.push('--scale', String(opts.scale), '--gif-width', String(opts.gifWidth));
  out.push('--gif-fps', String(opts.gifFps), '--formats', opts.formats.join(','));
  if (opts.reducedMotion) out.push('--reduced-motion');
  return out;
}

/** Default base name: `rushwarden-s4-r5`, with `-none` for an unplayed round. */
export function baseName(spec: SpecArg, round: number): string {
  const suffix = spec.plays === 'none' && !spec.actions ? '-none' : '';
  return `rushwarden-s${spec.seed}-r${round}${suffix}`;
}
