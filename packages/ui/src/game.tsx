/**
 * The run screen and its overlays (GDD §8 screens 3, 4, 5, 7; minimal for the Phase 1 toy):
 * place phase with ghost preview and tap-to-undo, Go phase with throughput bar, hold for 2× and
 * pause, round result with the 3-card offer, run end with the text share line, plus the pause
 * menu (sound toggle), the analytics consent panel and the Privacy panel (ADR-025).
 *
 * Input: touch, mouse and keyboard (§8: 1–5, arrows, Enter, Space, Esc). Targets ≥ 44 px, text
 * ≥ 14 px. The map is the renderer's Pixi scene; the sim runs in a worker via `SimClient`.
 */
import { TAG_PITCH, exitPitch } from '@rushwarden/audio';
import { render } from 'preact';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'preact/hooks';
import {
  SimClient,
  TrafficScene,
  hitTarget,
  moveCursor,
  targetKey,
  type ControllerMark,
  type LaneLayout,
  type TargetMark,
  type WorkerLike,
} from '@rushwarden/render';
import {
  GRID_WIDTH,
  ROUND_TICKS,
  TICKS_PER_SECOND,
  type GridMap,
  type RoundInput,
  type RoundResult,
} from '@rushwarden/sim';
import {
  DEFAULT_CONFIG,
  portalRules,
  type PrivacyControls,
  type SoundControl,
  type UiConfig,
} from './config.js';
import { GLYPH_SIZE, cardGlyph } from './glyph.js';
import { stateAttributes } from './hooks.js';
import { t } from './i18n.js';
import { jamLine, type JamPoint } from './jam.js';
import { keyAction } from './keys.js';
import { ExitCounter } from './live.js';
import { EXIT_SOUND_GAP_MS, Throttle, createGameSound } from './sound.js';
import { fitNames } from './fit-text.js';
import { displayName } from './names.js';
import { nextSlots, sameSlots, slotViews, type Slots } from './slots.js';
import { fitMap, isRoomy, isWide, TURN_ALLOWANCE_PX, wideLayout } from './fit.js';
import type { PlacedCard, RoundOutcome, RunPort, RunState, UiCard } from './run/port.js';
import { MARK_GLYPH, copyText, shareLine, shareText } from './share.js';
import { TAG_COLOR, css } from './tags.js';
import { busyFactor, markLabel, readTipSeen, writeTipSeen } from './info.js';

export interface GameEvents {
  /** Go pressed; portal `gameplayStart` (GDD §9). */
  roundStart?(round: number): void;
  /** Round simulated; portal `gameplayStop`. */
  roundEnd?(outcome: RoundOutcome): void;
  /** Run finished; portal `happyTime` on a win, `commercialBreak` after. */
  runEnd?(state: RunState): void;
  /** Retry pressed; portal `commercialBreak` before the run. */
  runStart?(): void;
}

export interface GameOptions {
  readonly run: RunPort;
  readonly spawnWorker: () => WorkerLike;
  /**
   * Lane layout for the worker's snapshots. Defaults to the sim's own lanes; the dev page's fake
   * traffic passes `tileLaneLayout`.
   */
  readonly layout?: (map: GridMap) => LaneLayout;
  readonly config?: UiConfig;
  /**
   * The analytics client's consent surface (ADR-025). Pass it only when collection is on (an
   * itch or own-site build with `VITE_INGEST_URL`); omitted, the UI asks nothing.
   */
  readonly privacy?: PrivacyControls;
  /**
   * Opens the unlock screen (GDD §8 screen 11). Offered on the run end after a win. Never shown
   * on Poki or CrazyGames builds (ADR-024), whatever is passed.
   */
  readonly unlock?: () => void;
  /**
   * Sound (P1-AUD-01). Omitted: the screen makes its own (`createGameSound`: off until the player
   * turns it on, remembered in localStorage, started by a gesture). `null`: no sound at all.
   */
  readonly sound?: SoundControl | null;
  /** Render the H2/H5 test-hook node (dev and e2e builds). */
  readonly testHooks?: boolean;
  readonly reducedMotion?: boolean;
  readonly events?: GameEvents;
}

/** Keys that answer a result or run-end sheet are ignored this long after it opens (U2). */
export const SHEET_KEY_DELAY_MS = 800;

/** Why a map tap placed nothing (U5). */
function missNote(
  card: UiCard | undefined,
  hasTargets: boolean,
  map: GridMap,
  tile: { x: number; y: number },
): string {
  if (!card) return t('place.miss.noCard');
  if (!hasTargets) return t('place.miss.noTargets', { name: card.name });
  const kind = map.tiles[tile.y * GRID_WIDTH + tile.x]?.kind;
  if (card.directional && kind === 'road') return t('place.miss.short', { name: card.name });
  if (kind === 'block') return t('place.miss.block', { name: card.name });
  return t('place.miss', { name: card.name });
}

