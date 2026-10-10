/**
 * Map templates (GDD §3 "Map generation"): a bank of hand-drawn templates per district, each
 * expanded into mirrored and rotated variants, validated with the sim's own `buildWorld` plus the
 * district's traits from GDD §5.
 *
 * Only the symmetries of the 7×9 rectangle are variants: identity, mirror left-right, mirror
 * top-bottom and the 180° rotation. A 90° turn would make the grid 9×7 (ADR-015).
 */
import {
  buildWorld,
  createPrng,
  GRID_HEIGHT,
  GRID_WIDTH,
  nextInt,
  route,
  type GridMap,
  type MapEdge,
  type MapTile,
  type Side,
} from '@rushwarden/sim';
import { MAP_CHARS, MAP_SCHEMA } from './map-schema.js';
import { type SchemaError, validateSchema } from './json-schema.js';

export type District = 1 | 2 | 3;

export interface MapTemplate {
  readonly id: string;
  readonly district: District;
  readonly name: string;
  /** GRID_HEIGHT rows of GRID_WIDTH characters, top row first. */
  readonly rows: readonly string[];
}

/** District map traits (GDD §3 and §5 district table). */
export interface DistrictMapRules {
  readonly minIntersections: number;
  readonly maxIntersections: number;
  readonly busStops: number;
  /** Fewest edges; demand needs somewhere to come from and go to. */
  readonly minEdges: number;
}

export const DISTRICT_MAP_RULES: { readonly [D in District]: DistrictMapRules } = {
  1: { minIntersections: 4, maxIntersections: 6, busStops: 2, minEdges: 4 },
  2: { minIntersections: 7, maxIntersections: 9, busStops: 4, minEdges: 4 },
  3: { minIntersections: 9, maxIntersections: 12, busStops: 4, minEdges: 4 },
};

/** The variant transforms and their id suffixes. */
export const VARIANTS = ['', 'mx', 'my', 'r180'] as const;
export type Variant = (typeof VARIANTS)[number];

/** The four directions, clockwise from north; `away` is the opposite one's side. */
const DIRS: readonly { readonly dx: number; readonly dy: number; readonly away: Side }[] = [
  { dx: 0, dy: -1, away: 's' },
  { dx: 1, dy: 0, away: 'w' },
  { dx: 0, dy: 1, away: 'n' },
  { dx: -1, dy: 0, away: 'e' },
];

export interface MapError {
  readonly source: string;
  readonly path: string;
  readonly message: string;
}

function charAt(rows: readonly string[], x: number, y: number): string {
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return MAP_CHARS.block;
  return rows[y]?.[x] ?? MAP_CHARS.block;
}

function isRoad(rows: readonly string[], x: number, y: number): boolean {
  return charAt(rows, x, y) !== MAP_CHARS.block;
}

/** Applies a variant transform to template rows. */
export function transformRows(rows: readonly string[], variant: Variant): string[] {
  const flipX = variant === 'mx' || variant === 'r180';
  const flipY = variant === 'my' || variant === 'r180';
  const out = flipY ? [...rows].reverse() : [...rows];
  return flipX ? out.map((r) => [...r].reverse().join('')) : out;
}

/**
 * Converts rows to a `GridMap`. Edges are inferred: a road tile with exactly one road neighbour
 * is a dead end and must lead straight out of the grid; it gets an edge on the side facing away
 * from its neighbour. Edge ids are assigned in row-major tile order. Throws on a dead end that
 * does not reach the boundary.
 */
export function rowsToGridMap(id: string, rows: readonly string[]): GridMap {
  const tiles: MapTile[] = [];
  const edges: MapEdge[] = [];
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const c = charAt(rows, x, y);
      if (c === MAP_CHARS.block) {
        tiles.push({ kind: 'block' });
        continue;
      }
      tiles.push(
        c === MAP_CHARS.busStop
          ? { kind: 'road', lanes: 1, busStop: true }
          : { kind: 'road', lanes: 1 },
      );
      const neighbours = DIRS.filter((d) => isRoad(rows, x + d.dx, y + d.dy));
      const [only] = neighbours;
      if (neighbours.length === 0) throw new RangeError(`isolated road tile (${x},${y})`);
      if (neighbours.length === 1 && only !== undefined) {
        // The edge faces away from the single neighbour and must be on the boundary.
        const ox = x - only.dx;
        const oy = y - only.dy;
        if (ox >= 0 && oy >= 0 && ox < GRID_WIDTH && oy < GRID_HEIGHT) {
          throw new RangeError(`dead end at (${x},${y}) does not lead straight off the map`);
        }
        edges.push({ id: edges.length, tile: { x, y }, side: only.away });
      }
    }
  }
  return { id, tiles, edges };
}

