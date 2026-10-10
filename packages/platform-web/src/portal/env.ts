import { loadScript, SDK_TIMEOUT_MS, type ScriptDocument } from './load-script.js';
import type { AdapterEnv } from './types.js';

// `Document` is structurally wider than `ScriptDocument` (appendChild is generic over Node).
/** The real browser environment: SDK globals on `globalThis`, scripts appended to `document`. */
export function browserEnv(): AdapterEnv {
  return {
    global: globalThis,
    loadScript: (url) => loadScript(url, document as unknown as ScriptDocument, SDK_TIMEOUT_MS),
    timeoutMs: SDK_TIMEOUT_MS,
    openWindow: (url) => {
      globalThis.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}
