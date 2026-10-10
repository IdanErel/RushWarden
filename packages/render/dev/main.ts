/**
 * Render dev page: the plus map (`emptyMap`) with traffic stepped in a worker (the renderer's
 * fake traffic by default, the real sim with `source=sim`), interpolated by the scene, with the
 * live controller readouts (signal stop bars, box occupancy) and a legend of every controller
 * glyph and vehicle type.
 * Not shipped; `pnpm --filter @rushwarden/render dev` serves it.
 */
import { Application, Container, Graphics, GraphicsContext, Text } from 'pixi.js';
import { districtMaps } from '@rushwarden/content';
import {
  CELLS_PER_TILE,
  GRID_HEIGHT,
  GRID_WIDTH,
  ROUND_TICKS,
  buildWorld,
  createPrng,
  emptyMap,
  nextInt,
  sampleInput,
  type DemandEvent,
  type GridMap,
  type SegmentId,
  type ControllerKind,
  type Placement,
  type RoundInput,
  type VehicleType,
} from '@rushwarden/sim';
import {
  OLD_TOWN,
  HEAT_GUTTER_PX,
  SimClient,
  fakeDemand,
  spawnSimWorker,
  TrafficScene,
  tileLaneLayout,
  VEHICLE_LENGTH,
  controllerShapes,
  drawShapes,
  lanesAt,
  vehicleShapes,
} from '../src/index.js';
import { spawnFakeWorker } from '../src/worker/fake-spawn.js';

const q = new URLSearchParams(location.search);
const speed = Number(q.get('speed') ?? '1') || 1;
const ctrl = (q.get('ctrl') ?? 'signal') as ControllerKind;
const source = q.get('source') === 'sim' ? 'sim' : 'fake';
const parade = q.get('boss') === 'parade';
let seed = Number(q.get('seed') ?? '1') >>> 0;
const reducedMotion =
  q.get('reduced') === '1' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** `jam=1` runs the fake in Gridlock Drill jam mode to show the gridlock effect. */
const jam = q.get('jam') === '1';

const WIDTH = Math.min(window.innerWidth, 430);
const SCENE_H = Math.round(((WIDTH - 2 * HEAT_GUTTER_PX) / 7) * 9 + 2 * HEAT_GUTTER_PX);
/** `map=d1-03` picks a District 1 template from content; the default is the plus map. */
const map: GridMap = districtMaps(1).find((m) => m.id === q.get('map')) ?? emptyMap();
const world = buildWorld(map);
const centre = world.intersections[Math.floor(world.intersections.length / 2)];
const state = document.getElementById('state') as HTMLOutputElement;

/** The `ctrl` controller on the middle intersection, as a card placement would set it. */
const placements: Placement[] = centre
  ? [
      {
        cardId: 'dev-controller',
        tier: 1,
        target: { kind: 'intersection', tile: { x: centre.x, y: centre.y } },
        effects: [{ kind: 'setController', controller: ctrl, direction: 'e' }],
        order: 0,
      },
    ]
  : [];

/** `boss=parade`: closes the first plain road tile away from the map border (a 1-tile segment). */
function paradeSegment(): SegmentId[] {
  for (let y = 1; y < GRID_HEIGHT - 1; y++)
    for (let x = 1; x < GRID_WIDTH - 1; x++)
      if (world.tileIntersection[y * GRID_WIDTH + x] === -1 && lanesAt(map, x, y) > 0)
        return [{ from: { x, y }, to: { x, y } }];
  return [];
}

/**
 * Dev demand on any map: 60–120 vehicles of the common types between random edge pairs, spread
 * over the round (like the sim's `denseInput`). Not the balance owner's district demand.
 */
function devDemand(s: number): DemandEvent[] {
  const p = createPrng(s);
  const edges = map.edges.map((e) => e.id);
  const out: DemandEvent[] = [];
  const types = [0, 0, 0, 0, 1, 2, 3, 5] as const;
  const n = 60 + nextInt(p, 61);
  for (let i = 0; i < n && edges.length > 1; i++) {
    const a = nextInt(p, edges.length);
    let b = nextInt(p, edges.length - 1);
    if (b >= a) b++;
    const edge = edges[a];
    const destinationEdge = edges[b];
    const vehicleType = types[nextInt(p, types.length)];
    if (edge === undefined || destinationEdge === undefined || vehicleType === undefined) continue;
    out.push({ tick: nextInt(p, ROUND_TICKS), edge, destinationEdge, vehicleType });
  }
  return out.sort((x, y) => x.tick - y.tick || x.edge - y.edge);
}

function input(s: number): RoundInput {
  const base = sampleInput(s);
  return {
    ...base,
    seed: s,
    map,
    mapId: map.id,
    placements,
    demandProfile:
      source === 'fake'
        ? fakeDemand(map, s)
        : map.id === emptyMap().id
          ? base.demandProfile
          : devDemand(s),
    districtRules: { ...base.districtRules, boss: jam ? 'gridlock-drill' : null },
    ...(parade ? { closedSegments: paradeSegment() } : {}),
  };
}

