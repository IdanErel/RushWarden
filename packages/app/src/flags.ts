/** Feature flags for launch-sensitive features (GDD section 6). */
export const flags = {
  dailyMode: false,
  cloudSync: false,
  shareVideo: false,
} as const;
export type FlagName = keyof typeof flags;
