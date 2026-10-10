/** Outcome of a purchase or restore. Never throws for expected failures; returns `ok: false`. */
export type Result =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** `cancelled`: the player backed out. `unavailable`: this surface cannot sell. `failed`: anything else. */
      readonly reason: 'cancelled' | 'unavailable' | 'failed';
      readonly message?: string;
    };

export const OK: Result = { ok: true };
