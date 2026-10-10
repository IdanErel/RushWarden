import type { PortalAdapter } from '@rushwarden/app';

/**
 * A `PortalAdapter` as the web entry sees it. `loadingFinished` is web-only (Poki
 * `gameLoadingFinished`, CrazyGames `loadingStop`) and is called by `main.ts`, not by game code,
 * so the shared interface in `@rushwarden/app` does not change.
 */
export interface WebPortalAdapter extends PortalAdapter {
  /** Tells the portal the game finished loading and the first screen is interactive. */
  loadingFinished(): void;
}

/** Where an adapter finds the SDK global and how it loads the SDK script. Tests pass fakes. */
export interface AdapterEnv {
  /** The window-like object the SDK script installs its global on (`globalThis` in the browser). */
  readonly global: object;
  /** Loads the script at `url`; resolves when it has run. */
  loadScript(url: string): Promise<void>;
  /** How long to wait for the script and for SDK promises before booting without the SDK. */
  readonly timeoutMs: number;
}

/** Options every web adapter takes. */
export interface WebAdapterOptions {
  /** Share URL used when the portal does not give one (our own page, never the portal's top frame). */
  readonly shareUrl: string;
  /** Overrides for tests; the default uses `globalThis` and `document`. */
  readonly env?: AdapterEnv;
}

/** Reads a property from an unknown object without trusting its type. */
export function prop(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

/** Calls a portal SDK method and swallows any error, so a portal bug never stops the game. */
export function safeCall(fn: () => unknown): void {
  try {
    const out = fn();
    if (out instanceof Promise) out.catch(() => undefined);
  } catch {
    // Portal SDK errors must never break the game.
  }
}
