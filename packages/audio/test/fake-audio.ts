/** A minimal in-memory AudioContext for Node tests: records the graph and every source started. */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  BufferSourceLike,
  GainNodeLike,
} from '../src/engine';

export class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  constructor(readonly kind: string) {}
  connect(destination: AudioNodeLike): unknown {
    this.outputs.push(destination);
    return destination;
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = { value: 1 };
  constructor() {
    super('gain');
  }
}

export class FakeBuffer implements AudioBufferLike {
  readonly data: Float32Array;
  constructor(
    length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  readonly playbackRate = { value: 1 };
  onended: ((ev: never) => unknown) | null = null;
  startedAt: number | null = null;
  constructor() {
    super('source');
  }
  start(when = 0): void {
    this.startedAt = when;
  }
  end(): void {
    (this.onended as (() => void) | null)?.();
  }
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  state: 'suspended' | 'running' = 'suspended';
  readonly destination = new FakeNode('destination');
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly buffers: FakeBuffer[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  constructor(readonly sampleRate = 8000) {}
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    const b = new FakeBuffer(length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

/** An EventTarget stand-in that lets tests dispatch named events. */
export class FakeTarget {
  readonly listeners = new Map<string, Set<() => void>>();
  hidden = false;
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  count(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}
