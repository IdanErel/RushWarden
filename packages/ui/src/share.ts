/**
 * The plain-text share line (GDD §5): legible in a chat, like Wordle's grid. The toy has no daily
 * number, so the line is `Rushwarden · Old Town · 🟩🟨🟥⬛🟩 · 412 through` plus the link.
 */
import type { RoundMark } from './run/port.js';

export const MARK_GLYPH: Readonly<Record<RoundMark, string>> = {
  pass: '🟩',
  near: '🟨',
  fail: '🟥',
  gridlock: '⬛',
};

export function shareLine(
  district: string,
  history: readonly RoundMark[],
  total: number,
  url = '',
): string {
  const strip = history.map((m) => MARK_GLYPH[m]).join('');
  const line = `Rushwarden · ${district} · ${strip} · ${total} through`;
  return url ? `${line}\n${url}` : line;
}

/** Web Share API, else clipboard (GDD §5). Returns how it was shared, or null on failure. */
export async function shareText(
  text: string,
  nav: Pick<Navigator, 'share' | 'clipboard'> | undefined = globalThis.navigator,
): Promise<'share' | 'clipboard' | null> {
  try {
    if (nav?.share) {
      await nav.share({ text });
      return 'share';
    }
  } catch {
    // Cancelled or not allowed: fall back to the clipboard.
  }
  try {
    if (nav?.clipboard) {
      await nav.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch {
    // No clipboard permission.
  }
  return null;
}

/** Copies `text` to the clipboard; false when the browser refuses. */
export async function copyText(
  text: string,
  nav: Pick<Navigator, 'clipboard'> | undefined = globalThis.navigator,
): Promise<boolean> {
  try {
    if (!nav?.clipboard) return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
