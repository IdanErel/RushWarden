import { describe, expect, it } from 'vitest';
import { baseName, parseArgs, parseSpec, reproduceArgs } from '../cli/args.ts';
import { chunks } from '../cli/render.ts';

const noFile = (): unknown => {
  throw new Error('no file');
};

describe('clip CLI options', () => {
  it('needs a seed or a spec, and prints help', () => {
    expect(parseArgs(['--help'], noFile)).toBeNull();
    expect(() => parseArgs([], noFile)).toThrow(/--spec or --seed/);
    expect(() => parseArgs(['--spec', 'a', '--seed', '1'], () => ({ seed: 1 }))).toThrow(
      /not both/,
    );
    expect(() => parseArgs(['--bogus'], noFile)).toThrow(/unknown option/);
  });

  it('parses every option', () => {
    const o = parseArgs(
      [
        '--seed',
        '4',
        '--round',
        '3',
        '--plays',
        'none',
        '--fps',
        '24',
        '--speed',
        '2',
        '--from',
        '10',
        '--to',
        '200',
        '--lead',
        '0',
        '--hold',
        '900',
        '--scale',
        '1',
        '--gif-width',
        '360',
        '--gif-fps',
        '12',
        '--formats',
        'gif',
        '--reduced-motion',
        '--out',
        'x',
        '--name',
        'a.b',
        '--keep-frames',
        '--workers',
        '2',
      ],
      noFile,
    );
    expect(o).toMatchObject({
      spec: { seed: 4, round: 3, plays: 'none' },
      timeline: { fps: 24, speed: 2, fromTick: 10, toTick: 200, leadMs: 0, holdMs: 900 },
      scale: 1,
      gifWidth: 360,
      gifFps: 12,
      formats: ['gif'],
      reducedMotion: true,
      outDir: 'x',
      name: 'a.b',
      keepFrames: true,
      workers: 2,
    });
  });

  it('rejects bad values', () => {
    for (const bad of [
      ['--seed', 'x'],
      ['--seed', '-1'],
      ['--plays', 'some'],
      ['--scale', '9'],
      ['--gif-width', '301'],
      ['--formats', 'webm'],
      ['--name', 'a/b'],
      ['--workers', '0'],
    ])
      expect(() =>
        parseArgs([...bad, ...(bad[0] === '--seed' ? [] : ['--seed', '1'])], noFile),
      ).toThrow();
  });

  it('reads specs and sidecars', () => {
    expect(parseSpec({ seed: 4, plays: 'none' }, 's')).toEqual({ seed: 4, plays: 'none' });
    const sidecar = { tool: 'rushwarden-clip', spec: { seed: 4 }, actions: [{ type: 'go' }] };
    expect(parseSpec(sidecar, 's')).toEqual({ seed: 4, actions: [{ type: 'go' }] });
    expect(() => parseSpec(null, 's')).toThrow(/object/);
    expect(() => parseSpec({ seed: 1.5 }, 's')).toThrow(/uint32/);
    expect(() => parseSpec({ seed: 1, round: 'x' }, 's')).toThrow(/round/);
    expect(() => parseSpec({ seed: 1, plays: 'x' }, 's')).toThrow(/plays/);
    expect(() => parseSpec({ seed: 1, actions: 1 }, 's')).toThrow(/actions/);
    expect(() => parseSpec({ tool: 'rushwarden-clip' }, 's')).toThrow(/no spec/);
  });

  it('writes a reproduce line that parses back to the same options', () => {
    const o = parseArgs(['--seed', '4', '--fps', '10', '--from', '5', '--reduced-motion'], noFile);
    if (!o) throw new Error('parse');
    const again = parseArgs(reproduceArgs(o, 'side.json'), () => ({ seed: 4 }));
    expect(again?.timeline).toEqual(o.timeline);
    expect(again?.reducedMotion).toBe(true);
    expect(again?.formats).toEqual(o.formats);
  });

  it('names outputs by seed and round', () => {
    expect(baseName({ seed: 4 }, 5)).toBe('rushwarden-s4-r5');
    expect(baseName({ seed: 4, plays: 'none' }, 5)).toBe('rushwarden-s4-r5-none');
  });

  it('splits frames into contiguous ranges that cover the clip once', () => {
    expect(chunks(10, 3)).toEqual([
      [0, 3],
      [3, 6],
      [6, 10],
    ]);
    expect(chunks(2, 4)).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(chunks(5, 1)).toEqual([[0, 5]]);
  });
});
