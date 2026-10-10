# ADR-020: Intersection controllers and the turn pocket

Status: Proposed · 2026-10-10 · Sim Engineer (P1-SIM-03). Number assigned by the Lead.

GDD §3 rule 5 says "signals by phase; uncontrolled by 'first at line, then rightmost'; roundabouts
by 'inside has priority, max occupancy 4'; priority(dir) by direction". Rule 2 adds that the gap
accounts for "an intersection stop line when the controller says stop, and a turn-reservation
cell". The brief does not give timings, phase layouts or tie-breaks. These are the choices in
`packages/sim/src/controllers.ts`.

1. **Where controllers act.** A vehicle at the last cell of an approach lane (its stop line) may
   enter its box lane only when the controller allows it. Rule 2 treats a refused stop line as a
   blocked cell. Physical conflicts inside the box were already impossible (shared quarters,
   ADR-017); controllers add right-of-way only. Rule 5 runs at the start of each tick, after
   spawning and sorting: signals advance and grants are picked.
2. **Per-round state.** Controller kind and timers live in the round's traffic state, never in the
   cached `World` (ADR-017 point 9). `Intersection.controller` is now read-only and is only the
   map default (uncontrolled). From P1-SIM-05, `setController`, `setSignalPhase`, `yieldRule` and
   `addTurnLane` placements call `setController`, `configureSignal`, `setResolveTicks` and
   `setTurnPockets`.
3. **Uncontrolled.** A vehicle must wait at the line `UNCONTROLLED_RESOLVE_TICKS` = 3 ticks.
   Yield Culture lowers this, to a minimum of 1. There is one grant per intersection per tick:
   - the earliest arrival goes first;
   - on a tie, the approach with nobody waiting on its right goes first (yield to the right,
     since traffic drives on the right per ADR-012);
   - if all four approaches tie, the lowest side index (n) goes first;
   - any remaining tie goes to the lowest vehicle id.
4. **Signal.** There are two phases, n-s and e-w, and n-s starts green. Between greens there are
   `DEFAULT_SWITCH_TICKS` = 6 ticks of all-red; `setSignalPhase` changes this.
   - **Fixed time:** `SIGNAL_GREEN_TICKS` = 40 ticks (2 s) of green per phase.
   - **Adaptive** (Smart Signal, "longest queue gets green"): the phase switches after
     `ADAPTIVE_MIN_GREEN_TICKS` = 10 ticks when the other phase's approaches hold more occupied
     cells. It also switches after `ADAPTIVE_MAX_GREEN_TICKS` = 80 ticks if anyone waits on the
     other phase. Green stays while the other phase is empty.
   - All movements, turns included, go on their approach's green. There are no protected turn
     phases in Phase 1.
5. **Roundabout.** A vehicle may enter while the box holds fewer than `capacity` vehicles (4 by
   default; the upgrade raises it to 6). The quarter that circulating traffic would arrive from
   must also be free ("inside has priority"). There is no wait at an empty line.
6. **Stop-all.** The vehicle must have come to a stop at the line (v = 0 on a tick after it
   arrived), and the box must be empty, so one vehicle crosses at a time. Grants follow point 3's
   order.
7. **Priority(dir).** The approaches on `dir`'s axis enter freely. A minor-road vehicle is granted,
   as in point 3, only when no major-road vehicle is within one tile (4 cells) of the line,
   counting turn pockets too.
8. **Vehicle behaviours from the §3 table.**
   - **Emergency** ("others yield; ignores signals") enters on red, and wins any grant without
     the resolve wait.
   - **Truck** ("blocks a full intersection cell while turning"): while a truck's head is on a
     turning movement in a box, no new vehicle may enter that intersection. A straight truck
     does not block it.
9. **Turn pocket** (Turn Lane, the rule-2 "turn-reservation cell"). Each approach has a reserved
   1-cell pocket lane, with ids after the box lanes (`world.pocketLanes ..`). With `left`, left
   turners leave the through lane at the stop line, step into the pocket and wait there; with
   `both`, right turners do the same. The pocket is its own stop line, so a waiting turner no
   longer blocks through traffic. Without a Turn Lane, pockets are unused. `locateCell` draws a
   pocket beside the approach's last tile.
10. **Renderer data** (Lead's decision, 2026-10-10; an addendum to ADR-015's playback frames).
    `controllerSnapshot(state)` returns `[kind, greenMask, boxCount]` per intersection, in
    intersection order:
    - `kind` is a `ControllerCode`;
    - `greenMask` has bit `side` set for each approach on green (signals only; 0 during all-red
      and for other kinds);
    - `boxCount` is the number of vehicles whose head is in the box.

    The worker's `frames` message gains an optional field `controllers?: readonly Uint8Array[]`,
    where `controllers[k]` is the controller snapshot after the same tick as `frames[k]`. Its
    buffers are transferred with the frames. The sim worker always sends it; it is optional so
    other producers (Render's `FakeTraffic`) may omit it. Until P1-SIM-05 wires the cards, every
    intersection is uncontrolled: kind 0 and mask 0, and only `boxCount` moves.

11. **Hash.** The state hash now also covers each vehicle's stop-line arrival tick and every
    intersection's controller kind and signal state. Golden hashes are regenerated (see the PR).
