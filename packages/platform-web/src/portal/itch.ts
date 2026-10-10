import type { WebAdapterOptions, WebPortalAdapter } from './types.js';

/**
 * itch.io adapter (GDD §9). itch has no game SDK, so there is nothing to load and every hook is a
 * no-op. The unlock is sold through Stripe or itch's own store, so `canSellInPortal` is true.
 */
export class ItchAdapter implements WebPortalAdapter {
  readonly id = 'itch' as const;
  private readonly share: string;

  constructor(options: WebAdapterOptions) {
    this.share = options.shareUrl;
  }

  async init(): Promise<void> {}
  loadingFinished(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async commercialBreak(): Promise<void> {}
  happyTime(): void {}

  shareUrl(): string {
    return this.share;
  }

  canSellInPortal(): boolean {
    return true;
  }
}
