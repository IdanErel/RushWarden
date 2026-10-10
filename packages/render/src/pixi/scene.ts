/**
 * The Pixi 8 traffic scene: static map (roads, intersections, controller glyphs) plus one
 * Graphics per vehicle that shares a per-type GraphicsContext, positioned every frame from the
 * interpolated snapshot pair. The scene only draws; it never steps the sim.
 */
import { Application, Container, Graphics, GraphicsContext } from 'pixi.js';
import {
  CELLS_PER_TILE,
  GRID_HEIGHT,
  GRID_WIDTH,
  VehicleType,
  buildWorld,
  type ControllerKind,
  type GridMap,
  type Side,
  type World,
} from '@rushwarden/sim';
import {
  LANE_WIDTH,
  SIDE_VEC,
  connections,
  fitGrid,
  intersections,
  lanesAt,
  roadRuns,
  roadWidth,
  tileIndex,
  type ViewFit,
} from '../geometry.js';
import { boxAlpha, readControllers, stopBars, type LiveIntersection } from '../controller-state.js';
import { SnapshotBuffer, TICK_MS, type VehiclePose } from '../interpolate.js';
import { worldLaneLayout, type LaneLayout } from '../lanes.js';
import { OLD_TOWN, type Palette } from '../palette.js';
import { controllerShapes, vehicleShapes } from '../shapes.js';
import { drawShapes } from './draw.js';

export interface ControllerMark {
  readonly x: number;
  readonly y: number;
  readonly kind: ControllerKind;
  /** Priority direction, for `priority`. */
  readonly direction?: Side;
}

export interface TrafficSceneOptions {
  readonly map: GridMap;
  readonly width: number;
  readonly height: number;
  readonly palette?: Palette;
  /** Defaults to `worldLaneLayout(buildWorld(map))`, the sim's own lanes. */
  readonly layout?: LaneLayout;
  /** Device pixel ratio; defaults to `window.devicePixelRatio`. */
  readonly resolution?: number;
}

/** Emergency beacon period per frame (2-frame blink, GDD §7). */
const BEACON_MS = 160;
const VEHICLE_TYPES = [0, 1, 2, 3, 4, 5] as const;

export class TrafficScene {
  readonly app: Application;
  readonly buffer: SnapshotBuffer;
  private map: GridMap;
  private readonly palette: Palette;
  private fit: ViewFit;
  private readonly world = new Container();
  private readonly mapLayer = new Graphics();
  /** Live controller state: box occupancy tint and signal stop bars (ADR-020 frames). */
  private readonly liveLayer = new Graphics();
  private readonly glyphLayer = new Container();
  private readonly vehicleLayer = new Container();
  private readonly vehicles = new Map<number, Graphics>();
  private readonly pool: Graphics[] = [];
  private readonly poses: VehiclePose[] = [];
  private readonly seen = new Set<number>();
  private contexts: GraphicsContext[] = [];
  /** Second beacon frame for emergency vehicles. */
  private beaconAlt: GraphicsContext | null = null;
  private controllers = new Map<number, ControllerMark>();
  /** Intersection order of the controllers frames: the sim world of the current map. */
  private ixWorld: Pick<World, 'intersections'> = { intersections: [] };
  private live: LiveIntersection[] = [];
  private liveBytes: Uint8Array | null = null;
  private liveKinds = '';
  private drawn = 0;
  private source: { update(now: number): void } | null = null;

  private constructor(app: Application, opts: TrafficSceneOptions) {
    this.app = app;
    this.map = opts.map;
    this.palette = opts.palette ?? OLD_TOWN;
    this.buffer = new SnapshotBuffer(opts.layout ?? worldLaneLayout(buildWorld(opts.map)));
    this.fit = fitGrid(opts.width, opts.height);
    this.world.addChild(this.mapLayer, this.liveLayer, this.glyphLayer, this.vehicleLayer);
    this.ixWorld = intersectionWorld(opts.map);
    app.stage.addChild(this.world);
    this.rebuild();
    app.ticker.add(() => this.frame(performance.now()));
  }

  /** Creates the Pixi application inside `parent` and the scene on top of it. */
  static async create(parent: HTMLElement, opts: TrafficSceneOptions): Promise<TrafficScene> {
    const palette = opts.palette ?? OLD_TOWN;
    const app = new Application();
    await app.init({
      width: opts.width,
      height: opts.height,
      background: palette.ground,
      antialias: true,
      resolution: opts.resolution ?? window.devicePixelRatio ?? 1,
      autoDensity: true,
      preference: 'webgl',
    });
    parent.appendChild(app.canvas);
    return new TrafficScene(app, opts);
  }

