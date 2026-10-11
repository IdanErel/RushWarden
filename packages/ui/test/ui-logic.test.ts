import { describe, expect, it } from 'vitest';
import { SNAPSHOT_HEADER } from '@rushwarden/sim';
import { stateAttributes } from '../src/hooks.js';
import { format, setLanguage, t } from '../src/i18n.js';
import { keyAction } from '../src/keys.js';
import { ExitCounter } from '../src/live.js';
import { devRun } from './helpers.js';
import { copyText, shareLine, shareText } from '../src/share.js';
import { TAG_COLOR, css } from '../src/tags.js';

describe('i18n', () => {
  it('fills placeholders and ICU plurals', () => {
    expect(t('hud.round', { round: 2, rounds: 5 })).toBe('Round 2/5');
    expect(t('place.plays', { n: 1 })).toBe('1 play left');
    expect(t('place.plays', { n: 2 })).toBe('2 plays left');
    expect(format('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    setLanguage('xx'); // unknown: stays English
    expect(t('go')).toBe('Go');
  });
});

describe('share line (GDD §5)', () => {
  it('is legible plain text with one glyph per round', () => {
    expect(shareLine('Old Town', ['pass', 'near', 'fail', 'gridlock'], 412)).toBe(
      'Rushwarden · Old Town · 🟩🟨🟥⬛ · 412 through',
    );
    expect(shareLine('Old Town', [], 0, 'https://x')).toBe(
      'Rushwarden · Old Town ·  · 0 through\nhttps://x',
    );
  });

  it('uses Web Share, falls back to the clipboard', async () => {
    const written: string[] = [];
    const clipboard = { writeText: async (s: string) => void written.push(s) } as Clipboard;
    expect(await shareText('a', { share: async () => {}, clipboard })).toBe('share');
    expect(
      await shareText('b', {
        share: async () => {
          throw new Error('cancelled');
        },
        clipboard,
      }),
    ).toBe('clipboard');
    expect(written).toEqual(['b']);
    expect(await shareText('c', {} as Navigator)).toBeNull();
    const broken = {
      writeText: async () => {
        throw new Error('denied');
      },
    } as unknown as Clipboard;
    expect(await shareText('d', { clipboard: broken } as Navigator)).toBeNull();
    expect(await copyText('e', { clipboard })).toBe(true);
    expect(await copyText('f', { clipboard: broken })).toBe(false);
    expect(await copyText('g', {} as Navigator)).toBe(false);
  });
});

describe('keyboard map (GDD §8)', () => {
  it('place: 1–5, arrows, Enter, Space, Esc', () => {
    expect(keyAction('place', '3')).toEqual({ type: 'select', index: 2 });
    expect(keyAction('place', 'ArrowLeft')).toEqual({ type: 'cursor', dir: 'w' });
    expect(keyAction('place', 'Enter')).toEqual({ type: 'confirm' });
    expect(keyAction('place', ' ')).toEqual({ type: 'go' });
    expect(keyAction('place', 'Escape')).toEqual({ type: 'undo' });
    expect(keyAction('place', 'r')).toEqual({ type: 'flip' });
    expect(keyAction('place', 'm')).toEqual({ type: 'mute' });
    expect(keyAction('go', 'M')).toEqual({ type: 'mute' });
    expect(keyAction('end', 'm')).toEqual({ type: 'mute' });
    expect(keyAction('go', 'r')).toBeNull();
    expect(keyAction('place', 'x')).toBeNull();
  });

  it('go: Esc pauses; result: pick, skip; end: Enter retries; overlays: Esc closes', () => {
    expect(keyAction('go', 'Escape')).toEqual({ type: 'pause' });
    expect(keyAction('go', '1')).toBeNull();
    expect(keyAction('result', '2')).toEqual({ type: 'select', index: 1 });
    expect(keyAction('result', '5')).toBeNull();
    expect(keyAction('result', 'ArrowRight')).toEqual({ type: 'cursor', dir: 'e' });
    expect(keyAction('result', 'ArrowUp')).toBeNull();
    expect(keyAction('result', 'Enter')).toEqual({ type: 'confirm' });
    expect(keyAction('result', 'Escape')).toEqual({ type: 'skip' });
    expect(keyAction('end', 'Enter')).toEqual({ type: 'confirm' });
    expect(keyAction('end', 'Escape')).toBeNull();
    expect(keyAction('place', 'Escape', true)).toEqual({ type: 'pause' });
    expect(keyAction('place', '1', true)).toBeNull();
  });
});

describe('live throughput', () => {
  const snap = (rows: number[][]): Uint16Array => {
    const a = new Uint16Array(SNAPSHOT_HEADER + rows.length * 5);
    a[1] = rows.length;
    rows.forEach((r, i) => a.set(r, SNAPSHOT_HEADER + i * 5));
    return a;
  };

  it('adds the §3 score of each vehicle that leaves', () => {
    const c = new ExitCounter();
    c.push(
      snap([
        [1, 0, 0, 1, 0],
        [2, 0, 1, 1, 2],
      ]),
    );
    expect(c.push(snap([[1, 0, 1, 1, 0]]))).toBe(3); // the bus left
    expect(c.exits).toEqual([3]);
    expect(c.push(snap([]))).toBe(4);
    expect(c.exits).toEqual([1]);
    expect(c.push(snap([]))).toBe(4);
    expect(c.exits).toEqual([]);
    c.reset();
    expect(c.total).toBe(0);
    expect(c.exits).toEqual([]);
  });
});

describe('test hooks H2/H5', () => {
  it('exposes run state and target rects as data attributes', () => {
    const run = devRun(1);
    const a = stateAttributes(run.state(), {
      speed: 2,
      paused: false,
      throughput: 7,
      targetRects: [{ key: 'district', x: 1.4, y: 2.6, w: 10, h: 10 }],
      selected: 1,
      cursor: null,
    });
    expect(a).toMatchObject({
      'data-phase': 'place',
      'data-round': '1',
      'data-approval': '3',
      'data-energy': '3',
      'data-throughput': '7',
      'data-quota': String(run.state().quota),
      'data-speed': '2',
      'data-paused': 'false',
      'data-round-hash': '',
      'data-selected': '1',
      'data-cursor': '',
      'data-won': '',
      'data-audio': 'none',
      'data-muted': 'true',
      'data-reduced-motion': 'false',
    });
    expect(a['data-hand']!.split(',')).toHaveLength(5);
    expect(a['data-placed-segments']).toBe('');
    expect(JSON.parse(a['data-target-rects']!)).toEqual([
      { key: 'district', x: 1, y: 3, w: 10, h: 10 },
    ]);
    expect(a['data-live']).toBe('');
    const live = stateAttributes(run.state(), {
      speed: 1,
      paused: false,
      throughput: 0,
      targetRects: [],
      selected: null,
      cursor: null,
      live: [
        { x: 3, y: 4, kind: 'signal', green: ['n', 's'], box: 2 },
        { x: 5, y: 4, kind: 'roundabout', green: [], box: 0 },
      ],
    });
    expect(live['data-live']).toBe('3,4:signal:ns:2 5,4:roundabout::0');
  });
});

describe('H2 placed segments', () => {
  it('gives each placed segment card the way the sim gets it, and blanks for other targets', () => {
    const s = devRun(1).state();
    const card = s.hand[0]!;
    const a = stateAttributes(
      {
        ...s,
        placed: [
          {
            card,
            target: { kind: 'segment', x: 3, y: 1, reverse: true },
            segment: { from: { x: 3, y: 3 }, to: { x: 3, y: 0 } },
          },
          { card, target: { kind: 'district' } },
        ],
      },
      { speed: 1, paused: false, throughput: 0, targetRects: [], selected: null, cursor: null },
    );
    expect(a['data-placed-segments']).toBe('3,3>3,0;');
  });
});

describe('tags', () => {
  it('formats tag colours as CSS', () => {
    expect(css(TAG_COLOR.FLOW)).toBe('#1f7f75');
    expect(css(0xff)).toBe('#0000ff');
  });
});
