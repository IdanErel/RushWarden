/**
 * PortalAdapter (GDD sections 6 and 9). The only way game code talks to Poki, CrazyGames, itch,
 * or a store shell. Implementations live in the platform packages; the game never imports an SDK.
 */
export interface PortalAdapter {
  /** Portal name, for analytics `platform` and for the unlock screen. */
  readonly id: 'poki' | 'crazygames' | 'itch' | 'web' | 'ios' | 'android' | 'steam' | 'none';
  /** Loads and initializes the SDK. Resolves even if the SDK fails, so the game always boots. */
  init(): Promise<void>;
  /** Called when a round's Go phase or placement begins (Poki/CrazyGames `gameplayStart`). */
  gameplayStart(): void;
  /** Called when the player leaves active play (round end, pause, menus). */
  gameplayStop(): void;
  /**
   * Required by portal SDKs before run start and after run end. We serve no ads, so
   * implementations resolve immediately once the SDK acknowledges. Never shows an ad.
   */
  commercialBreak(): Promise<void>;
  /** Celebration hook (CrazyGames `happytime`) on a district win. */
  happyTime(): void;
  /** URL to put in share cards and the share sheet for this surface. */
  shareUrl(): string;
  /** Whether the unlock can be bought inside this portal (false on Poki, which forbids it). */
  canSellInPortal(): boolean;
}

/** Adapter that does nothing; used in tests, the headless runner, and as a safe fallback. */
export class NullPortalAdapter implements PortalAdapter {
  readonly id = 'none' as const;
  constructor(private readonly url = 'https://example.invalid/') {}
  async init(): Promise<void> {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async commercialBreak(): Promise<void> {}
  happyTime(): void {}
  shareUrl(): string {
    return this.url;
  }
  canSellInPortal(): boolean {
    return false;
  }
}
