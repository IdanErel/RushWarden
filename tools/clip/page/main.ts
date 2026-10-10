/**
 * The clip page: the game's own `TrafficScene` plus the clip HUD, drawn one frame at a time on
 * request from cli/render.ts. Nothing here reads the wall clock: `performance.now` is replaced by
 * a virtual clock that only `frame(i)` moves, the Pixi ticker is stopped, and the sim runs on
 * this thread from the replay (no worker), so frame i is the same picture on every run.
 */
import { Graphics, UPDATE_PRIORITY } from 'pixi.js';
import {
  HEAT_GUTTER_PX,
  TrafficScene,
  worldLaneLayout,
  type ControllerMark,
  type LaneLayout,
} from '@rushwarden/render';
import { ControllerCode, roundWorld, type ControllerKind, type RoundInput } from '@rushwarden/sim';
import { buildClip, clipMeta, frameTime, hudAt, type Clip, type ClipMeta } from '../src/clip.js';
import type { ClipSpec } from '../src/director.js';
import { FRAME_H, FRAME_W, hudOps, type MapBox } from '../src/hud.js';
import type { ClipOptions } from '../src/clip.js';
import './store.js';

/** Virtual clock origin: far above any real `performance.now()` the ticker has seen. */
const BASE_MS = 10_000_000;
let virtualNow = BASE_MS;
Object.defineProperty(performance, 'now', { value: () => virtualNow, configurable: true });

export interface ClipJob {
  readonly spec: ClipSpec;
  readonly options: ClipOptions;
  /** Device pixels per logical unit; 2.5 renders the 432×768 frame at 1080×1920. */
  readonly scale: number;
}

/**
 * Methods PR #34 adds to `TrafficScene` (per-round lanes and closures; live signal state). Used
 * when present so the clip picks them up without a change here.
 */
interface SceneExtras {
  setRound?(input: RoundInput, layout?: LaneLayout): void;
  pushControllers?(frame: Uint8Array): void;
}

const KIND_BY_CODE: Readonly<Record<number, ControllerKind>> = {
  [ControllerCode.Signal]: 'signal',
  [ControllerCode.Roundabout]: 'roundabout',
  [ControllerCode.StopAll]: 'stop-all',
  [ControllerCode.Priority]: 'priority',
};

let clip: Clip | null = null;
let scene: (TrafficScene & SceneExtras) | null = null;
let hud: Graphics | null = null;
let mapBox: MapBox = { top: 0, bottom: FRAME_H };
let released = -1;
let gridlockShown = false;
/** The next frame `step` accepts: frames are drawn strictly in order. */
let next = 0;

async function prepare(job: ClipJob): Promise<ClipMeta> {
  clip = buildClip(job.spec, job.options);
  const input = clip.plan.input;
  const world = roundWorld(input);
  const layout = worldLaneLayout(world);
  scene = await TrafficScene.create(document.getElementById('stage') as HTMLElement, {
    map: input.map,
    width: FRAME_W,
    height: FRAME_H,
    layout,
    resolution: job.scale,
    reducedMotion: clip.reducedMotion,
  });
  scene.app.ticker.stop();

  // Controller glyphs from the round's tick-0 controller state (cards placed this round and
  // earlier run-duration cards alike). Maps start uncontrolled, which has no glyph (ADR-015).
  const marks: ControllerMark[] = [];
  const ctrl0 = clip.recording.controllers[0] ?? new Uint8Array();
  world.intersections.forEach((ix, k) => {
    const kind = KIND_BY_CODE[ctrl0[k * 3] ?? 0];
    if (kind) marks.push({ x: ix.x, y: ix.y, kind });
  });
  if (scene.setRound) scene.setRound(input, layout);
  else scene.setDemand(input.demandProfile);
  scene.setControllers(marks);
  scene.setSpeed(clip.timeline.speed);

  const v = scene.view;
  mapBox = { top: v.originY - HEAT_GUTTER_PX, bottom: v.originY + v.heightPx + HEAT_GUTTER_PX };
  hud = new Graphics();
  scene.app.stage.addChild(hud);
  released = -1;
  gridlockShown = false;
  next = 0;
  return clipMeta(clip);
}

function release(tick: number, now: number): void {
  if (!clip || !scene) return;
  const { snapshots, controllers } = clip.recording;
  if (released < 0) released = clip.timeline.fromTick - 1;
  while (released < tick) {
    released++;
    const snap = snapshots[released];
    if (snap) scene.pushSnapshot(snap, now);
    const c = controllers[released];
    if (c && scene.pushControllers) scene.pushControllers(c);
  }
  // As the game does on the worker's `done`: gridlock feedback once the last tick is out.
  const r = clip.recording.result;
  if (!gridlockShown && r.gridlocked && released >= r.ticks) {
    scene.setGridlock(true, now);
    gridlockShown = true;
  }
}

function drawHud(i: number): void {
  if (!clip || !hud) return;
  const g = hud.clear();
  for (const op of hudOps(hudAt(clip, i), mapBox)) {
    if (op.radius) g.roundRect(op.x, op.y, op.w, op.h, op.radius);
    else g.rect(op.x, op.y, op.w, op.h);
    g.fill({ color: op.color, alpha: op.alpha ?? 1 });
  }
}

/** Advances the scene through frame `i`; draws to the canvas only when `draw` is set. */
function step(i: number, draw: boolean): void {
  if (!clip || !scene) throw new Error('prepare() first');
  if (i !== next) throw new Error(`frames must be requested in order: expected ${next}, got ${i}`);
  next = i + 1;
  const f = frameTime(clip, i);
  const now = BASE_MS + f.ms;
  release(f.tick, now);
  const { app } = scene;
  // The ticker runs listeners only when time moves forward; the scene's frame reads `now`.
  virtualNow = now;
  app.ticker.lastTime = now - 1;
  if (draw) {
    drawHud(i);
    app.ticker.update(now);
    return;
  }
  // Without the Application's render listener: the scene updates its vehicles (and their draw
  // order) exactly as when drawing, but nothing is rasterised.
  app.ticker.remove(app.render, app);
  try {
    app.ticker.update(now);
  } finally {
    app.ticker.add(app.render, app, UPDATE_PRIORITY.LOW);
  }
}

/**
 * Where the map is drawn in the logical frame (no heat gutter): the store-asset compositor
 * (cli/store.ts) crops capsules and the library hero from it.
 */
function layout(): { x: number; y: number; w: number; h: number } {
  if (!scene) throw new Error('prepare() first');
  const v = scene.view;
  return { x: v.originX, y: v.originY, w: v.widthPx, h: v.heightPx };
}

/** Draws frame `i` and returns it as a PNG data URL. Frames must be requested in order. */
function frame(i: number): string {
  step(i, true);
  // Read back in the same task as the render, before the drawing buffer is discarded.
  return (scene as TrafficScene).app.canvas.toDataURL('image/png');
}

/**
 * Brings the scene to the state it has after frame `i - 1` without drawing, so frames from `i`
 * on are pixel-identical to an uninterrupted run. This is what lets the CLI render one clip in
 * several browsers at once.
 */
function seek(i: number): void {
  while (next < i) step(next, false);
}

Object.assign(window, { clip: { prepare, frame, seek, layout } });
document.body.dataset['ready'] = '1';
