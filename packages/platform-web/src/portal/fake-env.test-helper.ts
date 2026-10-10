import type { AdapterEnv } from './types.js';

/** A fake browser for adapter tests: records loaded URLs and calls, and installs SDK globals. */
export interface FakeEnv extends AdapterEnv {
  readonly global: Record<string, unknown>;
  readonly loaded: string[];
  readonly calls: string[];
}

/**
 * `install` runs when the script "loads" and puts the fake SDK on `global`, as the real script
 * would. `fail` makes the script load fail (ad blocker, offline). `top`/`parent` throw, as a
 * cross-origin parent frame would, so any adapter that touches them fails the test.
 */
export function fakeEnv(
  install: (global: Record<string, unknown>, calls: string[]) => void,
  opts: { fail?: boolean; timeoutMs?: number } = {},
): FakeEnv {
  const calls: string[] = [];
  const loaded: string[] = [];
  const global: Record<string, unknown> = {};
  for (const key of ['top', 'parent', 'opener']) {
    Object.defineProperty(global, key, {
      get() {
        throw new Error(`SecurityError: adapter touched window.${key}`);
      },
    });
  }
  return {
    global,
    loaded,
    calls,
    timeoutMs: opts.timeoutMs ?? 50,
    async loadScript(url) {
      loaded.push(url);
      if (opts.fail) throw new Error('blocked');
      install(global, calls);
    },
  };
}
