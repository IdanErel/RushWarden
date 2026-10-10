import { withTimeout } from './load-script.js';
import { browserEnv } from './env.js';
import {
  prop,
  safeCall,
  type AdapterEnv,
  type WebAdapterOptions,
  type WebPortalAdapter,
} from './types.js';

/** Official CrazyGames HTML5 SDK v3 URL (https://docs.crazygames.com/). Loaded at runtime, never bundled. */
export const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

/** The part of `window.CrazyGames.SDK.game` we call. We never touch `SDK.ad`. */
interface CrazyGame {
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  happytime(): void;
  inviteLink(params: Record<string, string>): string | Promise<string>;
}

interface CrazySdk {
  init(): Promise<unknown>;
  readonly environment?: string;
  readonly game: CrazyGame;
}

function asCrazySdk(value: unknown): CrazySdk | null {
  if (typeof prop(value, 'init') !== 'function') return null;
  const game = prop(value, 'game');
  const fns = ['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'happytime'];
  return fns.every((f) => typeof prop(game, f) === 'function') ? (value as CrazySdk) : null;
}

/**
 * CrazyGames adapter (GDD §9). Loads SDK v3 lazily in `init`, reports loading start/stop,
 * strictly alternating `gameplayStart`/`gameplayStop`, and `happytime` on a district win. Never
 * requests ads (ADR-010). CrazyGames has its own IAP, so `canSellInPortal` is true.
 */
export class CrazyGamesAdapter implements WebPortalAdapter {
  readonly id = 'crazygames' as const;
  private readonly env: AdapterEnv;
  private sdk: CrazySdk | null = null;
  private share: string;
  private playing = false;
  private loading = false;
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
      await this.env.loadScript(CRAZYGAMES_SDK_URL);
    } catch {
      return;
    }
    const sdk = asCrazySdk(prop(prop(this.env.global, 'CrazyGames'), 'SDK'));
    if (!sdk) return;
    try {
      await withTimeout(Promise.resolve(sdk.init()), this.env.timeoutMs, 'CrazyGames.SDK.init');
    } catch {
      return;
    }
    // "disabled" means we are not on a CrazyGames domain: behave like no portal.
    if (sdk.environment === 'disabled') return;
    this.sdk = sdk;
    this.loading = true;
    safeCall(() => sdk.game.loadingStart());
    if (typeof prop(sdk.game, 'inviteLink') === 'function') {
      try {
        const url = await withTimeout(
          Promise.resolve(sdk.game.inviteLink({})),
          this.env.timeoutMs,
          'CrazyGames inviteLink',
        );
        if (typeof url === 'string' && url.startsWith('https://')) this.share = url;
      } catch {
        // Keep the configured share URL.
      }
    }
  }

  loadingFinished(): void {
    const sdk = this.sdk;
    if (!sdk || !this.loading) return;
    this.loading = false;
    safeCall(() => sdk.game.loadingStop());
  }

  gameplayStart(): void {
    const sdk = this.sdk;
    if (!sdk || this.playing) return;
    this.loadingFinished(); // CrazyGames expects loading to be stopped before gameplay.
    this.playing = true;
    safeCall(() => sdk.game.gameplayStart());
  }

  gameplayStop(): void {
    const sdk = this.sdk;
    if (!sdk || !this.playing) return;
    this.playing = false;
    safeCall(() => sdk.game.gameplayStop());
  }

  /** No ads, ever (GDD §1 constraint 2): never calls `SDK.ad.requestAd`. */
  async commercialBreak(): Promise<void> {}

  happyTime(): void {
    const sdk = this.sdk;
    if (sdk) safeCall(() => sdk.game.happytime());
  }

  shareUrl(): string {
    return this.share;
  }

  canSellInPortal(): boolean {
    return true;
  }
}