  /**
   * Lets a frame source (the `SimClient`) run first on every display frame, so snapshots it
   * releases are drawn in the same frame. Pass null to detach.
   */
  attach(source: { update(now: number): void } | null): void {
    this.source = source;
  }

  /** Feeds one snapshot released by the client. */
  pushSnapshot(snapshot: Uint16Array, now = performance.now()): void {
    this.buffer.push(snapshot, now);
  }

  /**
   * Feeds the controller frame released with a snapshot (`SimClient` `onFrame`'s third
   * argument): signal stop bars, box occupancy, and live controller glyphs. Redraws only when the
   * frame's bytes change.
   */
  pushControllers(frame: Uint8Array): void {
    const prev = this.liveBytes;
    if (prev && prev.length === frame.length && prev.every((b, i) => b === frame[i])) return;
    this.liveBytes = frame.slice();
    this.live = readControllers(frame, this.ixWorld);
    this.drawLive();
    const kinds = this.live.map((l) => l.kind).join();
    if (kinds !== this.liveKinds) {
      this.liveKinds = kinds;
      this.drawGlyphs();
    }
  }

  /** Last decoded controller state, in intersection order (for tests and test hooks). */
  get liveControllers(): readonly LiveIntersection[] {
    return this.live;
  }

  /** Sim speed multiplier, so interpolation spans one tick at that speed. */
  setSpeed(speed: number): void {
    this.buffer.tickMs = TICK_MS / (speed > 0 ? speed : 1);
  }

  /** Replaces all controller glyphs. Intersections not listed are uncontrolled (no glyph). */
  setControllers(marks: readonly ControllerMark[]): void {
    this.controllers = new Map(marks.map((m) => [tileIndex(m.x, m.y), m]));
    this.drawGlyphs();
  }

  setMap(map: GridMap, layout: LaneLayout = worldLaneLayout(buildWorld(map))): void {
    this.map = map;
    this.buffer.setLayout(layout);
    this.buffer.reset();
    this.controllers.clear();
    this.ixWorld = intersectionWorld(map);
    this.clearLive();
    this.rebuild();
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.fit = fitGrid(width, height);
    this.rebuild();
  }

  /** Vehicles drawn in the last frame (for tests and the dev page). */
  get vehicleCount(): number {
    return this.drawn;
  }

  get view(): Readonly<ViewFit> {
    return this.fit;
  }

  destroy(): void {
    for (const c of this.contexts) c.destroy();
    this.beaconAlt?.destroy();
    this.app.destroy(true, { children: true });
  }

  // -------------------------------------------------------------------------------------------

  private rebuild(): void {
    this.world.position.set(this.fit.originX, this.fit.originY);
    this.drawMap();
    this.drawLive();
    this.drawGlyphs();
    this.buildVehicleContexts();
  }

  private clearLive(): void {
    this.live = [];
    this.liveBytes = null;
    this.liveKinds = '';
  }

  private drawLive(): void {
    const g = this.liveLayer.clear();
    const T = this.fit.tilePx;
    const p = this.palette;
    for (const l of this.live) {
      const a = boxAlpha(l.box);
      if (a > 0) {
        const w = roadWidth(lanesAt(this.map, l.x, l.y)) * T;
        g.rect((l.x + 0.5) * T - w / 2, (l.y + 0.5) * T - w / 2, w, w).fill({
          color: p.signalAmber,
          alpha: a,
        });
      }
      for (const b of stopBars(this.map, l)) {
        g.rect(b.x * T, b.y * T, b.w * T, b.h * T).fill(b.green ? p.signalGreen : p.signalRed);
      }
    }
  }

  private buildVehicleContexts(): void {
    const cellPx = this.fit.tilePx / CELLS_PER_TILE;
    const old = [...this.contexts, ...(this.beaconAlt ? [this.beaconAlt] : [])];
    this.contexts = VEHICLE_TYPES.map((t) =>
      drawShapes(new GraphicsContext(), vehicleShapes(t, 0), this.palette, cellPx),
    );
    this.beaconAlt = drawShapes(
      new GraphicsContext(),
      vehicleShapes(VehicleType.Emergency, 1),
      this.palette,
      cellPx,
    );
    for (const g of this.vehicles.values()) g.destroy();
    for (const g of this.pool) g.destroy();
    this.vehicles.clear();
    this.pool.length = 0;
    for (const c of old) c.destroy();
  }