export function Game(props: GameOptions): preact.JSX.Element {
  const { run, events } = props;
  const config = props.config ?? DEFAULT_CONFIG;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // Created once for the screen's life (it binds the gesture and visibility listeners).
  const [sound] = useState<SoundControl | undefined>(() =>
    props.sound === null ? undefined : (props.sound ?? createGameSound()),
  );
  const exitSound = useRef(new Throttle(EXIT_SOUND_GAP_MS));
  // The sound this screen made itself is disposed with it: listeners off, AudioContext closed.
  useEffect(
    () => () => {
      if (props.sound === undefined) sound?.dispose?.();
    },
    [],
  );
  const s = run.state();

  const mapEl = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<TrafficScene | null>(null);
  const client = useRef<SimClient | null>(null);
  const counter = useRef(new ExitCounter());
  const [live, setLive] = useState(0);
  /** Whole seconds left in the Go phase's 15 (the round timer on the throughput bar). */
  const ROUND_SECONDS = ROUND_TICKS / TICKS_PER_SECOND;
  const [left, setLeft] = useState(ROUND_SECONDS);
  /** Where the last round's gridlock started (the scene's red ring), or null. */
  const [jam, setJam] = useState<JamPoint | null>(null);
  /** The cards placed when Go was pressed: their marks stay up through Go and the result. */
  const goPlaced = useRef<readonly PlacedCard[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [offerCursor, setOfferCursor] = useState(0);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState<'none' | 'pause' | 'privacy' | 'rules'>('none');
  // The one-time first-round tip (2 plays, 3 approvals, 5 rounds, the map's marks).
  const [tipSeen, setTipSeen] = useState(readTipSeen);
  /** The tip goes once the player acts (picks a card or presses Go), and does not come back. */
  const dismissTip = (): void => {
    if (tipSeen) return;
    writeTipSeen();
    setTipSeen(true);
  };
  // Where Rules' Close goes: the pause menu, or the run screen (the tip's link).
  const rulesBack = useRef<'none' | 'pause'>('pause');
  const openRules = (from: 'none' | 'pause'): void => {
    rulesBack.current = from;
    setMenu('rules');
  };
  // Where Privacy's Close goes: back to the pause menu, or to the run screen (consent panel link).
  const privacyBack = useRef<'none' | 'pause'>('none');
  const openPrivacy = (from: 'none' | 'pause'): void => {
    privacyBack.current = from;
    setMenu('privacy');
  };
  const [toast, setToastText] = useState('');
  // A new key per note, so the same note twice runs its fade again.
  const [toastN, setToastN] = useState(0);
  const setToast = useCallback((m: string) => {
    setToastText(m);
    if (m) setToastN((n) => n + 1);
  }, []);
  /**
   * The run-ending round's own result sheet (U2): shown before the run end, so a gridlock still
   * gets its ring and line. Cleared by its Next button or by Retry.
   */
  const [finalResult, setFinalResult] = useState(false);
  // ADR-025: asked once, before the first Go; no answer means no (nothing stored, asked next time).
  const rules = portalRules(config.portal);
  const privacy = rules.analytics ? props.privacy : undefined;
  const [askConsent, setAskConsent] = useState(privacy?.consent === null);

  // --- Map size: fit the column to the viewport (no page scroll on desktop landscape) --------
  const rootEl = useRef<HTMLDivElement>(null);
  const mapSize = useRef({ width: 0, height: 0 });
  /** Height of the controls under the map at the start of a turn (nothing selected or placed). */
  const baseline = useRef(0);
  // GDD §8 "landscape rearranges HUD to the right": on a wide screen the board sits on the left
  // at full height and the HUD, controls and hand form a right column.
  const [wide, setWide] = useState(() => isWide(window.innerWidth, window.innerHeight));
  // Tall landscape: the hand as 3 + 2 larger cards with their rules text (fills the column).
  const [roomy, setRoomy] = useState(() => isRoomy(window.innerWidth, window.innerHeight));
  const side = wide ? wideLayout(window.innerWidth, window.innerHeight).side : 0;
  const measureMap = (): { width: number; height: number } => {
    // The landscape board's size depends only on the viewport, never on the controls beside it.
    if (isWide(window.innerWidth, window.innerHeight))
      return wideLayout(window.innerWidth, window.innerHeight).map;
    const root = rootEl.current;
    const el = mapEl.current;
    let above = 0;
    let below = 0;
    let after = false;
    for (const child of Array.from(root?.children ?? [])) {
      if (child === el) {
        after = true;
        continue;
      }
      const pos = getComputedStyle(child).position;
      if (pos === 'absolute' || pos === 'fixed') continue;
      const h = (child as HTMLElement).offsetHeight;
      if (after) below += h;
      else above += h;
    }
    const st = run.state();
    if (st.phase === 'place' && st.placed.length === 0) baseline.current = below;
    // Room for what a turn adds under the map (a row of placed-card chips, a longer card text),
    // so the map keeps one size through the turn and taps land where they were aimed.
    const reserve = Math.max(baseline.current, below) + TURN_ALLOWANCE_PX;
    return fitMap(el?.clientWidth ?? 0, window.innerHeight - above - reserve);
  };
  const fit = (): void => {
    if (!scene) return;
    const next = measureMap();
    const cur = mapSize.current;
    if (next.width === cur.width && next.height === cur.height) return;
    mapSize.current = next;
    scene.resize(next.width, next.height);
    bump(0); // H5 target rects come from the scene's new fit
  };
  // Once the scene exists, at the start of every round, when the window changes size, and after
  // a switch between portrait and landscape has rendered; never in the middle of a turn.
  useEffect(fit, [scene, s.round, s.phase === 'place', wide]);
  // One listener for the screen's life; it calls the latest `fit` (which closes over `scene`).
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const onResize = (): void => {
      setWide(isWide(window.innerWidth, window.innerHeight));
      setRoomy(isRoomy(window.innerWidth, window.innerHeight));
      fitRef.current();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Card names sized to their cards (fit-text.ts), before paint and before the map is fitted to
  // what is left. Redone only when the cards shown or the layout change.
  useLayoutEffect(() => {
    const root = rootEl.current;
    if (!root) return;
    for (const group of Array.from(root.querySelectorAll<HTMLElement>('.rw-hand, .rw-offer'))) {
      const names = Array.from(group.querySelectorAll<HTMLElement>('.rw-name'));
      const key = `${window.innerWidth}x${window.innerHeight}:${names.map((n) => n.textContent).join('|')}`;
      if (group.dataset['fitted'] === key) continue;
      fitNames(names);
      group.dataset['fitted'] = key;
    }
  });

  // --- Scene and worker -----------------------------------------------------------------------
  useEffect(() => {
    const el = mapEl.current;
    if (!el) return;
    let disposed = false;
    let made: TrafficScene | null = null;
    const { width, height } = measureMap();
    mapSize.current = { width, height };
    const map = run.roundInput().map;
    void TrafficScene.create(el, {
      map,
      width,
      height,
      reducedMotion: props.reducedMotion ?? false,
      ...(props.layout ? { layout: props.layout(map) } : {}),
    }).then((sc) => {
      if (disposed) return sc.destroy();
      made = sc;
      sc.canvas.setAttribute('aria-hidden', 'true');
      const c = new SimClient(props.spawnWorker(), {
        onFrame: (f, now, controllers) => {
          sc.pushSnapshot(f, now);
          // Live signal phases, box occupancy and controller glyphs (ADR-020 point 10).
          if (controllers) sc.pushControllers(controllers);
          const n = counter.current.push(f);
          // One pluck per burst of exits, pitched by the best vehicle's score value (GDD §7).
          const exits = counter.current.exits;
          if (exits.length > 0 && exitSound.current.pass(performance.now()))
            sound?.play?.('vehicleExit', { pitch: exitPitch(Math.max(...exits)) });
          setLive((prev) => (prev === n ? prev : n));
          // Word 0 of a snapshot is its tick (SNAPSHOT_HEADER).
          const sec = Math.max(0, Math.ceil((ROUND_TICKS - (f[0] ?? 0)) / TICKS_PER_SECOND));
          setLeft((prev) => (prev === sec ? prev : sec));
        },
        onDone: (r: RoundResult) => {
          run.finishRound(r);
          if (r.gridlocked) {
            sc.setGridlock(true);
            const o = sc.gridlockOrigin;
            setJam(o ? { x: o.x, y: o.y } : null);
          }
          const st = run.state();
          // Gridlock has its own sting; otherwise the quota pass or fail.
          if (r.gridlocked) sound?.play?.('gridlock');
          else if (st.last) sound?.play?.(st.last.pass ? 'quotaPass' : 'quotaFail');
          if (st.last) events?.roundEnd?.(st.last);
          if (st.phase === 'end') {
            events?.runEnd?.(st);
            if (st.last) setFinalResult(true);
          }
          setSpeed(1);
          setPaused(false);
          setOfferCursor(0);
          bump(0);
        },
        onError: (m) => setToast(m),
      });
      sc.attach(c);
      client.current = c;
      setScene(sc);
    });
    return () => {
      disposed = true;
      client.current?.dispose();
      client.current = null;
      made?.destroy();
    };
    // The scene lives for the whole run screen: created once.
  }, []);

  // --- Derived place-phase data ---------------------------------------------------------------
  const targets: readonly TargetMark[] = useMemo(
    () => (s.phase === 'place' && selected !== null ? run.targets(selected) : []),
    // `s` is rebuilt every render; these fields are what the targets depend on.
    [s.phase, selected, s.placed.length, s.round, s.energy],
  );
  const selCard = selected !== null ? s.hand[selected] : undefined;

  // Fixed hand slots (U4): each card keeps its place and number key for the round; played cards
  // stay where they were, dimmed. A turn with nothing placed starts from the hand's own order.
  const slotsRef = useRef<Slots>([]);
  const handUids = s.hand.map((c) => c.uid);
  const playedUids = s.placed.map((p) => p.card.uid);
  if (s.phase === 'place') {
    const want =
      s.placed.length === 0 ? handUids : nextSlots(slotsRef.current, handUids, playedUids);
    if (!sameSlots(want, slotsRef.current)) slotsRef.current = want;
  }
  const slots = slotViews(slotsRef.current, handUids, playedUids);

  // A quota well above round 1's: say so before Go (the map is busier, not the rules harder).
  const busy = s.phase === 'place' ? busyFactor(s.quota, s.results) : null;

  const roundInput = useMemo(() => run.roundInput(), [run, s.round, s.phase === 'place']);

  // Each round: its map (content's templates), closures (Parade), demand heat-strips, and a lane
  // layout from `roundWorld` (ADR-023). Go sets it again with the placements (`go` below).
  const prepare = useCallback(
    (sc: TrafficScene, input: RoundInput) =>
      props.layout ? sc.setRound(input, props.layout(input.map)) : sc.setRound(input),
    [props.layout],
  );
  useEffect(() => {
    if (!scene || s.phase !== 'place') return;
    prepare(scene, roundInput);
    scene.setGridlock(false);
    setJam(null);
  }, [scene, s.phase, s.round, roundInput]);

  // Targets, ghost, placed marks and controller glyphs.
  useEffect(() => {
    if (!scene) return;
    const ghost = selCard?.controller
      ? { kind: selCard.controller, direction: 'n' as const }
      : null;
    scene.setTargets(targets, cursor, ghost);
    scene.setMarks(
      (s.phase === 'place' ? s.placed : goPlaced.current).map((p) => ({
        target: p.target,
        color: TAG_COLOR[p.card.tags[0] ?? 'FLOW'],
        // A road card outlines its whole run, so the run reads as one piece under traffic.
        ...(p.segment ? { span: p.segment } : {}),
        // One-Way shows which way it runs (GDD §4 "in the chosen direction").
        ...(p.card.directional && p.segment ? { arrow: p.segment } : {}),
      })),
    );
    const ctrl: ControllerMark[] = [];
    for (const p of s.placed)
      if (
        p.card.controller &&
        p.target.kind === 'intersection' &&
        p.card.controller !== 'uncontrolled'
      )
        ctrl.push({ x: p.target.x, y: p.target.y, kind: p.card.controller, direction: 'n' });
    scene.setControllers(ctrl);
  });

  // --- Actions --------------------------------------------------------------------------------
  const select = useCallback(
    (i: number) => {
      if (s.phase !== 'place' || !s.hand[i]) return;
      if (selected === i) {
        setSelected(null);
        setCursor(null);
        return;
      }
      setSelected(i);
      setCursor(run.targets(i).length > 0 ? 0 : null);
      dismissTip();
    },
    [s, selected, run],
  );

  const placeAt = useCallback(
    (idx: number) => {
      if (selected === null) return;
      const target = targets[idx];
      if (!target) return;
      const tag = s.hand[selected]?.tags[0];
      run.place(selected, target);
      sound?.play?.('cardPlace', { pitch: tag ? TAG_PITCH[tag] : 0 });
      setSelected(null);
      setCursor(null);
      bump(0);
    },
    [selected, targets, run, s],
  );

  const undo = useCallback(
    (i?: number) => {
      const n = i ?? s.placed.length - 1;
      if (n < 0 || !run.canUndo(n)) return;
      run.undo(n);
      bump(0);
    },
    [s, run],
  );

  /** Turns a placed One-Way round on its segment (the last one placed when `i` is omitted). */
  const flip = useCallback(
    (i?: number) => {
      let n = i ?? -1;
      if (i === undefined)
        for (let k = s.placed.length - 1; k >= 0 && n < 0; k--) if (run.canFlip(k)) n = k;
      if (n < 0 || !run.canFlip(n)) return;
      run.flip(n);
      bump(0);
    },
    [s, run],
  );

  // Go before the scene and the sim worker exist (they start async) is held, not dropped: the
  // button is disabled until then, and a Space press waits and starts the round when they are up.
  const goPending = useRef(false);
  const go = useCallback(() => {
    if (s.phase !== 'place') return;
    if (!client.current) {
      goPending.current = true;
      return;
    }
    goPending.current = false;
    dismissTip();
    const input = run.roundInput();
    goPlaced.current = s.placed;
    run.go();
    if (scene) prepare(scene, input);
    setAskConsent(false);
    setSelected(null);
    setCursor(null);
    counter.current.reset();
    setLive(0);
    setLeft(ROUND_SECONDS);
    setSpeed(1);
    scene?.setSpeed(1);
    client.current.setSpeed(1);
    // The round's 15 s count from the Go press, however late the next display frame is.
    client.current.start(input, performance.now());
    sound?.play?.('go');
    events?.roundStart?.(s.round);
    bump(0);
  }, [s, run, scene, events, prepare]);
  useEffect(() => {
    if (scene && goPending.current) go();
  }, [scene, go]);

  /** Sound on/off from a click, tap or key (a gesture, so turning it on can start audio). */
  const toggleSound = (): void => {
    if (!sound) return;
    sound.setSoundOnFromGesture(sound.muted);
    bump(0);
  };
  // `data-audio` follows the engine, which starts on a gesture outside Preact: until it has
  // started, re-render after each gesture so the hook and the toggle show the new state.
  const audioStarted = sound?.started ?? false;
  useEffect(() => {
    if (!sound || audioStarted) return;
    const after = (): void => {
      setTimeout(() => bump(0), 0);
    };
    const gestures = ['pointerdown', 'keydown', 'touchend', 'click'] as const;
    for (const g of gestures) window.addEventListener(g, after, { passive: true });
    return () => {
      for (const g of gestures) window.removeEventListener(g, after);
    };
  }, [sound, audioStarted]);

  const setFast = useCallback(
    (fast: boolean) => {
      if (s.phase !== 'go' || paused) return;
      const v = fast ? 2 : 1;
      setSpeed(v);
      client.current?.setSpeed(v);
      scene?.setSpeed(v);
    },
    [s.phase, paused, scene],
  );

  const pause = useCallback(() => {
    if (s.phase === 'go') {
      client.current?.pause();
      setPaused(true);
    }
    setMenu('pause');
  }, [s.phase]);

  /** Space in Go (U3): pause or resume the board without the menu. */
  const togglePause = useCallback(() => {
    if (s.phase !== 'go') return;
    if (paused) {
      client.current?.resume();
      setPaused(false);
    } else {
      client.current?.pause();
      setPaused(true);
      setSpeed(1);
      client.current?.setSpeed(1);
      scene?.setSpeed(1);
    }
  }, [s.phase, paused, scene]);

  const resume = useCallback(() => {
    setMenu('none');
    if (paused) {
      client.current?.resume();
      setPaused(false);
    }
  }, [paused]);

  const pick = useCallback(
    (i: number | null) => {
      run.pickOffer(i);
      bump(0);
    },
    [run],
  );

  const next = useCallback(() => {
    run.next();
    bump(0);
  }, [run]);

  const retry = useCallback(() => {
    setFinalResult(false);
    run.retry();
    events?.runStart?.();
    setSelected(null);
    setCursor(null);
    setLive(0);
    bump(0);
  }, [run, events]);

  // --- Map pointer: place, undo, hold for 2× --------------------------------------------------
  const onMapDown = (e: PointerEvent): void => {
    if (s.phase !== 'place' || !scene) return;
    // The canvas, not the map strip: a fitted map is narrower than the column and centred in it.
    const r = scene.canvas.getBoundingClientRect();
    const tile = scene.tileAtPoint(e.clientX - r.left, e.clientY - r.top);
    if (targets.length > 0) {
      const idx = hitTarget(targets, tile, scene.currentMap);
      if (idx >= 0) return placeAt(idx);
    }
    // Tap a placed card's target again to undo it (§8). District cards undo from their chip. A
    // One-Way turns round from its ⇄ chip button or R, so a second tap still means undo.
    if (tile) {
      const placedTargets = s.placed.map((p) => p.target);
      const hit = hitTarget(placedTargets, tile, scene.currentMap);
      if (hit >= 0 && placedTargets[hit]?.kind !== 'district') return undo(hit);
      // A tap that does nothing says why (U5).
      setToast(missNote(selCard, targets.length > 0, scene.currentMap, tile));
    }
  };

  // Hold anywhere for 2× (U6): any press outside a button, link or sheet, not just the map.
  const onRootDown = (e: PointerEvent): void => {
    if (s.phase !== 'go' || menu !== 'none') return;
    const el = e.target as Element | null;
    if (el?.closest('button, a, input, [role="dialog"]')) return;
    setFast(true);
  };
  const setFastRef = useRef(setFast);
  setFastRef.current = setFast;
  useEffect(() => {
    const up = (): void => setFastRef.current(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
    };
  }, []);

  // --- Keyboard -------------------------------------------------------------------------------
  // When the current result or run-end sheet appeared (U2's key delay).
  const sheetKey =
    s.phase === 'result' || s.phase === 'end'
      ? `${s.phase}:${s.round}:${s.history.length}:${finalResult}`
      : '';
  const sheetSeen = useRef('');
  const sheetAt = useRef(0);
  if (sheetKey !== sheetSeen.current) {
    sheetSeen.current = sheetKey;
    sheetAt.current = performance.now();
  }
  // The listener is added once and calls this render's handler. Re-adding it in a useEffect left a
  // gap after each render (effects run after paint) where a key reached the previous render's
  // handler: a second "1" right after the first re-selected card 1 instead of deselecting it.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
  onKey.current = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    // The run-ending round's result sheet reads keys like any result sheet.
    const phase = s.phase === 'end' && finalResult ? 'result' : s.phase;
    const a = keyAction(phase, e.key, menu !== 'none');
    if (!a) return;
    e.preventDefault();
    // A key already on its way when a sheet opens must not answer it (U2): Next, a card or Retry
    // need a press made after the sheet was up.
    if (
      (a.type === 'confirm' || a.type === 'skip' || a.type === 'select') &&
      (phase === 'result' || phase === 'end') &&
      performance.now() - sheetAt.current < SHEET_KEY_DELAY_MS
    )
      return;
    switch (a.type) {
      case 'select':
        if (s.phase === 'result') setOfferCursor(a.index);
        else {
          // Number keys name slots (U4), not hand positions; a played card's key does nothing.
          const v = slots[a.index];
          if (v?.kind === 'hand') select(v.handIndex);
        }
        break;
      case 'cursor':
        if (s.phase === 'result') {
          const n = s.offer?.length ?? 0;
          if (n) setOfferCursor((c) => (c + (a.dir === 'e' ? 1 : n - 1)) % n);
        } else if (scene && targets.length)
          setCursor(moveCursor(targets, cursor, a.dir, scene.currentMap));
        break;
      case 'confirm':
        if (s.phase === 'place' && cursor !== null) placeAt(cursor);
        else if (phase === 'result' && s.phase === 'end') setFinalResult(false);
        else if (s.phase === 'result') {
          if (s.offer) pick(offerCursor);
          else next();
        } else if (s.phase === 'end') retry();
        break;
      case 'go':
        go();
        break;
      case 'flip':
        flip();
        break;
      case 'undo':
        if (selected !== null) {
          setSelected(null);
          setCursor(null);
        } else undo();
        break;
      case 'pause':
        if (menu !== 'none') resume();
        else pause();
        break;
      case 'skip':
        if (s.phase === 'end') setFinalResult(false);
        else if (s.offer) pick(null);
        else next();
        break;
      case 'togglePause':
        togglePause();
        break;
      case 'mute':
        toggleSound();
        break;
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // --- Test hooks (H2, H5) --------------------------------------------------------------------
  const hookAttrs = props.testHooks
    ? stateAttributes(s, {
        speed,
        paused,
        throughput: s.phase === 'go' ? live : (s.last?.throughput ?? 0),
        targetRects: scene
          ? targets.flatMap((tg) => {
              const r = scene.targetRect(tg);
              return r ? [{ ...r, key: targetKey(tg) }] : [];
            })
          : [],
        selected,
        cursor,
        gridlockOrigin: jam,
        audio: sound ? (sound.started ? 'started' : 'idle') : 'none',
        muted: sound ? sound.muted : true,
        live: scene?.liveControllers ?? [],
        reducedMotion: props.reducedMotion ?? false,
      })
    : null;

  const pct = Math.min(
    100,
    Math.round(((s.phase === 'go' ? live : 0) / Math.max(1, s.quota)) * 100),
  );

  return (
    <div
      class={`rw-game${wide ? ' rw-wide' : ''}${wide && roomy ? ' rw-roomy' : ''}`}
      style={wide ? { '--side': `${side}px` } : undefined}
      ref={rootEl}
      onPointerDown={onRootDown}
      onContextMenu={(e) => {
        // A long press for 2× on a phone must not open the context menu.
        if (s.phase === 'go') e.preventDefault();
      }}
    >
      {hookAttrs && <div id="game-state" hidden {...hookAttrs} />}
      <h2 class="rw-sr">
        {t('hud.round', { round: s.round, rounds: s.rounds })}
        {s.rush ? ` · ${s.event ? t(`event.${s.event}`) : t('hud.rush')}` : ''}
      </h2>
      <header class="rw-hud">
        {/* On a phone an event name takes the word "Round"'s room; screen readers get the whole
            line from the hidden heading before the HUD. */}
        <span class={`rw-round${s.event ? ' rw-has-event' : ''}`} aria-hidden="true">
          <span class="rw-round-word">{t('hud.roundWord')} </span>
          {t('hud.roundNum', { round: s.round, rounds: s.rounds })}
          {s.rush && <b class="rw-rush"> · {s.event ? t(`event.${s.event}`) : t('hud.rush')}</b>}
        </span>
        <span>{t('hud.quota', { quota: s.quota })}</span>
        <Pips
          n={s.approval}
          max={s.maxApproval}
          label={t('hud.approval', { n: s.approval, max: s.maxApproval })}
          kind="approval"
        />
        {sound && (
          <button
            class="rw-icon rw-sound"
            aria-label={t('sound.toggle')}
            aria-pressed={!sound.muted}
            onClick={toggleSound}
          >
            <SpeakerIcon on={!sound.muted} />
          </button>
        )}
        <button class="rw-icon" aria-label={t('hud.menu')} onClick={pause}>
          ☰
        </button>
      </header>
      <div class="rw-map" ref={mapEl} onPointerDown={onMapDown}>
        {s.phase === 'go' && paused && menu === 'none' && (
          <span class="rw-paused" role="status">
            {t('paused.board')}
          </span>
        )}
      </div>
      {s.phase === 'place' && (
        <section class="rw-place">
          <div class="rw-row">
            <Pips
              n={s.energy}
              max={s.maxEnergy}
              label={t('hud.energy', { n: s.energy, max: s.maxEnergy })}
              kind="energy"
            />
            <span class="rw-muted">{t('place.plays', { n: s.playsLeft })}</span>
            <span class="rw-grow" />
            <button class="rw-go" aria-label={t('go.label')} onClick={go} disabled={!scene}>
              {t('go')}
            </button>
          </div>
          <p class="rw-detail" aria-live="polite">
            {selCard
              ? targets.length
                ? `${selCard.text} ${t(selCard.directional ? 'place.hint.direction' : 'place.hint.target')}`
                : `${selCard.text} ${t('place.noTargets')}`
              : busy
                ? `${t('place.busy', { x: busy })} ${t('place.hint')}`
                : t('place.hint')}
          </p>
          {/* Always there, one row high, so placing or undoing never moves the hand (U1). */}
          <div class="rw-placed">
            {s.placed.map((p, i) => (
              <span key={`${p.card.id}-${targetKey(p.target)}`} class="rw-chip-group">
                <button
                  class="rw-chip"
                  style={{ borderColor: css(TAG_COLOR[p.card.tags[0] ?? 'FLOW']) }}
                  aria-label={t('place.undo', { name: p.card.name })}
                  disabled={!run.canUndo(i)}
                  onClick={() => undo(i)}
                >
                  ↶ {p.card.name}
                </button>
                {p.card.directional && (
                  <button
                    class="rw-chip rw-flip"
                    style={{ borderColor: css(TAG_COLOR[p.card.tags[0] ?? 'FLOW']) }}
                    aria-label={t('place.flip', { name: p.card.name })}
                    disabled={!run.canFlip(i)}
                    onClick={() => flip(i)}
                  >
                    ⇄
                  </button>
                )}
              </span>
            ))}
          </div>
          <div class="rw-hand" role="group" aria-label="Hand">
            {slots.map((v, i) => {
              if (v.kind === 'played') {
                const p = s.placed.find((q) => q.card.uid === v.uid);
                if (!p) return null;
                return (
                  <Card
                    key={`${s.round}-${i}`}
                    card={p.card}
                    index={i}
                    selected={false}
                    dim
                    played
                    label={t('card.played', { name: p.card.name })}
                    onClick={() => undefined}
                  />
                );
              }
              const c = s.hand[v.handIndex];
              if (!c) return null;
              return (
                <Card
                  key={`${s.round}-${i}`}
                  card={c}
                  index={i}
                  selected={selected === v.handIndex}
                  dim={c.cost > s.energy || s.playsLeft === 0}
                  onClick={() => select(v.handIndex)}
                />
              );
            })}
          </div>
        </section>
      )}
      {s.phase === 'go' && (
        <section class="rw-goph">
          <div
            class="rw-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={s.quota}
            aria-valuenow={live}
            aria-label={t('go.through', { n: live, quota: s.quota })}
          >
            <div class="rw-fill" style={{ width: `${pct}%` }} />
            {/* The round timer: a strip along the bar's foot that runs down over the 15 s. */}
            <div
              class="rw-clock"
              style={{ width: `${Math.round((left / ROUND_SECONDS) * 100)}%` }}
              aria-hidden="true"
            />
            <span>
              {t('go.through', { n: live, quota: s.quota })}
              <small class="rw-left" role="timer">
                {' · '}
                {t('go.left', { n: left })}
              </small>
            </span>
          </div>
          <div class="rw-row">
            <span class="rw-muted">{speed === 2 ? t('go.speed2') : t('go.hold')}</span>
            <span class="rw-grow" />
            {/* Pauses the board in place; ☰ and Esc open the menu. Hidden under the menu, whose
                own Resume answers then. */}
            {menu === 'none' && (
              <button class="rw-btn" onClick={togglePause} aria-pressed={paused}>
                {paused ? `▶ ${t('resume')}` : `❚❚ ${t('pause')}`}
              </button>
            )}
          </div>
        </section>
      )}
      {(s.phase === 'result' || (s.phase === 'end' && finalResult)) && s.last && (
        <Result
          outcome={s.last}
          jamText={jam ? jamLine(goPlaced.current, jam) : null}
          approval={s.approval}
          offer={s.phase === 'result' ? s.offer : null}
          showFunds={config.showFunds ?? false}
          nextLabel={s.phase === 'end' ? t('result.toRunEnd') : t('result.next')}
          cursor={offerCursor}
          onPick={pick}
          onNext={s.phase === 'end' ? () => setFinalResult(false) : next}
        />
      )}
      {!tipSeen &&
        !(askConsent && privacy) &&
        menu === 'none' &&
        s.phase === 'place' &&
        s.round === 1 && (
          <Tip
            state={s}
            onClose={dismissTip}
            onRules={() => {
              dismissTip();
              openRules('none');
            }}
          />
        )}
      {askConsent && privacy && s.phase === 'place' && (
        <Consent
          onAnswer={(yes) => {
            privacy.setConsent(yes);
            setAskConsent(false);
          }}
          onPrivacy={() => openPrivacy('none')}
        />
      )}
      {s.phase === 'end' && !finalResult && (
        <End
          state={s}
          shareUrl={config.shareUrl}
          unlock={rules.unlock ? props.unlock : undefined}
          onRetry={retry}
          onToast={setToast}
        />
      )}
      {menu === 'pause' && (
        <PauseMenu
          inGo={s.phase === 'go'}
          sound={sound}
          onResume={resume}
          onRules={() => openRules('pause')}
          onPrivacy={() => openPrivacy('pause')}
          onChange={() => bump(0)}
        />
      )}
      {menu === 'rules' && <Rules state={s} onClose={() => setMenu(rulesBack.current)} />}
      {menu === 'privacy' && (
        <Privacy
          privacyUrl={config.privacyUrl}
          openExternalLink={config.openExternalLink}
          privacy={privacy}
          onChange={() => {
            setAskConsent(false);
            bump(0);
          }}
          onToast={setToast}
          onClose={() => setMenu(privacyBack.current)}
        />
      )}
      {toast && (
        <div key={toastN} class="rw-toast" role="status" onAnimationEnd={() => setToast('')}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Pips(p: {
  n: number;
  max: number;
  label: string;
  kind: 'energy' | 'approval';
}): preact.JSX.Element {
  return (
    <span class={`rw-pips rw-${p.kind}`} role="img" aria-label={p.label}>
      {Array.from({ length: p.max }, (_, i) => (
        <i key={i} class={i < p.n ? 'on' : ''} />
      ))}
    </span>
  );
}

function Card(p: {
  card: UiCard;
  index: number;
  selected: boolean;
  dim: boolean;
  /** Played this round: stays in its slot, dimmed, and does nothing (U4). */
  played?: boolean;
  onClick: () => void;
  label?: string;
}): preact.JSX.Element {
  const c = p.card;
  const color = css(TAG_COLOR[c.tags[0] ?? 'FLOW']);
  return (
    <button
      class={`rw-card${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}${p.played ? ' played' : ''}`}
      style={{ borderColor: color }}
      aria-pressed={p.played ? undefined : p.selected}
      aria-disabled={p.played ? true : undefined}
      aria-label={
        p.label ??
        t('card.label', { name: c.name, cost: c.cost, tags: c.tags.join(' '), text: c.text })
      }
      onClick={p.onClick}
    >
      <span class="rw-key">{p.index + 1}</span>
      <span class="rw-cost">{c.cost}</span>
      <Glyph card={c} />
      <span class="rw-name">{displayName(c.name)}</span>
      {/* Shown on the larger landscape cards only; the accessible name already has it. */}
      <span class="rw-text" aria-hidden="true">
        {c.text}
      </span>
      <span class="rw-tag" style={{ color }}>
        {c.tags.join(' ')}
      </span>
      {p.played && (
        <span class="rw-played" aria-hidden="true">
          {t('card.playedTag')}
        </span>
      )}
    </button>
  );
}

/** The card's 48×48 glyph (GDD §7), generated from its primitives by `cardGlyph`. */
function Glyph(p: { card: UiCard }): preact.JSX.Element {
  return (
    <svg
      class="rw-glyph"
      width={GLYPH_SIZE}
      height={GLYPH_SIZE}
      viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`}
      aria-hidden="true"
      data-glyph={p.card.id}
    >
      {cardGlyph(p.card).map((el, i) => {
        const Tag = el.tag;
        return <Tag key={i} {...el.attrs} />;
      })}
    </svg>
  );
}

function Result(p: {
  outcome: RoundOutcome;
  /** After a gridlock: where it started (the scene's ring) and the card there, if any. */
  jamText: string | null;
  approval: number;
  offer: readonly UiCard[] | null;
  /** Funds earned and the skip's funds (hidden in Phase 1: no shop, E4). */
  showFunds: boolean;
  nextLabel: string;
  cursor: number;
  onPick: (i: number | null) => void;
  onNext: () => void;
}): preact.JSX.Element {
  const o = p.outcome;
  const title = o.gridlocked ? t('result.gridlock') : o.pass ? t('result.pass') : t('result.fail');
  return (
    <section class="rw-sheet" role="dialog" aria-labelledby="rw-result-title">
      <h2 id="rw-result-title" class={o.pass ? 'pass' : 'fail'}>
        {title}
      </h2>
      {o.gridlocked && p.jamText && <p class="rw-jam">{p.jamText}</p>}
      <p>{t('result.score', { n: o.throughput, quota: o.quota })}</p>
      {o.spawned !== undefined && o.exited !== undefined && (
        <p class="rw-muted">
          {t(o.gridlocked ? 'result.trafficJam' : 'result.traffic', {
            arrived: o.exited,
            left: Math.max(0, o.spawned - o.exited),
          })}
        </p>
      )}
      {o.pass ? (
        p.showFunds && <p>{t('result.funds', { n: o.fundsEarned })}</p>
      ) : (
        <p>{t('result.approval', { n: p.approval })}</p>
      )}
      {p.offer ? (
        <>
          <h3>{t('result.pick')}</h3>
          <div class="rw-offer">
            {p.offer.map((c, i) => (
              <div class="rw-offer-item" key={c.id}>
                <Card
                  card={c}
                  index={i}
                  selected={p.cursor === i}
                  dim={false}
                  label={`${t('result.take', { name: c.name })}. ${c.text}`}
                  onClick={() => p.onPick(i)}
                />
                <small>{c.text}</small>
              </div>
            ))}
          </div>
          <button class="rw-btn" onClick={() => p.onPick(null)}>
            {p.showFunds ? t('result.skip') : t('result.skipPlain')}
          </button>
        </>
      ) : (
        <button class="rw-go" onClick={p.onNext}>
          {p.nextLabel}
        </button>
      )}
    </section>
  );
}

function End(p: {
  state: RunState;
  shareUrl: string;
  unlock: (() => void) | undefined;
  onRetry: () => void;
  onToast: (m: string) => void;
}): preact.JSX.Element {
  const s = p.state;
  const line = shareLine(s.district, s.history, s.totalThroughput, p.shareUrl);
  return (
    <section class="rw-sheet" role="dialog" aria-labelledby="rw-end-title">
      <h2 id="rw-end-title" class={s.won ? 'pass' : 'fail'}>
        {s.won ? t('end.won') : t('end.lost')}
      </h2>
      <p>{t('end.summary', { rounds: s.history.length, n: s.totalThroughput })}</p>
      <table class="rw-rounds">
        <caption class="rw-sr">{t('end.table')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('end.col.round')}</th>
            <th scope="col">{t('end.col.through')}</th>
            <th scope="col">{t('end.col.result')}</th>
          </tr>
        </thead>
        <tbody>
          {s.results.map((o, i) => {
            const mark = s.history[i] ?? 'fail';
            return (
              <tr key={o.round}>
                <td>{o.round}</td>
                <td>{t('end.cell.through', { n: o.throughput, quota: o.quota })}</td>
                <td>
                  <span aria-hidden="true">{MARK_GLYPH[mark]} </span>
                  {markLabel(mark)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <pre class="rw-share" aria-label="Share text">
        {line}
      </pre>
      <p class="rw-legend">{t('end.legend')}</p>
      <div class="rw-row">
        <button
          class="rw-btn"
          onClick={() =>
            void shareText(line).then((how) => how === 'clipboard' && p.onToast(t('end.shared')))
          }
        >
          {t('end.share')}
        </button>
        <span class="rw-grow" />
        <button class="rw-go" onClick={p.onRetry}>
          {t('end.retry')}
        </button>
      </div>
      {s.won && p.unlock && (
        <button class="rw-btn" onClick={p.unlock}>
          {t('end.unlock')}
        </button>
      )}
    </section>
  );
}

function PauseMenu(p: {
  inGo: boolean;
  sound: SoundControl | undefined;
  onResume: () => void;
  onRules: () => void;
  onPrivacy: () => void;
  onChange: () => void;
}): preact.JSX.Element {
  return (
    <section class="rw-sheet rw-menu" role="dialog" aria-labelledby="rw-pause-title">
      <h2 id="rw-pause-title">{t('pause.title')}</h2>
      <button class="rw-go" onClick={p.onResume} autoFocus>
        {t('resume')}
      </button>
      {p.sound && (
        <button
          class="rw-btn"
          aria-pressed={!p.sound.muted}
          // Must run inside the click itself: browsers unlock audio only within a user gesture.
          onClick={() => {
            p.sound?.setSoundOnFromGesture(p.sound.muted);
            p.onChange();
          }}
        >
          {p.sound.muted ? t('sound.off') : t('sound.on')}
        </button>
      )}
      <button class="rw-btn" onClick={p.onRules}>
        {t('rules.open')}
      </button>
      <button class="rw-btn" onClick={p.onPrivacy}>
        {t('privacy.open')}
      </button>
    </section>
  );
}

/**
 * ADR-025 point 1: the opt-in question, non-blocking (the run screen stays usable), with two
 * buttons of equal size and style and a Privacy link.
 */
function Consent(p: {
  onAnswer: (yes: boolean) => void;
  onPrivacy: () => void;
}): preact.JSX.Element {
  return (
    <section class="rw-consent" role="region" aria-labelledby="rw-consent-title">
      <p>
        <b id="rw-consent-title">{t('consent.title')}</b> {t('consent.body')}
      </p>
      <div class="rw-row">
        <button class="rw-btn rw-answer" onClick={() => p.onAnswer(true)}>
          {t('consent.yes')}
        </button>
        <button class="rw-btn rw-answer" onClick={() => p.onAnswer(false)}>
          {t('consent.no')}
        </button>
        <button class="rw-link" onClick={p.onPrivacy}>
          {t('consent.privacy')}
        </button>
      </div>
    </section>
  );
}

/**
 * ADR-025 points 2 and 6: the policy link, the on/off switch, the install ID and "Delete my
 * data". Without `privacy` (collection off) it says the build collects nothing.
 */
function Privacy(p: {
  privacyUrl: string;
  openExternalLink: ((url: string) => void) | undefined;
  privacy: PrivacyControls | undefined;
  onChange: () => void;
  onToast: (m: string) => void;
  onClose: () => void;
}): preact.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);
  const pc = p.privacy;
  const install = pc?.install ?? null;
  const on = pc?.consent === 'yes';
  const copy = (): void => {
    if (!install) return;
    idRef.current?.select();
    void copyText(install).then(setCopied);
  };
  const remove = (): void => {
    if (!pc || deleting) return;
    setDeleting(true);
    void pc.deleteData().then((ok) => {
      setDeleting(false);
      p.onToast(ok ? t('privacy.deleted') : t('privacy.deleteFailed'));
      p.onChange();
    });
  };
  return (
    <section class="rw-sheet rw-menu" role="dialog" aria-labelledby="rw-privacy-title">
      <h2 id="rw-privacy-title">{t('privacy.title')}</h2>
      {pc ? (
        <>
          <p>{t('privacy.body')}</p>
          <button
            class="rw-btn rw-switch"
            role="switch"
            aria-checked={on}
            onClick={() => {
              pc.setConsent(!on);
              p.onChange();
            }}
          >
            {t('privacy.switch')}: {on ? t('privacy.on') : t('privacy.off')}
          </button>
          {install ? (
            <>
              <label class="rw-field">
                {t('privacy.installId')}
                <input
                  ref={idRef}
                  id="install-id"
                  readOnly
                  value={install}
                  onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
                />
              </label>
              <p class="rw-muted">{t('privacy.email')}</p>
              {pc.deletePending && <p class="rw-muted">{t('privacy.deletePending')}</p>}
              <div class="rw-row">
                <button class="rw-btn" onClick={copy}>
                  {copied ? t('privacy.copied') : t('privacy.copy')}
                </button>
                <button class="rw-btn" onClick={remove} disabled={deleting}>
                  {t('privacy.delete')}
                </button>
              </div>
            </>
          ) : (
            <p class="rw-muted">{t('privacy.noInstall')}</p>
          )}
        </>
      ) : (
        <p>{t('privacy.collectsNothing')}</p>
      )}
      {p.privacyUrl ? (
        <a
          class="rw-btn"
          href={p.privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            // Through the portal when it requires it (Poki); the anchor is the fallback.
            if (!p.openExternalLink) return;
            e.preventDefault();
            p.openExternalLink(p.privacyUrl);
          }}
        >
          {t('privacy.policy')}
        </a>
      ) : (
        <p class="rw-muted">{t('privacy.policyPending')}</p>
      )}
      <button class="rw-go" onClick={p.onClose}>
        {t('privacy.close')}
      </button>
    </section>
  );
}

/** Mounts the run screen into `el`; returns an unmount function. */
/** Speaker glyph for the HUD sound toggle: waves when on, a cross when off. */
function SpeakerIcon(p: { on: boolean }): preact.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3 8h4l5-4v14l-5-4H3z" fill="currentColor" />
      {p.on ? (
        <path
          d="M15 7.5a5 5 0 0 1 0 7M17.5 5a8.5 8.5 0 0 1 0 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      ) : (
        <path
          d="M15 8l5 6M20 8l-5 6"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      )}
    </svg>
  );
}

export function mountGame(el: HTMLElement, opts: GameOptions): () => void {
  render(<Game {...opts} />, el);
  return () => render(null, el);
}

/**
 * The rules on screen (playtest "goals and rules 3/10"): what a round is, what wins and loses,
 * and what the map's marks mean. Numbers come from the run's own settings.
 */
function RulesText(p: { state: RunState }): preact.JSX.Element {
  const s = p.state;
  return (
    <ul class="rw-rules">
      <li>{t('rules.round', { plays: s.maxPlays, energy: s.maxEnergy })}</li>
      <li>{t('rules.go', { seconds: ROUND_TICKS / TICKS_PER_SECOND })}</li>
      <li>{t('rules.lose', { approval: s.maxApproval })}</li>
      <li>{t('rules.win', { rounds: s.rounds })}</li>
      <li>
        <i class="rw-key-stripe" aria-hidden="true" /> {t('rules.stripes')}
      </li>
      <li>
        <i class="rw-key-closed" aria-hidden="true" /> {t('rules.closed')}
      </li>
    </ul>
  );
}

function Rules(p: { state: RunState; onClose: () => void }): preact.JSX.Element {
  return (
    <section class="rw-sheet rw-menu" role="dialog" aria-labelledby="rw-rules-title">
      <h2 id="rw-rules-title">{t('rules.title')}</h2>
      <RulesText state={p.state} />
      <button class="rw-go" onClick={p.onClose} autoFocus>
        {t('rules.close')}
      </button>
    </section>
  );
}

/** Shown once, at the first round of the first run on this device. */
function Tip(p: { state: RunState; onClose: () => void; onRules: () => void }): preact.JSX.Element {
  const s = p.state;
  return (
    <section class="rw-consent rw-tip" role="region" aria-labelledby="rw-tip-title">
      <p>
        <b id="rw-tip-title">{t('tip.title')}</b>{' '}
        {t('tip.body', { plays: s.maxPlays, approval: s.maxApproval, rounds: s.rounds })}
      </p>
      <p class="rw-muted">
        <i class="rw-key-stripe" aria-hidden="true" /> {t('tip.stripes')}
      </p>
      <div class="rw-row">
        <button class="rw-btn rw-answer" onClick={p.onClose}>
          {t('tip.ok')}
        </button>
        <button class="rw-link" onClick={p.onRules}>
          {t('rules.open')}
        </button>
      </div>
    </section>
  );
}
