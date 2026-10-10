import type { WebPortalAdapter } from './portal/types.js';

/**
 * Test hooks H1 and H4 (`docs/release/phase-1-test-plan.md` §2.1, approved by the Lead).
 *
 * Active only in builds made with `VITE_TEST_HOOKS=1` (dev and e2e; `pnpm build:e2e`). Vite
 * inlines the flag, so public builds contain none of this behaviour: they ignore `?seed=` and
 * `?portalSpy=`, and expose nothing on `window`.
 */
export const TEST_HOOKS_ENABLED = import.meta.env.VITE_TEST_HOOKS === '1';

const U32_MAX = 0xffff_ffff;

/** H1: parses `?seed=<u32>` (decimal, 0 to 4294967295). Anything else is ignored. */
export function parseSeed(search: string): number | null {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= U32_MAX ? n : null;
}

/** H1: the run seed fixed by the URL in a hooks build, or null (use the normal seed). */
export function seedOverride(search: string, enabled = TEST_HOOKS_ENABLED): number | null {
  return enabled ? parseSeed(search) : null;
}

declare global {
  interface Window {
    /** H4 call log, present only in hooks builds. */
    __portalCalls?: PortalCall[];
  }
}

/** Portal identities the H4 spy can take (E2E-13 runs it for `poki` and `crazygames`). */
const SPY_IDS = ['poki', 'crazygames', 'itch'] as const;
type SpyId = (typeof SPY_IDS)[number];

/** Same `canSellInPortal` answers as the real adapters (GDD §9). */
// Mirrors each real adapter's canSellInPortal() (ADR-024: no unlock on Poki or CrazyGames).
const SELLS_IN_PORTAL: Record<SpyId, boolean> = { poki: false, crazygames: false, itch: true };

/** One recorded call, in order. `window.__portalCalls` holds these in hooks builds. */
export type PortalCall =
  | 'init'
  | 'loadingFinished'
  | 'gameplayStart'
  | 'gameplayStop'
  | 'commercialBreak'
  | 'happyTime'
  | 'shareUrl'
  | 'canSellInPortal';

/**
 * H4: a `PortalAdapter` that records every call in order into `calls`, then delegates to
 * `inner`. Used in hooks builds so a spec can check the §9 call pattern (commercialBreak before
 * and after a run, gameplayStart/Stop around every round, happyTime only on a win).
 */
export class SpyPortalAdapter implements WebPortalAdapter {
  constructor(
    private readonly inner: WebPortalAdapter,
    readonly calls: PortalCall[],
  ) {}

  get id(): WebPortalAdapter['id'] {
    return this.inner.id;
  }

  init(): Promise<void> {
    this.calls.push('init');
    return this.inner.init();
  }
  loadingFinished(): void {
    this.calls.push('loadingFinished');
    this.inner.loadingFinished();
  }
  gameplayStart(): void {
    this.calls.push('gameplayStart');
    this.inner.gameplayStart();
  }
  gameplayStop(): void {
    this.calls.push('gameplayStop');
    this.inner.gameplayStop();
  }
  commercialBreak(): Promise<void> {
    this.calls.push('commercialBreak');
    return this.inner.commercialBreak();
  }
  happyTime(): void {
    this.calls.push('happyTime');
    this.inner.happyTime();
  }
  shareUrl(): string {
    this.calls.push('shareUrl');
    return this.inner.shareUrl();
  }
  canSellInPortal(): boolean {
    this.calls.push('canSellInPortal');
    return this.inner.canSellInPortal();
  }
}

/** A stand-in portal with a given identity and no SDK, for `?portalSpy=<id>`. */
class StandInPortal implements WebPortalAdapter {
  constructor(
    readonly id: SpyId,
    private readonly url: string,
  ) {}
  async init(): Promise<void> {}
  loadingFinished(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async commercialBreak(): Promise<void> {}
  happyTime(): void {}
  shareUrl(): string {
    return this.url;
  }
  canSellInPortal(): boolean {
    return SELLS_IN_PORTAL[this.id];
  }
}

/**
 * H4: in a hooks build, wraps the build's adapter in a spy whose calls land on
 * `target.__portalCalls`. `?portalSpy=poki|crazygames|itch` swaps in a stand-in with that
 * portal's identity and no SDK, so the spec needs no real SDK and makes no network call.
 * Outside hooks builds it returns `adapter` unchanged.
 */
export function withPortalSpy(
  adapter: WebPortalAdapter,
  search: string,
  target: { __portalCalls?: PortalCall[] },
  enabled = TEST_HOOKS_ENABLED,
): WebPortalAdapter {
  if (!enabled) return adapter;
  const wanted = new URLSearchParams(search).get('portalSpy');
  const inner =
    wanted && (SPY_IDS as readonly string[]).includes(wanted)
      ? new StandInPortal(wanted as SpyId, adapter.shareUrl())
      : adapter;
  const calls: PortalCall[] = [];
  target.__portalCalls = calls;
  return new SpyPortalAdapter(inner, calls);
}
