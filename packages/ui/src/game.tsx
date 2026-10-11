/**
 * The run screen and its overlays (GDD §8 screens 3, 4, 5, 7; minimal for the Phase 1 toy):
 * place phase with ghost preview and tap-to-undo, Go phase with throughput bar, hold for 2× and
 * pause, round result with the 3-card offer, run end with the text share line, plus the pause
 * menu (sound toggle) and the About and privacy screen.
 *
 * Input: touch, mouse and keyboard (§8: 1–5, arrows, Enter, Space, Esc). Targets ≥ 44 px, text
 * ≥ 14 px. The map is the renderer's Pixi scene; the sim runs in a worker via `SimClient`.
 */
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
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
import type { GridMap, RoundResult } from '@rushwarden/sim';
import {
  DEFAULT_CONFIG,
  type InstallIdProvider,
  type SoundControl,
  type UiConfig,
} from './config.js';
import { stateAttributes } from './hooks.js';
import { t } from './i18n.js';
import { keyAction } from './keys.js';
import { ExitCounter } from './live.js';
import { fitMap, isWide, TURN_ALLOWANCE_PX, wideLayout } from './fit.js';
import type { RoundOutcome, RunPort, RunState, UiCard } from './run/port.js';
import { copyText, shareLine, shareText } from './share.js';
import { TAG_COLOR, css } from './tags.js';

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
  readonly installId?: InstallIdProvider;
  readonly sound?: SoundControl;
  /** Render the H2/H5 test-hook node (dev and e2e builds). */
  readonly testHooks?: boolean;
  readonly reducedMotion?: boolean;
  readonly events?: GameEvents;
}

