# Architecture decision records

One file per decision the brief does not cover, or a proposed change to the brief.
Name: `ADR-NNN-short-title.md`. Status is one of Proposed, Accepted, Superseded by ADR-NNN.
A Proposed ADR that changes the brief needs Idan's answer before work depends on it.

| ADR | Title                                                   | Status          |
| --- | ------------------------------------------------------- | --------------- |
| 000 | Stack and tooling versions                              | Accepted        |
| 001 | The sim receives a resolved map in RoundInput           | Accepted        |
| 002 | Sim.step takes ownership of its state                   | Accepted        |
| 003 | Golden-hash engines per PR and nightly                  | Accepted        |
| 004 | Web initial download budget is 7.5 MB                   | Accepted        |
| 005 | Review and merge mechanics with one GitHub identity     | Accepted        |
| 006 | Phase 1 Steam wishlist gate needs Steamworks in Phase 1 | Accepted        |
| 007 | Phase 1 scope                                           | Accepted        |
| 008 | The game is named Rushwarden                            | Accepted        |
| 009 | Analytics event time is the server's receipt time       | Accepted        |
| 010 | How the Phase 1 gate criteria are measured              | Accepted        |
| 011 | Card data format, schema and generated text             | Accepted        |
| 012 | World topology rules for maps                           | Proposed        |
| 013 | Web portal adapters never call portal ad APIs           | Proposed (Idan) |
| 014 | Effect union v2                                         | Accepted        |
| 015 | Renderer playback, provisional lanes, fake traffic      | Proposed        |
| 016 | Map template format and variants                        | Accepted        |
| 017 | Vehicles, intersection boxes and tick mechanics         | Proposed        |
| 018 | Run controller rule readings                            | Accepted        |
| 019 | Balance runner seeds, bots and report format            | Proposed        |
| 020 | Intersection controllers and the turn pocket            | Proposed        |
| 021 | Round demand model, seed salts and District 1 bosses    | Accepted        |
| 022 | p_slow, the gridlock detector and closed segments       | Proposed        |
| 023 | Card effects, stacking and controller conflicts         | Proposed        |
| 024 | Portal monetisation: Poki and CrazyGames                | Accepted        |
| 025 | Privacy defaults: consent, retention, requests          | Accepted        |
| 026 | Phase 1 sim throughput budget                           | Accepted (Lead) |
| 027 | Nightly balance report is an artifact                   | Accepted (Lead) |
| 028 | Clip tool: replay rendering, determinism, captions, CI  | Accepted        |
| 029 | Toy e2e in CI, E2E-18 tracking, store-asset rules       | Accepted (Lead) |
| 030 | Toy difficulty curve                                    | Accepted (Lead) |
| 031 | One-Way targets and direction                           | Accepted (Lead) |
| 032 | District 1 per-template demand factor                   | Accepted (Lead) |
