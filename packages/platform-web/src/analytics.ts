import {
  createIngestClient,
  offIngestClient,
  PLATFORMS,
  type DeviceClass,
  type IngestClient,
  type IngestClientOptions,
  type Platform,
} from '@rushwarden/backend';

/**
 * Analytics wiring for the web build (P1-BE-01). Collection is OFF unless the build sets
 * `VITE_INGEST_URL` to an https URL. Public builds must not set it until the privacy policy is
 * published on the website (ADR-007); docs/setup/accounts.md says who flips it and when.
 */
export interface AnalyticsBuildEnv {
  VITE_INGEST_URL?: string | undefined;
  VITE_PORTAL?: string | undefined;
  VITE_APP_VERSION?: string | undefined;
}

/** Maps the portal build flag to the analytics `platform` field; our own site is `web`. */
export function platformFromFlag(flag: string | undefined): Platform {
  if (!flag || flag === 'none') return 'web';
  return (PLATFORMS as readonly string[]).includes(flag) ? (flag as Platform) : 'web';
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
  benchmarkMs: number,
  deps: Pick<IngestClientOptions, 'storage' | 'fetch' | 'randomUUID'> & { language?: string },
): IngestClient {
  const endpoint = env.VITE_INGEST_URL ?? '';
  if (!endpoint.startsWith('https://')) return offIngestClient;
  return createIngestClient({
    endpoint,
    platform: platformFromFlag(env.VITE_PORTAL),
    version: env.VITE_APP_VERSION || '0.0.0',
    locale: deps.language ?? 'und',
    deviceClass: deviceClassFromMs(benchmarkMs),
    ...deps,
  });
}
