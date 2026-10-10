/// <reference lib="webworker" />
/** Web Worker entry: owns the sim state (GDD §6) and answers `step` requests with snapshots. */
import { createSimWorkerHandler, type ToSimWorker } from './protocol.js';

declare const self: DedicatedWorkerGlobalScope;

const handle = createSimWorkerHandler((m, transfer) => self.postMessage(m, transfer));
self.onmessage = (ev: MessageEvent<ToSimWorker>) => handle(ev.data);