  private drawMap(): void {
    const g = this.mapLayer.clear();
    const p = this.palette;
    const T = this.fit.tilePx;
    const map = this.map;
    // City blocks.
    for (let y = 0; y < GRID_HEIGHT; y++)
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (map.tiles[tileIndex(x, y)]?.kind === 'road') continue;
        const inset = T * 0.06;
        g.roundRect(x * T + inset, y * T + inset, T - 2 * inset, T - 2 * inset, T * 0.12).fill(
          p.block,
        );
      }
    // Roads: one rounded rectangle per straight run.
    for (const run of roadRuns(map)) {
      const w = roadWidth(run.lanes) * T;
      const r = w * 0.3;
      const a0 = run.openStart ? 0 : (run.from + 0.5) * T - w / 2;
      const a1 = run.openEnd
        ? (run.axis === 'h' ? GRID_WIDTH : GRID_HEIGHT) * T
        : (run.to + 0.5) * T + w / 2;
      const c = (run.at + 0.5) * T - w / 2;
      if (run.axis === 'h') g.roundRect(a0, c, a1 - a0, w, r).fill(p.road);
      else g.roundRect(c, a0, w, a1 - a0, r).fill(p.road);
    }
    // Lane dividers: 2 px centre line, plus a 1 px line between same-direction lanes. Lines run
    // from each tile's centre to its connected sides; intersection squares are drawn over them.
    for (let y = 0; y < GRID_HEIGHT; y++)
      for (let x = 0; x < GRID_WIDTH; x++) {
        const lanes = lanesAt(map, x, y);
        if (lanes === 0) continue;
        const cx = (x + 0.5) * T;
        const cy = (y + 0.5) * T;
        const len = T / 2;
        const lines: [number, number, number][] = [[0, 2, 1]];
        if (lanes === 2) lines.push([LANE_WIDTH * T, 1, 0.4], [-LANE_WIDTH * T, 1, 0.4]);
        for (const side of connections(map, x, y)) {
          const [dx, dy] = SIDE_VEC[side];
          for (const [off, width, alpha] of lines) {
            if (dx !== 0) {
              const x0 = dx > 0 ? cx - width / 2 : cx - len;
              g.rect(x0, cy + off - width / 2, len + width / 2, width).fill({
                color: p.divider,
                alpha,
              });
            } else {
              const y0 = dy > 0 ? cy - width / 2 : cy - len;
              g.rect(cx + off - width / 2, y0, width, len + width / 2).fill({
                color: p.divider,
                alpha,
              });
            }
          }
        }
      }
    // Intersection squares.
    for (const { x, y } of intersections(map)) {
      const w = roadWidth(lanesAt(map, x, y)) * T;
      g.rect((x + 0.5) * T - w / 2, (y + 0.5) * T - w / 2, w, w).fill(p.intersection);
    }
  }

  private drawGlyphs(): void {
    for (const c of this.glyphLayer.removeChildren()) c.destroy();
    const T = this.fit.tilePx;
    for (const { x, y } of intersections(this.map)) {
      // A glyph the UI set wins; otherwise the live controller kind from the worker, if any.
      const live = this.live.find((l) => l.x === x && l.y === y);
      const mark =
        this.controllers.get(tileIndex(x, y)) ??
        (live && live.kind !== 'uncontrolled' ? { x, y, kind: live.kind } : undefined);
      if (!mark) continue;
      const size = roadWidth(lanesAt(this.map, x, y)) * T * 0.78;
      const g = new Graphics();
      drawShapes(
        g.context,
        controllerShapes(mark.kind, mark.direction),
        this.palette,
        size,
        (x + 0.5) * T,
        (y + 0.5) * T,
      );
      this.glyphLayer.addChild(g);
    }
  }

  private frame(now: number): void {
    this.source?.update(now);
    const T = this.fit.tilePx;
    const n = this.buffer.sample(now, this.poses);
    const beacon = Math.floor(now / BEACON_MS) % 2 === 1;
    this.seen.clear();
    for (let i = 0; i < n; i++) {
      const pose = this.poses[i];
      if (!pose) continue;
      this.seen.add(pose.id);
      let g = this.vehicles.get(pose.id);
      const ctx =
        pose.type === VehicleType.Emergency && beacon && this.beaconAlt
          ? this.beaconAlt
          : (this.contexts[pose.type] ?? this.contexts[0]);
      if (!ctx) continue;
      if (!g) {
        g = this.pool.pop() ?? new Graphics();
        this.vehicles.set(pose.id, g);
        this.vehicleLayer.addChild(g);
      }
      if (g.context !== ctx) g.context = ctx;
      g.position.set(pose.x * T, pose.y * T);
      g.rotation = pose.heading;
    }
    for (const [id, g] of this.vehicles) {
      if (this.seen.has(id)) continue;
      this.vehicles.delete(id);
      this.vehicleLayer.removeChild(g);
      this.pool.push(g);
    }
    this.drawn = this.seen.size;
  }
}

/** The sim world's intersection order for a map, or none if the map does not build. */
function intersectionWorld(map: GridMap): Pick<World, 'intersections'> {
  try {
    return buildWorld(map);
  } catch {
    return { intersections: [] };
  }
}
