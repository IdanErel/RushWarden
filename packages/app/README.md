# @rushwarden/app

Game state machine, run controller, save/load, entitlement, analytics client, and the
`PortalAdapter` contract (GDD section 6). Interfaces are owned by the Lead; changes are announced
first (section 13, rule 6).

## Public API

| Export                                                       | Purpose                                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `PortalAdapter`                                              | `init`, `gameplayStart`, `gameplayStop`, `commercialBreak` (no-op, never an ad), `happyTime`, `shareUrl`, `canSellInPortal`. |
| `NullPortalAdapter`                                          | Does nothing; tests and headless.                                                                                            |
| `Entitlement`                                                | `isUnlocked()`, `purchase()`, `restore()`, `source`. One receipt model for every store.                                      |
| `LockedEntitlement`, `DevEntitlement`                        | Stubs; `DevEntitlement` never ships in a store build.                                                                        |
| `SaveStore`, `SaveBackend`, `JsonSaveStore`, `MemoryBackend` | Versioned, migratable JSON saves.                                                                                            |
| `flags`                                                      | Feature flags for launch-sensitive features.                                                                                 |
| `startRun`, `step`, `replay`, `RunController`                | Deterministic run controller (P1-BAL-01, ADR-018): hand, energy, plays, offers, approval, quotas; emits run analytics.       |
| `toyRunConfig`, `fullRunConfig`, `quotaFor`, `buildOffer`    | The 5-round toy and 12-round run presets (ADR-007), the GDD §2 quota in integers, and §4 offers.                             |

## Example

```ts
import {
  JsonSaveStore,
  MemoryBackend,
  NullPortalAdapter,
  LockedEntitlement,
} from '@rushwarden/app';

const portal = new NullPortalAdapter();
await portal.init();
const entitlement = new LockedEntitlement();
const saves = new JsonSaveStore(new MemoryBackend(), () => crypto.randomUUID());
const doc = await saves.load();
if (!entitlement.isUnlocked()) {
  /* show District 1 only */
}
```

## Run controller

`src/run/` is pure: `startRun(config, env)` deals round 1, and `step(state, action, env)` applies
`play`, `undo`, `go` or `choose` and returns a new state plus the analytics events it produced
(`run_start`, `round_end`, `run_end`). A run is saved as its config plus actions; `replay`
rebuilds it. All randomness comes from `@rushwarden/sim`'s PRNG seeded by `config.seed`, and the
determinism lint rules of `packages/sim` apply to this folder. `env.setupRound` supplies each
round's map and demand (content, P1-CON-03/04), and `env.simulate` defaults to `Sim.simulate`.
The UI can run the sim in the worker instead: `controller.roundInput()`, then
`controller.resolve(result)`.

```ts
import { RunController, toyRunConfig } from '@rushwarden/app';

const run = new RunController(toyRunConfig({ seed, cards }), { setupRound }, analytics);
run.dispatch({ type: 'play', handIndex: 0, target: { kind: 'district' } });
run.dispatch({ type: 'go' });
run.dispatch({ type: 'choose', pick: 0 }); // or 'skip'
```
