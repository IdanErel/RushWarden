# @gridlock/app

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

## Example

```ts
import { JsonSaveStore, MemoryBackend, NullPortalAdapter, LockedEntitlement } from '@gridlock/app';

const portal = new NullPortalAdapter();
await portal.init();
const entitlement = new LockedEntitlement();
const saves = new JsonSaveStore(new MemoryBackend(), () => crypto.randomUUID());
const doc = await saves.load();
if (!entitlement.isUnlocked()) {
  /* show District 1 only */
}
```