/** The distinct variants of a template as maps, ids `<template>` or `<template>-<variant>`. */
export function templateVariants(template: MapTemplate): GridMap[] {
  const seen = new Set<string>();
  const maps: GridMap[] = [];
  for (const v of VARIANTS) {
    const rows = transformRows(template.rows, v);
    const key = rows.join('/');
    if (seen.has(key)) continue; // symmetric templates repeat some variants
    seen.add(key);
    maps.push(rowsToGridMap(v === '' ? template.id : `${template.id}-${v}`, rows));
  }
  return maps;
}

/** Validates one variant against the sim topology (ADR-012) and the district rules. */
function checkVariant(map: GridMap, rules: DistrictMapRules): string[] {
  const errors: string[] = [];
  let world;
  try {
    world = buildWorld(map);
  } catch (e) {
    return [(e as Error).message];
  }
  const n = world.intersections.length;
  if (n < rules.minIntersections || n > rules.maxIntersections) {
    errors.push(
      `has ${n} intersections, district needs ${rules.minIntersections}–${rules.maxIntersections}`,
    );
  }
  if (world.edges.length < rules.minEdges) {
    errors.push(`has ${world.edges.length} edges, needs at least ${rules.minEdges}`);
  }
  const edgeTiles = new Set(map.edges.map((e) => e.tile.y * GRID_WIDTH + e.tile.x));
  let stops = 0;
  map.tiles.forEach((t, i) => {
    if (t.kind !== 'road' || t.busStop !== true) return;
    stops++;
    const where = `(${i % GRID_WIDTH},${(i - (i % GRID_WIDTH)) / GRID_WIDTH})`;
    if (world.tileIntersection[i] !== -1) errors.push(`bus stop on intersection ${where}`);
    if (edgeTiles.has(i)) errors.push(`bus stop on edge tile ${where}`);
  });
  if (stops !== rules.busStops) {
    errors.push(`has ${stops} bus stops, district needs ${rules.busStops}`);
  }
  for (const a of world.edges) {
    for (const b of world.edges) {
      if (a !== b && route(world, a.index, b.index) === null) {
        errors.push(`no route from edge ${a.id} to edge ${b.id}`);
      }
    }
  }
  return errors;
}

export interface MapFile {
  /** File name, `<id>.json`. */
  readonly source: string;
  readonly data: unknown;
}

/** Validates a template set: schema, every variant, unique ids, and no template repeating another. */
export function validateMapTemplates(files: readonly MapFile[]): {
  readonly templates: readonly MapTemplate[];
  readonly errors: readonly MapError[];
} {
  const templates: MapTemplate[] = [];
  const errors: MapError[] = [];
  const shapes = new Map<string, string>();
  for (const { source, data } of files) {
    const schemaErrors: readonly SchemaError[] = validateSchema(MAP_SCHEMA, data);
    if (schemaErrors.length > 0) {
      errors.push(...schemaErrors.map((e) => ({ source, ...e })));
      continue;
    }
    const t = data as MapTemplate;
    const template: MapTemplate = { id: t.id, district: t.district, name: t.name, rows: t.rows };
    if (source !== `${template.id}.json`) {
      errors.push({ source, path: 'id', message: `file must be named ${template.id}.json` });
    }
    if (!template.id.startsWith(`d${template.district}-`)) {
      errors.push({ source, path: 'id', message: `id must start with d${template.district}-` });
    }
    let variants: GridMap[];
    try {
      variants = templateVariants(template);
    } catch (e) {
      errors.push({ source, path: 'rows', message: (e as Error).message });
      continue;
    }
    for (const map of variants) {
      for (const message of checkVariant(map, DISTRICT_MAP_RULES[template.district])) {
        errors.push({ source, path: map.id, message });
      }
    }
    // A template that is a variant of another adds nothing to the bank.
    for (const v of VARIANTS) {
      const key = transformRows(template.rows, v).join('/');
      const other = shapes.get(key);
      if (other !== undefined) {
        errors.push({ source, path: 'rows', message: `same layout as ${other} (variant "${v}")` });
        break;
      }
    }
    shapes.set(template.rows.join('/'), template.id);
    if (templates.some((x) => x.id === template.id)) {
      errors.push({ source, path: 'id', message: `duplicate id ${template.id}` });
    }
    templates.push(template);
  }
  return { templates, errors };
}

/** Every map (all variants of all templates) for a district, in template then variant order. */
export function mapsForDistrict(
  templates: readonly MapTemplate[],
  district: District,
): readonly GridMap[] {
  return templates.filter((t) => t.district === district).flatMap(templateVariants);
}

/** The map for a seeded round: a uniform pick from the district's maps using the round PRNG. */
export function pickMap(maps: readonly GridMap[], seed: number): GridMap {
  const map = maps.length === 0 ? undefined : maps[nextInt(createPrng(seed), maps.length)];
  if (map === undefined) throw new RangeError('no maps to pick from');
  return map;
}
