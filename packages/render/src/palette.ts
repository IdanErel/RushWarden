/**
 * District palettes (GDD §7). Phase 1 ships only District 1, Old Town: warm stone and terracotta.
 * The §7 OKLCH generator (5 tints + 1 accent from two seed hues) replaces these hand-picked
 * values in Phase 2; the token names stay. Vehicle-on-road contrast is checked by a unit test
 * (WCAG AA for graphics, ≥ 3:1).
 */
export interface Palette {
  readonly ground: number;
  readonly block: number;
  readonly road: number;
  readonly intersection: number;
  readonly divider: number;
  readonly glyph: number;
  readonly signalRed: number;
  readonly signalAmber: number;
  readonly signalGreen: number;
  readonly stop: number;
  readonly outline: number;
  readonly vehicleBody: number;
  readonly accent: number;
  readonly taxi: number;
  readonly busBody: number;
  readonly busWindow: number;
  readonly truckBox: number;
  readonly truckCab: number;
  readonly emergencyBody: number;
  readonly beaconA: number;
  readonly beaconB: number;
  readonly bike: number;
  /** Queue pulse outline. */
  readonly pulse: number;
  /** Heat-strip ramp: 0 = no spawns in that second, 4 = the busiest second on the map. */
  readonly heat0: number;
  readonly heat1: number;
  readonly heat2: number;
  readonly heat3: number;
  readonly heat4: number;
}

export const OLD_TOWN: Palette = {
  ground: 0xefe6d8,
  block: 0xe0d0b8,
  road: 0x463c36,
  intersection: 0x564a42,
  divider: 0xd9cdbb,
  glyph: 0xf7f1e8,
  signalRed: 0xe0533d,
  signalAmber: 0xf2b33d,
  signalGreen: 0x52b86f,
  stop: 0xc9372b,
  outline: 0x1e1a17,
  vehicleBody: 0xf7f1e8,
  accent: 0xd9643a,
  taxi: 0xf2c230,
  busBody: 0x6cc3c8,
  busWindow: 0xe2f5f6,
  truckBox: 0xbba896,
  truckCab: 0xf7f1e8,
  emergencyBody: 0xffffff,
  beaconA: 0xe0533d,
  beaconB: 0x3d7be0,
  bike: 0xf2b33d,
  pulse: 0xffffff,
  heat0: 0xe0d0b8,
  heat1: 0xe9b98f,
  heat2: 0xe08f5f,
  heat3: 0xc65a33,
  heat4: 0x8c3218,
};

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a 0xRRGGBB colour. */
export function luminance(rgb: number): number {
  return (
    0.2126 * channel((rgb >> 16) & 255) +
    0.7152 * channel((rgb >> 8) & 255) +
    0.0722 * channel(rgb & 255)
  );
}

/** WCAG contrast ratio between two 0xRRGGBB colours, in [1, 21]. */
export function contrast(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
