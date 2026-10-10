import { readdirSync, readFileSync } from 'node:fs';
import { buildWorld, GRID_WIDTH, type GridMap } from '@rushwarden/sim';
import { describe, expect, it } from 'vitest';
import {
  DISTRICT_MAP_RULES,
  districtMaps,
  loadMapTemplates,
  MAP_FILES,
  type MapFile,
  pickMap,
  rowsToGridMap,
  templateVariants,
  transformRows,
  validateMapTemplates,
} from '../src/index.js';

const DIR = new URL('../maps/', import.meta.url);
const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.json'));

function messages(files: readonly MapFile[]): string[] {
  return validateMapTemplates(files).errors.map((e) => `${e.source}: ${e.path}: ${e.message}`);
}

/** A valid District 1 template (d1-02 High Street) to mutate. */
function template(rows?: string[]): Record<string, unknown> {
  return {
    id: 'd1-99',
    district: 1,
    name: 'Test',
    rows: rows ?? [
      '...#...',
      '####...',
      '...B...',
      '...####',
      '...#...',
      '####...',
      '...B...',
      '...####',
      '...#...',
    ],
  };
}

describe('bundled District 1 map templates (P1-CON-03)', () => {
  it('MAP_FILES lists exactly the JSON files in packages/content/maps/, with their data', () => {
    expect(MAP_FILES.map((f) => f.source).sort()).toEqual([...onDisk].sort());
    for (const { source, data } of MAP_FILES) {
      expect(data, source).toEqual(JSON.parse(readFileSync(new URL(source, DIR), 'utf8')));
    }
  });

  it('every template and variant passes buildWorld and the District 1 rules', () => {
    expect(messages(MAP_FILES)).toEqual([]);
  });

  it('has 12 District 1 templates (GDD §3)', () => {
    expect(loadMapTemplates().filter((t) => t.district === 1)).toHaveLength(12);
  });

  // GDD §3: "District 1 maps have 4–6 intersections"; §5: "1 lane each way, 2 bus stops".
  // Checked here again, independently of the validator, on every variant.
  const maps = districtMaps(1);
  it.each(maps.map((m) => [m.id, m] as const))(
    '%s: 4–6 intersections, 1 lane, 2 stops, all edges reachable',
    (_id, map: GridMap) => {
      const world = buildWorld(map);
      expect(world.intersections.length).toBeGreaterThanOrEqual(4);
      expect(world.intersections.length).toBeLessThanOrEqual(6);
      const roads = map.tiles.filter((t) => t.kind === 'road');
      expect(roads.every((t) => t.lanes === 1)).toBe(true);
      expect(roads.filter((t) => t.busStop === true)).toHaveLength(2);
      expect(world.edges.length).toBeGreaterThanOrEqual(DISTRICT_MAP_RULES[1].minEdges);
    },
  );

  it('expands templates into mirrored and rotated variants with unique ids', () => {
    const ids = maps.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('d1-02-mx');
    expect(maps).toHaveLength(38);
  });

  it('spans the whole intersection range', () => {
    const counts = new Set(maps.map((m) => buildWorld(m).intersections.length));
    expect([...counts].sort()).toEqual([4, 5, 6]);
  });
});

describe('templates and variants', () => {
  it('mirrors and rotates rows', () => {
    const rows = ['ab', 'cd'];
    expect(transformRows(rows, '')).toEqual(['ab', 'cd']);
    expect(transformRows(rows, 'mx')).toEqual(['ba', 'dc']);
    expect(transformRows(rows, 'my')).toEqual(['cd', 'ab']);
    expect(transformRows(rows, 'r180')).toEqual(['dc', 'ba']);
  });

  it('drops repeated variants of a symmetric template', () => {
    const symmetric = {
      id: 'd1-98',
      district: 1 as const,
      name: 'Sym',
      rows: [
        '..#.#..',
        '..#.#..',
        '#######',
        '..#.#..',
        '..###..',
        '..#.#..',
        '#######',
        '..#.#..',
        '..#.#..',
      ],
    };
    expect(templateVariants(symmetric).map((m) => m.id)).toEqual(['d1-98']);
  });

  it('infers edges at dead ends, in row-major order, facing away from the road', () => {
    const map = rowsToGridMap('t', template()['rows'] as string[]);
    expect(map.edges).toEqual([
      { id: 0, tile: { x: 3, y: 0 }, side: 'n' },
      { id: 1, tile: { x: 0, y: 1 }, side: 'w' },
      { id: 2, tile: { x: 6, y: 3 }, side: 'e' },
      { id: 3, tile: { x: 0, y: 5 }, side: 'w' },
      { id: 4, tile: { x: 6, y: 7 }, side: 'e' },
      { id: 5, tile: { x: 3, y: 8 }, side: 's' },
    ]);
    const stop = map.tiles[2 * GRID_WIDTH + 3];
    expect(stop).toEqual({ kind: 'road', lanes: 1, busStop: true });
  });

  it('picks a map deterministically from the seed', () => {
    expect(pickMap(maps(), 42)).toEqual(pickMap(maps(), 42));
    const picked = new Set(Array.from({ length: 200 }, (_, s) => pickMap(maps(), s).id));
    expect(picked.size).toBeGreaterThan(maps().length / 2);
    expect(() => pickMap([], 1)).toThrow(/no maps/);
  });
});

