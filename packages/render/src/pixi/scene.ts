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
  jamRipple,
  pulseAlpha,
  shakeOffset,
  stripRect,
  trailCells,
  trailPieces,
  type MotionPrefs,
} from '../effects.js';
import { drawShapes } from './draw.js';
import { JamTracer, type JamOrigin } from '../jam.js';
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

/**
 * A placed card shown on the map, drawn above the traffic so it stays readable during Go (#81):
 * an outline in its tag colour around the target (the whole run for `span`) and a badge.
 */
export interface PlacedMark {
  readonly target: TargetMark;
  /** 0xRRGGBB, e.g. the card's tag colour. */
  readonly color: number;
  /** A segment card's whole straight run, end tiles inclusive; outlined instead of one tile. */
  readonly span?: {
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
  };
  /**
   * A direction of travel along a straight run of tiles (One-Way, GDD §4): an arrow from the
   * centre of `from` to the centre of `to`, drawn in `color`.
   */
  readonly arrow?: {
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
  };
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
  private readonly targetLayer = new Graphics();
  private readonly ghostLayer = new Graphics();
  /** Placed-card outlines, badges and One-Way arrows: above the traffic. */
  private readonly markLayer = new Graphics();
  /** The ring on the junction where a gridlock started: topmost. */
  private readonly jamLayer = new Graphics();
  /** The ripple spreading off the ring (redrawn by transform each frame, not re-tessellated). */
  private readonly jamRippleLayer = new Graphics();
  private readonly jam: JamTracer;
  private jamOrigin: JamOrigin | null = null;
  private targets: readonly TargetMark[] = [];
  private cursor: number | null = null;
  private ghost: ControllerMark | null = null;
  private ghostArrow: GhostArrow | null = null;
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
    const layout = opts.layout ?? worldLaneLayout(buildWorld(opts.map));
    this.buffer = new SnapshotBuffer(layout);
    this.jam = new JamTracer(opts.map, layout);
    this.motion = { reducedMotion: opts.reducedMotion ?? false };
    this.fit = fitGrid(opts.width, opts.height, HEAT_GUTTER_PX);
    this.world.addChild(
      this.mapLayer,
      this.closureLayer,
      this.heatLayer,
      this.heatProgress,
      this.liveLayer,
      this.glyphLayer,
      this.targetLayer,
      this.ghostLayer,
      this.trailLayer,
      this.vehicleLayer,
      this.markLayer,
      this.jamRippleLayer,
      this.jamLayer,
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
    this.jam.push(snapshot);
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
    this.jam.setMap(map, layout);
    this.jamOrigin = null;
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
    this.jam.setMap(this.map, chosen ?? undefined);
    this.jamOrigin = null;
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
   * round (tick 0) clears it. On, it also rings the junction where the jam started (`JamTracer`
   * over the snapshots fed so far), so the player can trace it to a card (#81).
   */
  setGridlock(on: boolean, now = performance.now()): void {
    this.gridlockAt = on ? now : null;
    this.jamOrigin = on ? this.jam.origin() : null;
    this.drawJam();
  }

  /** The junction ringed after a gridlock, or null (no gridlock, or none could be traced). */
  get gridlockOrigin(): JamOrigin | null {
    return this.jamOrigin;
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
   * glyph at the cursor at half strength. `arrow` previews a directional card (One-Way) on the
   * cursor's road: the way traffic will run once it is placed (playtest U11). An empty list
   * clears it.
   */
  setTargets(
    targets: readonly TargetMark[],
    cursor: number | null = null,
    ghost: Omit<ControllerMark, 'x' | 'y'> | null = null,
    arrow: GhostArrow | null = null,
  ): void {
    this.targets = targets;
    this.ghostArrow = arrow;
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
    this.drawClosures();
    this.drawHeat();
    this.drawLive();
    this.drawGlyphs();
    this.drawTargets();
    this.drawMarks();
    this.drawJam();
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
    if (this.ghostArrow) {
      const a = this.ghostArrow;
      this.drawArrow(this.ghostLayer, a.from, a.to, a.color);
      this.ghostLayer.alpha = 0.8;
    }
  }

  private drawMarks(): void {
    const g = this.markLayer.clear();
    const T = this.fit.tilePx;
    const outline = this.palette.outline;
    const seen = new Map<string, number>();
    for (const m of this.marks) {
      const r = m.span ? spanRect(m.span) : targetTileRect(m.target, this.map);
      if (!r) continue;
      // Outline the target (not the district: that is the whole map) in the tag colour, over a
      // dark line so it reads on road, block and traffic alike.
      if (m.target.kind !== 'district') {
        const inset = T * 0.04;
        const [x, y, w, h] = [
          r.x * T + inset,
          r.y * T + inset,
          r.w * T - 2 * inset,
          r.h * T - 2 * inset,
        ];
        const width = Math.max(3, T * 0.07);
        g.roundRect(x, y, w, h, T * 0.14).stroke({ color: outline, width: width + 3, alpha: 0.8 });
        g.roundRect(x, y, w, h, T * 0.14).stroke({ color: m.color, width });
      }
      // A badge at the target's top-left corner; badges on the same target stack side by side.
      const k = targetKey(m.target);
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      const rad = Math.max(7, T * 0.15);
      const cx = r.x * T + rad + 2 + n * (rad * 2 + 2);
      const cy = r.y * T + rad + 2;
      g.circle(cx, cy, rad).fill(m.color).stroke({ color: outline, width: 2 });
      g.circle(cx, cy, rad * 0.4).fill(this.palette.glyph);
    }
    for (const m of this.marks) if (m.arrow) this.drawArrow(g, m.arrow.from, m.arrow.to, m.color);
  }

  /** A red ring round the junction where the gridlock started, over everything else. */
  /**
   * The gridlock-origin ring, built to never read as a card mark (reviewer-2, steam-run-3: a red
   * CHAOS outline sat beside it). Card marks are rounded squares in one tag colour; this is a
   * circle in a "target" stack (dark, light, red, light, dark) a third larger than a tile, with
   * a ripple spreading off it (none under reduced motion).
   */
  private drawJam(): void {
    const g = this.jamLayer.clear();
    const r = this.jamRippleLayer.clear();
    const o = this.jamOrigin;
    if (!o) return;
    const T = this.fit.tilePx;
    const p = this.palette;
    const [cx, cy] = [(o.x + 0.5) * T, (o.y + 0.5) * T];
    const rad = T * 0.68;
    const red = Math.max(5, T * 0.12);
    const light = Math.max(3, T * 0.06);
    g.circle(cx, cy, rad).stroke({ color: p.outline, width: red + 2 * light + 4 });
    g.circle(cx, cy, rad).stroke({ color: p.glyph, width: red + 2 * light });
    g.circle(cx, cy, rad).stroke({ color: p.signalRed, width: red });
    // The ripple: drawn once round (0, 0), then moved, scaled and faded in `frame`.
    r.circle(0, 0, rad).stroke({ color: p.signalRed, width: Math.max(3, T * 0.06) });
    r.position.set(cx, cy);
    r.alpha = 0;
  }

  /** A travel arrow from tile `a`'s centre to tile `b`'s, with a head at `b`. */
  private drawArrow(
    g: Graphics,
    a: { x: number; y: number },
    b: { x: number; y: number },
    color: number,
  ): void {
    const T = this.fit.tilePx;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) return;
    const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
    // Start and end a little inside the end tiles so the head sits on the road, not the junction.
    const [x0, y0] = [(a.x + 0.5 - ux * 0.3) * T, (a.y + 0.5 - uy * 0.3) * T];
    const [x1, y1] = [(b.x + 0.5 + ux * 0.3) * T, (b.y + 0.5 + uy * 0.3) * T];
    const w = Math.max(3, T * 0.12);
    const head = Math.max(8, T * 0.35);
    const [hx, hy] = [x1 - ux * head, y1 - uy * head];
    const outline = { color: this.palette.outline, width: 1.5, alpha: 0.9 };
    g.moveTo(x0, y0)
      .lineTo(hx, hy)
      .stroke({ color: this.palette.outline, width: w + 3, cap: 'round', alpha: 0.8 });
    g.moveTo(x0, y0).lineTo(hx, hy).stroke({ color, width: w, cap: 'round' });
    g.poly([
      x1,
      y1,
      hx - uy * head * 0.6,
      hy + ux * head * 0.6,
      hx + uy * head * 0.6,
      hy - ux * head * 0.6,
    ])
      .fill(color)
      .stroke(outline);
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
    if (tick < this.lastTick) {
      // A new round started.
      this.gridlockAt = null;
      if (this.jamOrigin) {
        this.jamOrigin = null;
        this.drawJam();
      }
    }
    if (tick !== this.lastTick) this.drawHeatProgress(tick);
    this.lastTick = tick;

    if (this.jamOrigin) {
      const { scale, alpha } = jamRipple(now, this.motion);
      this.jamRippleLayer.scale.set(scale);
      this.jamRippleLayer.alpha = alpha;
    }

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

/** A previewed travel arrow (One-Way before it is placed): tile to tile, in a tag colour. */
export interface GhostArrow {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly color: number;
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

/** The tile rect covering a straight run between two tiles, ends inclusive. */
function spanRect(span: NonNullable<PlacedMark['span']>): Rect {
  const x = Math.min(span.from.x, span.to.x);
  const y = Math.min(span.from.y, span.to.y);
  return {
    x,
    y,
    w: Math.abs(span.to.x - span.from.x) + 1,
    h: Math.abs(span.to.y - span.from.y) + 1,
  };
}
