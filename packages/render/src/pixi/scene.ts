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
  ROUND_TICKS,
  VehicleType,
  buildWorld,
  roundWorld,
  type ControllerKind,
  type DemandProfile,
  type GridMap,
  type RoundInput,
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
import { NO_CLOSURES, closures, type Closures } from '../closures.js';
import { boxAlpha, readControllers, stopBars, type LiveIntersection } from '../controller-state.js';
import { SnapshotBuffer, TICK_MS, type VehiclePose } from '../interpolate.js';
import { worldLaneLayout, type LaneLayout } from '../lanes.js';
import { OLD_TOWN, type Palette } from '../palette.js';
import { VEHICLE_LENGTH, controllerShapes, vehicleOutline, vehicleShapes } from '../shapes.js';
import {
  GRIDLOCK_TINT,
  HEAT_BINS,
  HEAT_GUTTER_PX,
  demandBins,
  heatLevel,
  maxBin,
  pulseAlpha,
  shakeOffset,
  stripRect,
  trailCells,
  trailPieces,
  type MotionPrefs,
} from '../effects.js';
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
  /** GDD §8 reduced-motion mode: no shake, no trails, steady queue outline. */
  readonly reducedMotion?: boolean;
}

/** One drawn vehicle: the shared-context body plus its queue-pulse outline. */
interface VehicleView {
  readonly root: Container;
  readonly body: Graphics;
  readonly pulse: Graphics;
}

