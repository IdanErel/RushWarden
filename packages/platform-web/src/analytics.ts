import {
  createIngestClient,
  type PortalAdapter,
  offIngestClient,
  type DeviceClass,
  type IngestClient,
  type IngestClientOptions,
  type Platform,
} from '@rushwarden/app';
import type { PrivacyControls } from '@rushwarden/ui';
import { NO_ANALYTICS_PORTALS, privacyUrlFrom } from './portal/flag.js';

/**
 * Analytics wiring for the web build (P1-BE-01). Collection is OFF unless the build sets
 * `VITE_INGEST_URL` to an https URL. Public builds must not set it until the privacy policy is
 * published on the website (ADR-007); docs/setup/accounts.md says who flips it and when.
 */
export interface AnalyticsBuildEnv {
  VITE_INGEST_URL?: string | undefined;
  /** Collection also needs the published policy (ADR-025 point 5); see `privacyUrlFrom`. */
  VITE_PRIVACY_URL?: string | undefined;
  VITE_APP_VERSION?: string | undefined;
}

/**
 * Maps the running portal adapter's `id` to the analytics `platform` field. The ids are the same
 * set; the no-portal adapter (`none`) is our own site, which reports as `web`.
 */
export function platformFromPortalId(id: PortalAdapter['id']): Platform {
  return id === 'none' ? 'web' : id;
}

/**
 * Device class from the boot benchmark (one headless sim round, GDD §10 "by benchmark").
 * Thresholds are provisional until real-device numbers exist (§11 device matrix).
 */
export function deviceClassFromMs(ms: number): DeviceClass {
  if (ms < 15) return 'high';
  if (ms < 60) return 'mid';
  return 'low';
}

export function startAnalytics(
  env: AnalyticsBuildEnv,
  portalId: PortalAdapter['id'],
  benchmarkMs: number,
  deps: Pick<IngestClientOptions, 'storage' | 'fetch' | 'randomUUID'> & { language?: string },
): IngestClient {
  const endpoint = env.VITE_INGEST_URL ?? '';
  if (!endpoint.startsWith('https://')) return offIngestClient;
  // ADR-025 point 5: no collection before the privacy policy is published and linked. The build
  // check fails such a build; this is the runtime backstop.
  if (privacyUrlFrom(env) === '') return offIngestClient;
  // Portal builds collect nothing (ADR-024 point 4, ADR-025 point 3), whatever the build sets.
  if ((NO_ANALYTICS_PORTALS as readonly string[]).includes(portalId)) return offIngestClient;
  return createIngestClient({
    endpoint,
    platform: platformFromPortalId(portalId),
    version: env.VITE_APP_VERSION || '0.0.0',
    locale: deps.language ?? 'und',
    deviceClass: deviceClassFromMs(benchmarkMs),
    ...deps,
  });
}

/**
 * The consent and Privacy panel surface for the run screen (#71, ADR-025): the client itself when
 * collection is on, nothing when it is off (no ingest URL, or a portal build), so the UI asks
 * nothing and shows no install ID.
 */
export function privacyControlsFor(client: IngestClient): PrivacyControls | undefined {
  return client === offIngestClient ? undefined : client;
}
