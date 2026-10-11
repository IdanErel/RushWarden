/**
 * Settings the platform layer passes in. `privacyUrl` is set by config and empty until the policy
 * is live at https://rushwarden.com/privacy (ADR-025 point 5); the Privacy panel then shows
 * "coming soon" without a link.
 */
export interface UiConfig {
  /** Privacy policy URL; empty string = not published yet. */
  readonly privacyUrl: string;
  /** Link appended to the share line; empty for none. On a portal, the portal's own share URL. */
  readonly shareUrl: string;
  /**
   * Opens an outbound link through the portal (Poki requires `PokiSDK.openExternalLink` for every
   * link out; ADR-024). Unset: links open as plain `target="_blank"` anchors.
   */
  readonly openExternalLink?: (url: string) => void;
  /** The build's portal (`VITE_PORTAL`); omitted = `none` (own site, dev, e2e). */
  readonly portal?: UiPortal;
}

export const DEFAULT_CONFIG: UiConfig = { privacyUrl: '', shareUrl: '' };

/** Mirrors platform-web's `PortalFlag`. */
export type UiPortal = 'none' | 'itch' | 'poki' | 'crazygames';

export interface PortalRules {
  /** The unlock call to action may show (still only when the platform passes `unlock`). */
  readonly unlock: boolean;
  /**
   * Links other than the privacy policy and the share URL may show (website, itch, Steam,
   * stores). The UI has none yet; anything that adds one checks this.
   */
  readonly outboundLinks: boolean;
  /** The consent and Privacy controls may show; false = the build collects nothing (ADR-024 point 4). */
  readonly analytics: boolean;
}

/**
 * ADR-024 points 2, 3 and 5: Poki and CrazyGames builds show no unlock button, no price, no
 * purchase UI and no links but the portal's share URL and the privacy policy. They collect
 * nothing, so the UI ignores a consent surface passed by mistake.
 */
export function portalRules(portal: UiPortal = 'none'): PortalRules {
  const portalBuild = portal === 'poki' || portal === 'crazygames';
  return { unlock: !portalBuild, outboundLinks: !portalBuild, analytics: !portalBuild };
}

/**
 * The analytics consent surface the UI drives (ADR-025). Structurally the subset of
 * `IngestClient` from `@rushwarden/app` (P1-BE-01, PR #39) that the consent and Privacy panels
 * use, so the platform passes the client itself. Omit it when collection is off (portal builds,
 * or before `VITE_INGEST_URL` is set): the UI then asks nothing and shows no install ID.
 */
export interface PrivacyControls {
  /** The random install ID; null until the player says yes. */
  readonly install: string | null;
  /** The stored answer; null = never asked (or asked again after the collected data changed). */
  readonly consent: 'yes' | 'no' | null;
  /** Records the answer. No also deletes the local install ID. */
  setConsent(yes: boolean): void;
  /**
   * True while a "Delete my data" request has not gone through yet (the ID is kept and nothing is
   * sent); the panel says so and offers the delete again.
   */
  readonly deletePending?: boolean;
  /** "Delete my data": `DELETE /ingest/:install`, then deletes the local ID. False on failure. */
  deleteData(): Promise<boolean>;
}

/** The audio surface the UI uses (satisfied by `AudioEngine` from @rushwarden/audio). */
export interface SoundControl {
  readonly muted: boolean;
  /** Call only from inside the toggle's own click/tap/key handler (AUD note on PR #15). */
  setSoundOnFromGesture(on: boolean): boolean;
}