function maps(): readonly GridMap[] {
  return districtMaps(1);
}

describe('validateMapTemplates errors', () => {
  const f = (data: unknown, source = 'd1-99.json'): MapFile[] => [{ source, data }];
  const cases: [string, Record<string, unknown>, string][] = [
    ['bad row width', { rows: ['...'] }, 'rows: must have at least 9 items'],
    [
      'bad char',
      { ...template(), name: 'x', rows: Array(9).fill('...X...') },
      'rows/0: must match',
    ],
  ];
  it.each(cases)('rejects %s', (_l, patch, expected) => {
    const errs = messages(f({ ...template(), ...patch }));
    expect(
      errs.some((e) => e.includes(expected)),
      errs.join('\n'),
    ).toBe(true);
  });

  it('rejects a wrong file name and a district prefix mismatch', () => {
    expect(messages(f(template(), 'other.json'))).toContain(
      'other.json: id: file must be named d1-99.json',
    );
    expect(messages(f({ ...template(), district: 2 }))).toContain(
      'd1-99.json: id: id must start with d2-',
    );
  });

  it('rejects a dead end that does not leave the map', () => {
    const rows = Array<string>(9).fill('...#...');
    rows[4] = '...##..';
    expect(messages(f(template(rows))).join('\n')).toMatch(/dead end at \(4,4\)/);
  });

  it('reports sim topology errors from buildWorld', () => {
    const rows = [
      '...#...',
      '...#...',
      '...#...',
      '..###..',
      '..#.#..',
      '..###..',
      '...#...',
      '...#...',
      '...#...',
    ];
    // (3,3) and (3,5) are T-junctions with a loop; fine for the sim, but 2 intersections and no stops.
    const errs = messages(f(template(rows))).join('\n');
    expect(errs).toMatch(/has 2 intersections, district needs 4–6/);
    expect(errs).toMatch(/has 0 bus stops, district needs 2/);
    const adjacent = [
      '...#...',
      '...#...',
      '#######',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
    ];
    // Fewer than 4 intersections is reported; a cross with stubs on all sides is valid topology.
    expect(messages(f(template(adjacent))).join('\n')).toMatch(/intersections/);
    const adjacentIx = [
      '..#....',
      '..#....',
      '#######',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
    ];
    expect(messages(f(template(adjacentIx))).join('\n')).toMatch(/are adjacent/);
  });

  it('rejects bus stops on intersections or edge tiles, and too few edges', () => {
    const rows = template()['rows'] as string[];
    const onIx = [...rows];
    onIx[1] = '###B...';
    onIx[2] = '...#...';
    expect(messages(f(template(onIx))).join('\n')).toMatch(/bus stop on intersection/);
    const onEdge = [...rows];
    onEdge[0] = '...B...';
    onEdge[2] = '...#...';
    expect(messages(f(template(onEdge))).join('\n')).toMatch(/bus stop on edge tile/);
  });

  it('rejects a template that is a variant of another, and duplicate ids', () => {
    const a = template();
    const b = { ...template(transformRows(a['rows'] as string[], 'mx')), id: 'd1-98' };
    expect(messages([...f(a), ...f(b, 'd1-98.json')])).toContain(
      'd1-98.json: rows: same layout as d1-99 (variant "mx")',
    );
    expect(messages([...f(a), ...f(a)])).toContain('d1-99.json: id: duplicate id d1-99');
  });
});