async function boot(): Promise<void> {
  const scene = await TrafficScene.create(document.getElementById('scene') as HTMLElement, {
    map,
    width: WIDTH,
    height: SCENE_H,
    reducedMotion,
  });
  if (centre) scene.setControllers([{ x: centre.x, y: centre.y, kind: ctrl, direction: 'e' }]);
  scene.setSpeed(speed);
  // Each round: the scene lays lanes out on that round's world (`roundWorld`) and draws its
  // closures. Fake traffic uses the renderer's per-tile lane ids instead.
  const begin = (s: number): void => {
    const i = input(s);
    scene.setRound(i, source === 'fake' ? tileLaneLayout(map) : undefined);
    if (centre) scene.setControllers([{ x: centre.x, y: centre.y, kind: ctrl, direction: 'e' }]);
    client.start(i);
  };
  const client = new SimClient(source === 'sim' ? spawnSimWorker() : spawnFakeWorker(), {
    onFrame: (f, now, controllers) => {
      scene.pushSnapshot(f, now);
      if (controllers) scene.pushControllers(controllers);
    },
    onDone: (result) => {
      // Gridlock: hold the red queue on screen for a moment before the next round.
      if (result.gridlocked) scene.setGridlock(true);
      setTimeout(
        () => {
          seed = (seed + 1) >>> 0;
          scene.setGridlock(false);
          begin(seed);
        },
        result.gridlocked ? 2500 : 0,
      );
    },
    onError: (m) => (state.textContent = `error: ${m}`),
  });
  client.setSpeed(speed);
  scene.attach(client);
  begin(seed);

  setInterval(() => {
    state.dataset['tick'] = String(scene.buffer.tick);
    state.dataset['vehicles'] = String(scene.vehicleCount);
    state.dataset['queued'] = String(scene.stats.queued);
    state.dataset['trails'] = String(scene.stats.trails);
    state.dataset['gridlock'] = String(scene.stats.gridlock);
    state.dataset['closed'] = String(scene.closedTiles.length);
    // Live readout of the first intersection: kind, green approaches, vehicles in the box.
    const live = scene.liveControllers[0];
    state.dataset['live'] = live ? `${live.kind}:${live.green.join('')}:${live.box}` : '';
    state.textContent = `seed ${seed} · tick ${scene.buffer.tick} · ${scene.vehicleCount} vehicles`;
  }, 100);

  await legend(scene.view.tilePx);
  Object.assign(window, { scene, client });
}

/** Every controller glyph and vehicle type at phone scale, with a 3× zoom of each vehicle. */
async function legend(tilePx: number): Promise<void> {
  const app = new Application();
  await app.init({
    width: WIDTH,
    height: 150,
    background: OLD_TOWN.ground,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  (document.getElementById('legend') as HTMLElement).appendChild(app.canvas);
  const root = new Container();
  app.stage.addChild(root);
  const label = (s: string, x: number, y: number): void => {
    const t = new Text({
      text: s,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: OLD_TOWN.outline },
    });
    t.anchor.set(0.5, 0);
    t.position.set(x, y);
    root.addChild(t);
  };
  const glyphs: [ControllerKind, string][] = [
    ['signal', 'signal'],
    ['roundabout', 'roundabout'],
    ['stop-all', 'stop'],
    ['priority', 'priority'],
    ['uncontrolled', 'uncontrolled'],
  ];
  const gw = WIDTH / glyphs.length;
  const box = Math.round(tilePx * 0.44);
  glyphs.forEach(([k, name], i) => {
    const cx = gw * (i + 0.5);
    const square = new Graphics().rect(cx - box / 2, 8, box, box).fill(OLD_TOWN.intersection);
    const glyph = new Graphics(
      drawShapes(
        new GraphicsContext(),
        controllerShapes(k, 'e'),
        OLD_TOWN,
        box * 0.78,
        cx,
        8 + box / 2,
      ),
    );
    root.addChild(square, glyph);
    label(name, cx, 12 + box);
  });
  const names = ['car', 'taxi', 'bus', 'truck', 'emergency', 'bike'];
  const vw = WIDTH / names.length;
  const cellPx = tilePx / CELLS_PER_TILE;
  names.forEach((name, t) => {
    const cx = vw * (t + 0.5);
    const road = new Graphics().roundRect(cx - vw / 2 + 4, 66, vw - 8, 56, 6).fill(OLD_TOWN.road);
    root.addChild(road);
    // Phone scale (12 px class) on top, zoomed below it; both point east.
    const len = VEHICLE_LENGTH[t as VehicleType];
    const zoom = Math.min(2.4, (vw - 16) / (len * cellPx));
    for (const [scale, y] of [
      [1, 78],
      [zoom, 104],
    ] as const) {
      const g = new Graphics(
        drawShapes(new GraphicsContext(), vehicleShapes(t), OLD_TOWN, cellPx * scale),
      );
      g.position.set(cx + ((len - 1) * cellPx * scale) / 2, y);
      root.addChild(g);
    }
    label(name, cx, 126);
  });
}

void boot();
