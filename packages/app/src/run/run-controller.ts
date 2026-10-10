import type { RoundInput, RoundResult } from '@rushwarden/sim';
import { roundInput, resolveRound, startRun, step } from './controller.js';
import type { RunAction, RunConfig, RunEnv, RunEvent, RunState, StepResult } from './types.js';

/**
 * Where run events go: structurally the analytics client's `track()` (`createIngestClient` /
 * `offIngestClient`), so the UI passes that in. Analytics must never break the game, so errors
 * thrown by `track` are swallowed.
 */
export interface RunAnalytics {
  track(event: RunEvent['event'], props: RunEvent['props']): void;
}

/**
 * Stateful wrapper for the UI: holds the current state and the action log (a run is saved as its
 * config plus actions), and forwards `run_start`, `round_end` and `run_end` to analytics.
 */
export class RunController {
  private current: RunState;
  private readonly log: RunAction[] = [];

  constructor(
    readonly config: RunConfig,
    private readonly env: RunEnv,
    private readonly analytics: RunAnalytics | null = null,
  ) {
    const start = startRun(config, env);
    this.current = start.state;
    this.emit(start.events);
  }

  get state(): RunState {
    return this.current;
  }

  /** Every accepted action so far, for saving and replay. */
  get actions(): readonly RunAction[] {
    return this.log;
  }

  dispatch(action: RunAction): StepResult {
    return this.apply(action, step(this.current, action, this.env));
  }

  /** For the worker path: the Go phase input, simulated off the main thread. */
  roundInput(): RoundInput {
    return roundInput(this.current);
  }

  /** For the worker path: applies the worker's result as the `go` action. */
  resolve(result: RoundResult): StepResult {
    return this.apply({ type: 'go' }, resolveRound(this.current, result));
  }

  private apply(action: RunAction, r: StepResult): StepResult {
    if (r.ok) {
      this.current = r.state;
      this.log.push(action);
      this.emit(r.events);
    }
    return r;
  }

  private emit(events: readonly RunEvent[]): void {
    if (!this.analytics) return;
    for (const e of events) {
      try {
        this.analytics.track(e.event, e.props);
      } catch {
        // Analytics must never break the game.
      }
    }
  }
}
