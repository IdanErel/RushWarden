/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `POST /ingest` URL. Unset (the default) means analytics is off. See src/analytics.ts. */
  readonly VITE_INGEST_URL?: string;
  /** Version reported in analytics events; set by the release build. */
  readonly VITE_APP_VERSION?: string;
}