/** What the last frame drew; read by tests and the dev page's state node. */
export interface SceneStats {
  vehicles: number;
  /** Vehicles at speed 0 (pulsing, or red during gridlock). */
  queued: number;
  /** Vehicles drawing a speed trail. */
  trails: number;
  gridlock: boolean;
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
  /** Closed segments of the current round (Parade boss): faded road and end barriers. */
  private readonly closureLayer = new Graphics();
  private closed: Closures = NO_CLOSURES;
  private readonly glyphLayer = new Container();
  private readonly heatLayer = new Graphics();
  private readonly heatProgress = new Graphics();
  private readonly trailLayer = new Graphics();
  private readonly vehicleLayer = new Container();
  private readonly vehicles = new Map<number, VehicleView>();
  private readonly pool: VehicleView[] = [];
  private pulseContexts: GraphicsContext[] = [];
  private demand: DemandProfile | null = null;
  private gridlockAt: number | null = null;
  private lastTick = -1;
  private motion: MotionPrefs;
  readonly stats: SceneStats = { vehicles: 0, queued: 0, trails: 0, gridlock: false };
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
    this.motion = { reducedMotion: opts.reducedMotion ?? false };
    this.fit = fitGrid(opts.width, opts.height, HEAT_GUTTER_PX);
    this.world.addChild(
      this.mapLayer,
      this.closureLayer,
      this.heatLayer,
      this.heatProgress,
      this.liveLayer,
      this.glyphLayer,
      this.trailLayer,
      this.vehicleLayer,
    );
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
    this.closed = NO_CLOSURES;
    this.demand = null;
    this.gridlockAt = null;
    this.rebuild();
  }

  /**
   * Prepares the scene for a round. Snapshot lane ids refer to `roundWorld(input)` (the map plus
   * its topology cards, ADR-023), so the default layout is built from it every round; the
   * controllers frames use its intersection order; `input.closedSegments` are drawn closed; and
   * the round's demand shows as heat-strips (as `setDemand`).
   * Switches map when `input.map` differs. Inputs the sim would reject fall back to the bare map.
   */
  setRound(input: RoundInput, layout?: LaneLayout): void {
    const world = safeWorld(() => roundWorld(input)) ?? safeWorld(() => buildWorld(input.map));
    if (input.map.id !== this.map.id) {
      this.map = input.map;
      this.controllers.clear();
    }
    const chosen = layout ?? (world ? worldLaneLayout(world) : null);
    if (chosen) this.buffer.setLayout(chosen);
    this.buffer.reset();
    this.ixWorld = world ?? { intersections: [] };
    this.clearLive();
    let closed = NO_CLOSURES;
    if (world) {
      try {
        closed = closures(this.map, world, input.closedSegments);
      } catch {
        closed = NO_CLOSURES;
      }
    }
    this.closed = closed;
    this.demand = input.demandProfile;
    this.gridlockAt = null;
    this.rebuild();
  }

  /** Tiles drawn closed this round (for tests and the dev page). */
  get closedTiles(): readonly { x: number; y: number }[] {
    return this.closed.tiles;
  }

  /**
   * Shows the round's demand as a heat-strip per edge (GDD §2: "shown before placement as a
   * 15-second heat-strip per edge"). During Go, elapsed seconds are dimmed. Null hides them.
   */
  setDemand(profile: DemandProfile | null): void {
    this.demand = profile;
    this.drawHeat();
  }

  /**
   * Gridlock feedback (GDD §7): stopped vehicles turn desaturated red and the camera shakes 4 px
   * for 300 ms (no shake under reduced motion). Call with the round result's `gridlocked`; a new
   * round (tick 0) clears it.
   */
  setGridlock(on: boolean, now = performance.now()): void {
    this.gridlockAt = on ? now : null;
  }

  setReducedMotion(on: boolean): void {
    this.motion = { reducedMotion: on };
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.fit = fitGrid(width, height, HEAT_GUTTER_PX);
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
    for (const c of this.pulseContexts) c.destroy();
    this.beaconAlt?.destroy();
    this.app.destroy(true, { children: true });
  }

  // -------------------------------------------------------------------------------------------

  private rebuild(): void {
    this.world.position.set(this.fit.originX, this.fit.originY);
    this.drawMap();
    this.drawClosures();
    this.drawHeat();
    this.drawLive();
    this.drawGlyphs();
    this.buildVehicleContexts();
  }

  private clearLive(): void {
    this.live = [];
    this.liveBytes = null;
    this.liveKinds = '';
  }

  private drawClosures(): void {
    const g = this.closureLayer.clear();
    const T = this.fit.tilePx;
    const p = this.palette;
    for (const { x, y } of this.closed.tiles) {
      const w = roadWidth(lanesAt(this.map, x, y)) * T;
      const sides = connections(this.map, x, y);
      const horizontal = sides.includes('e') || sides.includes('w');
      if (horizontal) g.rect(x * T, (y + 0.5) * T - w / 2, T, w);
      else g.rect((x + 0.5) * T - w / 2, y * T, w, T);
      g.fill({ color: p.ground, alpha: 0.55 });
    }
    for (const b of this.closed.barriers) {
      g.rect(b.x * T, b.y * T, b.w * T, b.h * T).fill(p.stop);
    }
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
    const old = [
      ...this.contexts,
      ...this.pulseContexts,
      ...(this.beaconAlt ? [this.beaconAlt] : []),
    ];
    this.pulseContexts = VEHICLE_TYPES.map((t) =>
      drawShapes(new GraphicsContext(), vehicleOutline(t), this.palette, cellPx),
    );
    this.contexts = VEHICLE_TYPES.map((t) =>
      drawShapes(new GraphicsContext(), vehicleShapes(t, 0), this.palette, cellPx),
    );
    this.beaconAlt = drawShapes(
      new GraphicsContext(),
      vehicleShapes(VehicleType.Emergency, 1),
      this.palette,
      cellPx,
    );
    for (const v of this.vehicles.values()) v.root.destroy({ children: true });
    for (const v of this.pool) v.root.destroy({ children: true });
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
      // Ends that continue off-map through an edge are square: a rounded end reads as a dead end.
      for (const [open, from] of [
        [run.openStart, a0],
        [run.openEnd, a1 - r],
      ] as const) {
        if (!open) continue;
        if (run.axis === 'h') g.rect(from, c, r, w).fill(p.road);
        else g.rect(c, from, w, r).fill(p.road);
      }
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

  private drawHeat(): void {
    const g = this.heatLayer.clear();
    this.heatProgress.clear();
    if (!this.demand) return;
    const T = this.fit.tilePx;
    const bins = demandBins(this.demand, this.map.edges);
    const max = maxBin(bins);
    const p = this.palette;
    const ramp = [p.heat0, p.heat1, p.heat2, p.heat3, p.heat4];
    const gutter = HEAT_GUTTER_PX / T;
    for (const edge of this.map.edges) {
      const counts = bins.get(edge.id);
      if (!counts) continue;
      const r = stripRect(edge, GRID_WIDTH, GRID_HEIGHT, gutter);
      for (let b = 0; b < HEAT_BINS; b++) {
        const color = ramp[heatLevel(counts[b] ?? 0, max)] ?? p.heat0;
        const f0 = b / HEAT_BINS;
        const f1 = (b + 1) / HEAT_BINS;
        if (r.horizontal)
          g.rect((r.x + r.w * f0) * T, r.y * T, r.w * (f1 - f0) * T, r.h * T).fill(color);
        else g.rect(r.x * T, (r.y + r.h * f0) * T, r.w * T, r.h * (f1 - f0) * T).fill(color);
      }
    }
  }

  /** Dims the elapsed part of each heat-strip during Go. */
  private drawHeatProgress(tick: number): void {
    const g = this.heatProgress.clear();
    if (!this.demand || tick <= 0) return;
    const T = this.fit.tilePx;
    const gutter = HEAT_GUTTER_PX / T;
    const f = Math.min(1, tick / ROUND_TICKS);
    for (const edge of this.map.edges) {
      const r = stripRect(edge, GRID_WIDTH, GRID_HEIGHT, gutter);
      if (r.horizontal) g.rect(r.x * T, r.y * T, r.w * f * T, r.h * T);
      else g.rect(r.x * T, r.y * T, r.w * T, r.h * f * T);
    }
    g.fill({ color: this.palette.ground, alpha: 0.65 });
  }

  private takeView(): VehicleView {
    const pooled = this.pool.pop();
    if (pooled) return pooled;
    const root = new Container();
    const body = new Graphics();
    const pulse = new Graphics();
    root.addChild(body, pulse);
    return { root, body, pulse };
  }

  private frame(now: number): void {
    this.source?.update(now);
    const T = this.fit.tilePx;
    const cellPx = T / CELLS_PER_TILE;
    const tick = this.buffer.tick;
    if (tick < this.lastTick) this.gridlockAt = null; // a new round started
    if (tick !== this.lastTick) this.drawHeatProgress(tick);
    this.lastTick = tick;

    const gridlock = this.gridlockAt !== null;
    const [sx, sy] = gridlock ? shakeOffset(now - (this.gridlockAt ?? now), this.motion) : [0, 0];
    this.world.position.set(this.fit.originX + sx, this.fit.originY + sy);

    const n = this.buffer.sample(now, this.poses);
    const beacon = Math.floor(now / BEACON_MS) % 2 === 1;
    const pulse = pulseAlpha(now, this.motion);
    const trails = this.trailLayer.clear();
    let queued = 0;
    let trailing = 0;
    this.seen.clear();
    for (let i = 0; i < n; i++) {
      const pose = this.poses[i];
      if (!pose) continue;
      const ctx =
        pose.type === VehicleType.Emergency && beacon && this.beaconAlt
          ? this.beaconAlt
          : (this.contexts[pose.type] ?? this.contexts[0]);
      if (!ctx) continue;
      this.seen.add(pose.id);
      let v = this.vehicles.get(pose.id);
      if (!v) {
        v = this.takeView();
        this.vehicles.set(pose.id, v);
        this.vehicleLayer.addChild(v.root);
      }
      if (v.body.context !== ctx) v.body.context = ctx;
      const pctx = this.pulseContexts[pose.type] ?? this.pulseContexts[0];
      if (pctx && v.pulse.context !== pctx) v.pulse.context = pctx;
      v.root.position.set(pose.x * T, pose.y * T);
      v.root.rotation = pose.heading;

      const stopped = pose.speed === 0;
      if (stopped) queued++;
      v.body.tint = gridlock && stopped ? GRIDLOCK_TINT : 0xffffff;
      v.pulse.visible = stopped && !gridlock && pulse > 0;
      v.pulse.alpha = pulse;

      const cells = trailCells(pose.speed, this.motion);
      if (cells > 0) {
        trailing++;
        this.drawTrail(trails, pose, cells, cellPx, T);
      }
    }
    for (const [id, v] of this.vehicles) {
      if (this.seen.has(id)) continue;
      this.vehicles.delete(id);
      this.vehicleLayer.removeChild(v.root);
      this.pool.push(v);
    }
    this.drawn = this.seen.size;
    this.stats.vehicles = this.drawn;
    this.stats.queued = queued;
    this.stats.trails = trailing;
    this.stats.gridlock = gridlock;
  }

  /** 1–3 cell tapering streak behind the vehicle's tail, fading with distance (GDD §7). */
  private drawTrail(
    g: Graphics,
    pose: VehiclePose,
    cells: number,
    cellPx: number,
    T: number,
  ): void {
    const len = VEHICLE_LENGTH[pose.type as VehicleType] ?? 1;
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    const cx = pose.x * T;
    const cy = pose.y * T;
    for (const p of trailPieces(cells, len)) {
      const pts = [p.a0, -p.h0, p.a0, p.h0, p.a1, p.h1, p.a1, -p.h1];
      const out: number[] = [];
      for (let k = 0; k < pts.length; k += 2) {
        const x = (pts[k] ?? 0) * cellPx;
        const y = (pts[k + 1] ?? 0) * cellPx;
        out.push(cx + x * c - y * s, cy + x * s + y * c);
      }
      g.poly(out, true).fill({ color: this.palette.divider, alpha: p.alpha });
    }
  }
}

function safeWorld(make: () => World): World | null {
  try {
    return make();
  } catch {
    return null;
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
