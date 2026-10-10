import type { Result } from './result.js';

/** Where the unlock came from. `none` means not unlocked on any surface. */
export type EntitlementSource = 'steam' | 'ios' | 'android' | 'web' | 'none';

/**
 * Entitlement (GDD sections 6 and 9): the one receipt model behind every store. The game asks
 * only this interface whether "Full City" is unlocked; it never asks a store directly.
 * Implementations cache state locally and re-validate on launch when online.
 */
export interface Entitlement {
  /** Synchronous so UI can gate instantly; reflects the cached state. */
  isUnlocked(): boolean;
  /** Starts the platform purchase flow for the single non-consumable `full_city`. */
  purchase(): Promise<Result>;
  /** Restores a previous purchase (required by App Store and Play). */
  restore(): Promise<Result>;
  /** Which surface granted the current state. */
  readonly source: EntitlementSource;
}

/**
 * Locked entitlement for surfaces that cannot sell (and for tests). Purchase and restore
 * report `unavailable`. `DevEntitlement` below flips the unlock for local development only.
 */
export class LockedEntitlement implements Entitlement {
  readonly source: EntitlementSource = 'none';
  isUnlocked(): boolean {
    return false;
  }
  async purchase(): Promise<Result> {
    return { ok: false, reason: 'unavailable' };
  }
  async restore(): Promise<Result> {
    return { ok: false, reason: 'unavailable' };
  }
}

/** In-memory entitlement for development and tests; never shipped in a store build. */
export class DevEntitlement implements Entitlement {
  private unlocked = false;
  get source(): EntitlementSource {
    return this.unlocked ? 'web' : 'none';
  }
  isUnlocked(): boolean {
    return this.unlocked;
  }
  async purchase(): Promise<Result> {
    this.unlocked = true;
    return { ok: true };
  }
  async restore(): Promise<Result> {
    return this.unlocked
      ? { ok: true }
      : { ok: false, reason: 'failed', message: 'nothing to restore' };
  }
}
