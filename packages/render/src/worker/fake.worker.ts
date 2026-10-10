/// <reference lib="webworker" />
/** Web Worker entry for fake traffic (dev page only; see `fake-handler.ts`). */
import type { ToSimWorker } from './protocol.js';
import { createFakeWorkerHandler } from './fake-handler.js';

declare const self: DedicatedWorkerGlobalScope;

const handle = createFakeWorkerHandler((m, transfer) => self.postMessage(m, transfer));
self.onmessage = (ev: MessageEvent<ToSimWorker>) => handle(ev.data);
