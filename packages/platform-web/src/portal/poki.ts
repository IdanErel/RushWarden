import { withTimeout } from './load-script.js';
import { browserEnv } from './env.js';
import {
  prop,
  safeCall,
  type AdapterEnv,
  type WebAdapterOptions,
  type WebPortalAdapter,
} from './types.js';

/** Official Poki HTML5 SDK v2 URL (https://sdk.poki.com/html5/). Loaded at runtime, never bundled. */
export const POKI_SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

/** The part of the global `PokiSDK` we call. We never call `commercialBreak` or `rewardedBreak`. */
interface PokiSdk {
  init(): Promise<unknown>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  shareableURL(params: Record<string, string>): Promise<string>;
}

function asPokiSdk(value: unknown): PokiSdk | null {
  const fns = ['init', 'gameLoadingFinished', 'gameplayStart', 'gameplayStop', 'shareableURL'];
  return fns.every((f) => typeof prop(value, f) === 'function') ? (value as PokiSdk) : null;
}

/**
 * Poki adapter (GDD §9). Loads the SDK lazily in `init`, keeps `gameplayStart`/`gameplayStop`
 * strictly alternating, and never shows ads: `commercialBreak` resolves without calling the SDK's
 * ad methods (ADR-013). Poki forbids external payments, so `canSellInPortal` is false.
 */
export class PokiAdapter implements WebPortalAdapter {
  readonly id = 'poki' as const;
  private readonly env: AdapterEnv;
  private sdk: PokiSdk | null = null;
  private share: string;
  private playing = false;
  private loaded = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: WebAdapterOptions) {
    this.env = options.env ?? browserEnv();
    this.share = options.shareUrl;
  }

  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      await this.env.loadScript(POKI_SDK_URL);
    } catch {
      return; // Blocked or offline: the game boots without the SDK.
    }
    const sdk = asPokiSdk(prop(this.env.global, 'PokiSDK'));
    if (!sdk) return;
    try {
      await withTimeout(Promise.resolve(sdk.init()), this.env.timeoutMs, 'PokiSDK.init');
    } catch {
      // Poki: init rejects under an ad blocker; the game must still load and report events.
    }
    this.sdk = sdk;
    try {
      const url = await withTimeout(
        Promise.resolve(sdk.shareableURL({})),
        this.env.timeoutMs,
        'PokiSDK.shareableURL',
      );
      if (typeof url === 'string' && url.startsWith('https://')) this.share = url;
    } catch {
      // Keep the configured share URL.
    }
  }

  loadingFinished(): void {
    const sdk = this.sdk;
    if (!sdk || this.loaded) return;
    this.loaded = true;
    safeCall(() => sdk.gameLoadingFinished());
  }

  gameplayStart(): void {
    const sdk = this.sdk;
    if (!sdk || this.playing) return;
    this.playing = true;
    safeCall(() => sdk.gameplayStart());
  }

  gameplayStop(): void {
    const sdk = this.sdk;
    if (!sdk || !this.playing) return;
    this.playing = false;
    safeCall(() => sdk.gameplayStop());
  }

  /** No ads, ever (GDD §1 constraint 2): the hook exists for the game flow but shows nothing. */
  async commercialBreak(): Promise<void> {}

  /** Poki's SDK v2 has no celebration event. */
  happyTime(): void {}

  shareUrl(): string {
    return this.share;
  }

  canSellInPortal(): boolean {
    return false;
  }
}
