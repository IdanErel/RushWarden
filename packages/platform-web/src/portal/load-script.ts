/**
 * Loads a third-party SDK at runtime from its official URL by appending a `<script>` tag. SDKs are
 * never bundled (GDD §6, §9): the bundle contains only the URL string.
 *
 * Iframe-safe: it only touches the document the game runs in, never `window.top` or `parent`.
 */

/** The slice of `Document` the loader needs, so tests can pass a fake. */
export interface ScriptDocument {
  createElement(tag: 'script'): ScriptElement;
  readonly head: { appendChild(node: ScriptElement): unknown };
}

/** The slice of `HTMLScriptElement` the loader sets. */
export interface ScriptElement {
  src: string;
  async: boolean;
  onload: ((this: unknown, ev: unknown) => unknown) | null;
  onerror: ((this: unknown, ev: unknown) => unknown) | null;
}

/** Default time to wait for an SDK script or SDK call before giving up and booting without it. */
export const SDK_TIMEOUT_MS = 8000;

/** Rejects if `promise` has not settled after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Appends `<script async src=url>` to `doc.head`; resolves on load, rejects on error or timeout. */
export function loadScript(
  url: string,
  doc: ScriptDocument,
  timeoutMs: number = SDK_TIMEOUT_MS,
): Promise<void> {
  const loaded = new Promise<void>((resolve, reject) => {
    const script = doc.createElement('script');
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${url}`));
    script.src = url;
    doc.head.appendChild(script);
  });
  return withTimeout(loaded, timeoutMs, `loading ${url}`);
}
