/// <reference types="node" />
import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { Sim, sampleInput, type FromSimWorker } from '../src/index.js';

// Runs the handler in a real worker thread to prove frames survive transfer. Vitest's TS
// transform does not reach worker_threads, so the worker is bundled with esbuild in-process
// and loaded from a data: URL.

async function workerSource(): Promise<string> {
  const out = await build({
    stdin: {
      contents: `import { parentPort } from 'node:worker_threads';
        import { createSimWorkerHandler } from './src/index.ts';
        const handle = createSimWorkerHandler((m, t) => parentPort.postMessage(m, t));
        parentPort.on('message', handle);`,
      resolveDir: new URL('..', import.meta.url).pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return out.outputFiles[0]!.text;
}

describe('sim worker protocol over worker_threads', () => {
  it('delivers the same frames and result as a headless run', async () => {
    const src = await workerSource();
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(src)}`));
    const input = sampleInput(21);
    const frames: Uint16Array[] = [];
    const controllers: Uint8Array[] = [];
    const done = new Promise<FromSimWorker>((resolve) => {
      worker.on('message', (m: FromSimWorker) => {
        if (m.type === 'frames') {
          frames.push(...m.frames);
          controllers.push(...(m.controllers ?? []));
        } else resolve(m);
      });
    });
    worker.postMessage({ type: 'start', roundId: 1, input });
    worker.postMessage({ type: 'finish', roundId: 1 });
    const last = await done;
    await worker.terminate();
    const headless = Sim.simulate({ ...input, recordFrames: true });
    expect(frames.map((f) => Array.from(f))).toEqual(headless.frames!.map((f) => Array.from(f)));
    expect(last.type === 'done' && last.result.finalHash).toBe(headless.finalHash);
    expect(controllers).toHaveLength(frames.length);
    expect(controllers.every((c) => c instanceof Uint8Array && c.length === 3)).toBe(true);
  });
});
