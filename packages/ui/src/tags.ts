/**
 * Archetype tag colours (GDD §4 tags, §7 "card frames are flat with a 2-px tag-colored edge").
 * Each is ≥ 3:1 against the card face so the edge reads; tags are also written as text, so
 * colour is never the only signal (§7 accessibility).
 */
import type { Tag } from './run/port.js';

export const TAG_COLOR: Readonly<Record<Tag, number>> = {
  FLOW: 0x1f7f75,
  MASS: 0x2f63b8,
  TOLL: 0x9a6c00,
  CHAOS: 0xb83a24,
  TEMPO: 0x6e45ad,
};

export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
