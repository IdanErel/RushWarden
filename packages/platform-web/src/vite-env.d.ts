/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Portal build flag: none | itch | poki | crazygames (see src/portal/flag.ts). */
  readonly VITE_PORTAL?: string;
  /** Overrides the share URL for this build. */
  readonly VITE_SHARE_URL?: string;
  /** "1" in dev and e2e builds only: enables test hooks H1 and H4 (src/test-hooks.ts). */
  readonly VITE_TEST_HOOKS?: string;
}

interface ImportMetaEnv {
  /** Privacy policy URL (https) for the About screen; unset until published. Ignored on portals. */
  readonly VITE_PRIVACY_URL?: string;
}
