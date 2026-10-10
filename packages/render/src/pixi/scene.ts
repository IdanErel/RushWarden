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
  type ControllerKind,
  type DemandProfile,
  type GridMap,
  type Side,
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
  trailAlpha,
  trailCells,
  type MotionPrefs,
} from '../effects.js';
import { drawShapes } from './draw.js';
import {
  rectToPx,
  targetKey,
  targetTileRect,
  tileFromPoint,
  type Rect,
  type TargetMark,
} from '../targets.js';

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

/** A placed card shown on the map: a small badge in its tag colour at the target. */
export interface PlacedMark {
  readonly target: TargetMark;
  /** 0xRRGGBB, e.g. the card's tag colour. */
  readonly color: number;
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
  private readonly glyphLayer = new Container();
  private readonly targetLayer = new Graphics();
  private readonly ghostLayer = new Graphics();
  private readonly markLayer = new Graphics();
  private targets: readonly TargetMark[] = [];
  private cursor: number | null = null;
  private ghost: ControllerMark | null = null;
  private marks: readonly PlacedMark[] = [];
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
      this.heatLayer,
      this.heatProgress,
      this.glyphLayer,
      this.markLayer,
      this.targetLayer,
      this.ghostLayer,
      this.trailLayer,
      this.vehicleLayer,
    );
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
    this.demand = null;
    this.gridlockAt = null;
    this.rebuild();
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

  /**
   * Highlights the valid targets for the selected card (GDD §8 "tap a card to see a ghost of its
   * effect on valid targets"), with `cursor` as the keyboard cursor. `ghost` previews a controller
   * glyph at the cursor at half strength. An empty list clears it.
   */
  setTargets(
    targets: readonly TargetMark[],
    cursor: number | null = null,
    ghost: Omit<ControllerMark, 'x' | 'y'> | null = null,
  ): void {
    this.targets = targets;
    this.cursor = cursor !== null && cursor >= 0 && cursor < targets.length ? cursor : null;
    const at = this.cursor !== null ? targets[this.cursor] : undefined;
    this.ghost =
      ghost && at && (at.kind === 'intersection' || at.kind === 'segment')
        ? { ...ghost, x: at.x, y: at.y }
        : null;
    this.drawTargets();
  }

  /** Badges for the cards placed this round. */
  setMarks(marks: readonly PlacedMark[]): void {
    this.marks = marks;
    this.drawMarks();
  }

  /** The tile under a point in canvas CSS px, or null outside the grid. */
  tileAtPoint(px: number, py: number): { x: number; y: number } | null {
    return tileFromPoint(px, py, this.fit);
  }

  /** A target's area in canvas CSS px (test hook H5 and touch hit areas). */
  targetRect(t: TargetMark): Rect | null {
    const r = targetTileRect(t, this.map);
    return r ? rectToPx(r, this.fit) : null;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get currentMap(): GridMap {
    return this.map;
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
    this.drawHeat();
    this.drawGlyphs();
    this.drawTargets();
    this.drawMarks();
    this.buildVehicleContexts();
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

  private drawTargets(): void {
    const g = this.targetLayer.clear();
    this.ghostLayer.clear();
    const T = this.fit.tilePx;
    const p = this.palette;
    this.targets.forEach((t, i) => {
      const r = targetTileRect(t, this.map);
      if (!r) return;
      const on = i === this.cursor;
      const inset = t.kind === 'district' ? 2 : T * 0.06;
      g.roundRect(r.x * T + inset, r.y * T + inset, r.w * T - 2 * inset, r.h * T - 2 * inset, 6)
        .fill({ color: p.glyph, alpha: on ? 0.22 : 0.1 })
        .stroke({ color: on ? p.outline : p.accent, width: on ? 3 : 2, alpha: on ? 1 : 0.9 });
    });
    if (this.ghost) {
      const { x, y } = this.ghost;
      const size = roadWidth(lanesAt(this.map, x, y) || 1) * T * 0.78;
      drawShapes(
        this.ghostLayer.context,
        controllerShapes(this.ghost.kind, this.ghost.direction),
        p,
        size,
        (x + 0.5) * T,
        (y + 0.5) * T,
      );
      this.ghostLayer.alpha = 0.55;
    }
  }

  private drawMarks(): void {
    const g = this.markLayer.clear();
    const T = this.fit.tilePx;
    const seen = new Map<string, number>();
    for (const m of this.marks) {
      const r = targetTileRect(m.target, this.map);
      if (!r) continue;
      // Stack badges on the same target side by side.
      const k = targetKey(m.target);
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      const rad = Math.max(4, T * 0.09);
      const cx = r.x * T + rad + 3 + n * (rad * 2 + 2);
      const cy = r.y * T + rad + 3;
      g.circle(cx, cy, rad).fill(m.color).stroke({ color: this.palette.outline, width: 1.5 });
    }
  }

  private drawGlyphs(): void {
    for (const c of this.glyphLayer.removeChildren()) c.destroy();
    const T = this.fit.tilePx;
    for (const { x, y } of intersections(this.map)) {
      const mark = this.controllers.get(tileIndex(x, y));
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

  /** 1–3 cell trail behind the vehicle's tail, fading with distance (GDD §7). */
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
    const half = cellPx * 0.18;
    const cx = pose.x * T;
    const cy = pose.y * T;
    for (let i = 0; i < cells; i++) {
      // Along-axis span of segment i, in px behind the head cell centre.
      const a0 = -(len - 0.5 + i) * cellPx;
      const a1 = a0 - cellPx * 0.9;
      const pts = [a0, -half, a0, half, a1, half, a1, -half];
      const out: number[] = [];
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k] ?? 0;
        const y = pts[k + 1] ?? 0;
        out.push(cx + x * c - y * s, cy + x * s + y * c);
      }
      g.poly(out, true).fill({ color: this.palette.divider, alpha: trailAlpha(i, cells) });
    }
  }
}
