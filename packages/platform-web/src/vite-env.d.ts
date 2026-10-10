/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Portal build flag: none | itch | poki | crazygames (see src/portal/flag.ts). */
  readonly VITE_PORTAL?: string;
  /** Overrides the share URL for this build. */
  readonly VITE_SHARE_URL?: string;
}
