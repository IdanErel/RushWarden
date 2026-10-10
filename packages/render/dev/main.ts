/**
 * Render dev page: the plus map (`emptyMap`) with traffic stepped in a worker (the renderer's
 * fake traffic by default, the real sim with `source=sim`), interpolated by the scene, with the
 * live controller readouts (signal stop bars, box occupancy) and a legend of every controller
 * glyph and vehicle type.
 * Not shipped; `pnpm --filter @rushwarden/render dev` serves it.
 */
import { Application, Container, Graphics, GraphicsContext, Text } from 'pixi.js';
import {
  CELLS_PER_TILE,
  emptyMap,
  sampleInput,
  type ControllerKind,
  type Placement,
  type RoundInput,
  type VehicleType,
} from '@rushwarden/sim';
import {
  OLD_TOWN,
  SimClient,
  spawnFakeWorker,
  spawnSimWorker,
  TrafficScene,
  tileLaneLayout,
  VEHICLE_LENGTH,
  controllerShapes,
  drawShapes,
  vehicleShapes,
} from '../src/index.js';

const q = new URLSearchParams(location.search);
const speed = Number(q.get('speed') ?? '1') || 1;
const ctrl = (q.get('ctrl') ?? 'signal') as ControllerKind;
const source = q.get('source') === 'sim' ? 'sim' : 'fake';
let seed = Number(q.get('seed') ?? '1') >>> 0;

const WIDTH = Math.min(window.innerWidth, 430);
const SCENE_H = Math.round((WIDTH / 7) * 9);
const map = emptyMap();
const state = document.getElementById('state') as HTMLOutputElement;

/** The `ctrl` controller on the centre intersection, as a card placement would set it. */
const placement: Placement = {
  cardId: 'dev-controller',
  tier: 1,
  target: { kind: 'intersection', tile: { x: 3, y: 4 } },
  effects: [{ kind: 'setController', controller: ctrl, direction: 'e' }],
  order: 0,
};

function input(s: number): RoundInput {
  return { ...sampleInput(s), seed: s, map, mapId: map.id, placements: [placement] };
}

async function boot(): Promise<void> {
  const scene = await TrafficScene.create(document.getElementById('scene') as HTMLElement, {
    map,
    width: WIDTH,
    height: SCENE_H,
    // Fake traffic uses the renderer's per-tile lane ids; the real sim uses its world's lanes.
    ...(source === 'fake' ? { layout: tileLaneLayout(map) } : {}),
  });
  scene.setControllers([{ x: 3, y: 4, kind: ctrl, direction: 'e' }]);
  scene.setSpeed(speed);
  const client = new SimClient(source === 'sim' ? spawnSimWorker() : spawnFakeWorker(), {
    onFrame: (f, now, controllers) => {
      scene.pushSnapshot(f, now);
      if (controllers) scene.pushControllers(controllers);
    },
    onDone: () => {
      seed = (seed + 1) >>> 0;
      client.start(input(seed));
    },
    onError: (m) => (state.textContent = `error: ${m}`),
  });
  client.setSpeed(speed);
  scene.attach(client);
  client.start(input(seed));

  setInterval(() => {
    state.dataset['tick'] = String(scene.buffer.tick);
    state.dataset['vehicles'] = String(scene.vehicleCount);
    // Live readout of the centre intersection: kind, green approaches, vehicles in the box.
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
