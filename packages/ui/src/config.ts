/**
 * Settings the platform layer passes in. `privacyUrl` is set by config and empty until Idan
 * publishes the policy (P1-BE-02); the About screen then shows "coming soon" without a link.
 */
export interface UiConfig {
  /** Privacy policy URL; empty string = not published yet. */
  readonly privacyUrl: string;
  /** Link appended to the share line; empty for none. */
  readonly shareUrl: string;
  /**
   * Opens an outbound link through the portal (Poki requires `PokiSDK.openExternalLink` for every
   * link out; ADR-024). Unset: links open as plain `target="_blank"` anchors.
   */
  readonly openExternalLink?: (url: string) => void;
}

export const DEFAULT_CONFIG: UiConfig = { privacyUrl: '', shareUrl: '' };

/**
 * The per-install random UUID (GDD §10), owned by the analytics client in `@rushwarden/app`
 * (`createIngestClient(...).install`). Returns null when collection is off: the off client
 * creates no ID, and the UI never makes one of its own.
 */
export type InstallIdProvider = () => string | null;

/** The audio surface the UI uses (satisfied by `AudioEngine` from @rushwarden/audio). */
export interface SoundControl {
  readonly muted: boolean;
  /** Call only from inside the toggle's own click/tap/key handler (AUD note on PR #15). */
  setSoundOnFromGesture(on: boolean): boolean;
}
