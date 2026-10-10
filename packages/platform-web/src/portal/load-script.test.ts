import { describe, expect, it } from 'vitest';
import { loadScript, type ScriptDocument, type ScriptElement } from './load-script.js';

function fakeDocument(outcome: 'load' | 'error' | 'hang') {
  const appended: ScriptElement[] = [];
  const doc: ScriptDocument = {
    createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
    head: {
      appendChild(node: ScriptElement) {
        appended.push(node);
        queueMicrotask(() => {
          if (outcome === 'load') node.onload?.call(node, {});
          if (outcome === 'error') node.onerror?.call(node, {});
        });
        return node;
      },
    },
  };
  return { doc, appended };
}

describe('loadScript', () => {
  it('appends one async script tag with the given URL and resolves on load', async () => {
    const { doc, appended } = fakeDocument('load');
    await loadScript('https://sdk.example/sdk.js', doc, 50);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ src: 'https://sdk.example/sdk.js', async: true });
  });

  it('rejects on a load error', async () => {
    const { doc } = fakeDocument('error');
    await expect(loadScript('https://sdk.example/x.js', doc, 50)).rejects.toThrow(/failed to load/);
  });

  it('rejects after the timeout when the script never loads', async () => {
    const { doc } = fakeDocument('hang');
    await expect(loadScript('https://sdk.example/x.js', doc, 10)).rejects.toThrow(/timed out/);
  });
});