export function Game(props: GameOptions): preact.JSX.Element {
  const { run, events } = props;
  const config = props.config ?? DEFAULT_CONFIG;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const s = run.state();

  const mapEl = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<TrafficScene | null>(null);
  const client = useRef<SimClient | null>(null);
  const counter = useRef(new ExitCounter());
  const [live, setLive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [offerCursor, setOfferCursor] = useState(0);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState<'none' | 'pause' | 'about'>('none');
  const [toast, setToast] = useState('');

  // --- Map size: fit the column to the viewport (no page scroll on desktop landscape) --------
  const rootEl = useRef<HTMLDivElement>(null);
  const mapSize = useRef({ width: 0, height: 0 });
  /** Height of the controls under the map at the start of a turn (nothing selected or placed). */
  const baseline = useRef(0);
  // GDD §8 "landscape rearranges HUD to the right": on a wide screen the board sits on the left
  // at full height and the HUD, controls and hand form a right column.
  const [wide, setWide] = useState(() => isWide(window.innerWidth, window.innerHeight));
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
      fitRef.current();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
        onFrame: (f, now) => {
          sc.pushSnapshot(f, now);
          const n = counter.current.push(f);
          setLive((prev) => (prev === n ? prev : n));
        },
        onDone: (r: RoundResult) => {
          run.finishRound(r);
          if (r.gridlocked) sc.setGridlock(true);
          const st = run.state();
          if (st.last) events?.roundEnd?.(st.last);
          if (st.phase === 'end') events?.runEnd?.(st);
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

  const roundInput = useMemo(() => run.roundInput(), [run, s.round, s.phase === 'place']);

  // Demand preview before Go; gridlock clears on a new round.
  useEffect(() => {
    if (!scene) return;
    if (s.phase === 'place') {
      // Each round's map comes from the run (content's templates); redraw it when it changes.
      const map = roundInput.map;
      if (scene.currentMap.id !== map.id) {
        if (props.layout) scene.setMap(map, props.layout(map));
        else scene.setMap(map);
      }
      scene.setGridlock(false);
      scene.setDemand(roundInput.demandProfile);
    }
  }, [scene, s.phase, s.round, roundInput]);

  // Targets, ghost, placed marks and controller glyphs.
  useEffect(() => {
    if (!scene) return;
    const ghost = selCard?.controller
      ? { kind: selCard.controller, direction: 'n' as const }
      : null;
    scene.setTargets(targets, cursor, ghost);
    scene.setMarks(
      s.placed.map((p) => ({
        target: p.target,
        color: TAG_COLOR[p.card.tags[0] ?? 'FLOW'],
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
    },
    [s, selected, run],
  );

  const placeAt = useCallback(
    (idx: number) => {
      if (selected === null) return;
      const target = targets[idx];
      if (!target) return;
      run.place(selected, target);
      setSelected(null);
      setCursor(null);
      bump(0);
    },
    [selected, targets, run],
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
    const input = run.roundInput();
    run.go();
    setSelected(null);
    setCursor(null);
    counter.current.reset();
    setLive(0);
    setSpeed(1);
    scene?.setSpeed(1);
    client.current.setSpeed(1);
    // The round's 15 s count from the Go press, however late the next display frame is.
    client.current.start(input, performance.now());
    events?.roundStart?.(s.round);
    bump(0);
  }, [s, run, scene, events]);
  useEffect(() => {
    if (scene && goPending.current) go();
  }, [scene, go]);

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
    run.retry();
    events?.runStart?.();
    setSelected(null);
    setCursor(null);
    setLive(0);
    bump(0);
  }, [run, events]);

  // --- Map pointer: place, undo, hold for 2× --------------------------------------------------
  const onMapDown = (e: PointerEvent): void => {
    if (s.phase === 'go') return setFast(true);
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
      if (hit >= 0 && placedTargets[hit]?.kind !== 'district') undo(hit);
    }
  };
  const onMapUp = (): void => setFast(false);

  // --- Keyboard -------------------------------------------------------------------------------
  // The listener is added once and calls this render's handler. Re-adding it in a useEffect left a
  // gap after each render (effects run after paint) where a key reached the previous render's
  // handler: a second "1" right after the first re-selected card 1 instead of deselecting it.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
  onKey.current = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = keyAction(s.phase, e.key, menu !== 'none');
    if (!a) return;
    e.preventDefault();
    switch (a.type) {
      case 'select':
        if (s.phase === 'result') setOfferCursor(a.index);
        else select(a.index);
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
        if (s.offer) pick(null);
        else next();
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
      })
    : null;

  const pct = Math.min(
    100,
    Math.round(((s.phase === 'go' ? live : 0) / Math.max(1, s.quota)) * 100),
  );

  return (
    <div
      class={wide ? 'rw-game rw-wide' : 'rw-game'}
      style={wide ? { '--side': `${side}px` } : undefined}
      ref={rootEl}
    >
      {hookAttrs && <div id="game-state" hidden {...hookAttrs} />}
      <header class="rw-hud">
        <span class="rw-round">
          {t('hud.round', { round: s.round, rounds: s.rounds })}
          {s.rush && <b class="rw-rush"> · {t('hud.rush')}</b>}
        </span>
        <span>{t('hud.quota', { quota: s.quota })}</span>
        <Pips
          n={s.approval}
          max={s.maxApproval}
          label={t('hud.approval', { n: s.approval, max: s.maxApproval })}
          kind="approval"
        />
        <button class="rw-icon" aria-label={t('hud.menu')} onClick={pause}>
          ☰
        </button>
      </header>
      <div
        class="rw-map"
        ref={mapEl}
        onPointerDown={onMapDown}
        onPointerUp={onMapUp}
        onPointerLeave={onMapUp}
        onPointerCancel={onMapUp}
      />
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
              : t('place.hint')}
          </p>
          {s.placed.length > 0 && (
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
          )}
          <div class="rw-hand" role="group" aria-label="Hand">
            {s.hand.map((c, i) => {
              const placed = s.placed.some((p) => p.card === c);
              return (
                <Card
                  key={`${s.round}-${i}`}
                  card={c}
                  index={i}
                  selected={selected === i}
                  dim={placed || c.cost > s.energy || s.playsLeft === 0}
                  onClick={() => select(i)}
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
            <span>{t('go.through', { n: live, quota: s.quota })}</span>
          </div>
          <div class="rw-row">
            <span class="rw-muted">{speed === 2 ? t('go.speed2') : t('go.hold')}</span>
            <span class="rw-grow" />
            <button class="rw-btn" aria-label={t('pause')} onClick={pause}>
              ❚❚ {t('pause')}
            </button>
          </div>
        </section>
      )}
      {s.phase === 'result' && s.last && (
        <Result
          outcome={s.last}
          approval={s.approval}
          offer={s.offer}
          cursor={offerCursor}
          onPick={pick}
          onNext={next}
        />
      )}
      {s.phase === 'end' && (
        <End state={s} shareUrl={config.shareUrl} onRetry={retry} onToast={setToast} />
      )}
      {menu === 'pause' && (
        <PauseMenu
          inGo={s.phase === 'go'}
          sound={props.sound}
          onResume={resume}
          onAbout={() => setMenu('about')}
          onChange={() => bump(0)}
        />
      )}
      {menu === 'about' && (
        <About
          privacyUrl={config.privacyUrl}
          openExternalLink={config.openExternalLink}
          installId={props.installId?.() ?? null}
          onClose={() => setMenu('pause')}
        />
      )}
      {toast && (
        <div class="rw-toast" role="status" onAnimationEnd={() => setToast('')}>
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
  onClick: () => void;
  label?: string;
}): preact.JSX.Element {
  const c = p.card;
  const color = css(TAG_COLOR[c.tags[0] ?? 'FLOW']);
  return (
    <button
      class={`rw-card${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}`}
      style={{ borderColor: color }}
      aria-pressed={p.selected}
      aria-label={
        p.label ??
        t('card.label', { name: c.name, cost: c.cost, tags: c.tags.join(' '), text: c.text })
      }
      onClick={p.onClick}
    >
      <span class="rw-key">{p.index + 1}</span>
      <span class="rw-cost">{c.cost}</span>
      <span class="rw-name">{c.name}</span>
      <span class="rw-tag" style={{ color }}>
        {c.tags.join(' ')}
      </span>
    </button>
  );
}

function Result(p: {
  outcome: RoundOutcome;
  approval: number;
  offer: readonly UiCard[] | null;
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
      <p>{t('result.score', { n: o.throughput, quota: o.quota })}</p>
      <p>
        {o.pass ? t('result.funds', { n: o.fundsEarned }) : t('result.approval', { n: p.approval })}
      </p>
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
            {t('result.skip')}
          </button>
        </>
      ) : (
        <button class="rw-go" onClick={p.onNext}>
          {t('result.next')}
        </button>
      )}
    </section>
  );
}

function End(p: {
  state: RunState;
  shareUrl: string;
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
      <pre class="rw-share" aria-label="Share text">
        {line}
      </pre>
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
    </section>
  );
}

function PauseMenu(p: {
  inGo: boolean;
  sound: SoundControl | undefined;
  onResume: () => void;
  onAbout: () => void;
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
      <button class="rw-btn" onClick={p.onAbout}>
        {t('about.open')}
      </button>
    </section>
  );
}

function About(p: {
  privacyUrl: string;
  openExternalLink: ((url: string) => void) | undefined;
  installId: string | null;
  onClose: () => void;
}): preact.JSX.Element {
  const [copied, setCopied] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);
  const copy = (): void => {
    if (!p.installId) return;
    idRef.current?.select();
    void copyText(p.installId).then(setCopied);
  };
  return (
    <section class="rw-sheet rw-menu" role="dialog" aria-labelledby="rw-about-title">
      <h2 id="rw-about-title">{t('about.title')}</h2>
      <p>{t('about.body')}</p>
      {p.installId ? (
        <>
          <label class="rw-field">
            {t('about.installId')}
            <input
              ref={idRef}
              id="install-id"
              readOnly
              value={p.installId}
              onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
            />
          </label>
          <button class="rw-btn" onClick={copy}>
            {copied ? t('about.copied') : t('about.copy')}
          </button>
        </>
      ) : (
        <p class="rw-muted">{t('about.installIdOff')}</p>
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
          {t('about.privacy')}
        </a>
      ) : (
        <p class="rw-muted">{t('about.privacyPending')}</p>
      )}
      <button class="rw-go" onClick={p.onClose}>
        {t('about.close')}
      </button>
    </section>
  );
}

/** Mounts the run screen into `el`; returns an unmount function. */
export function mountGame(el: HTMLElement, opts: GameOptions): () => void {
  render(<Game {...opts} />, el);
  return () => render(null, el);
}
