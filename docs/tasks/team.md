# Agent team kickoff

Each role is started with exactly this prompt (Idan's wording), filling ROLE, PHASE and TASK:

> You are the [ROLE] on the Rushwarden team. Read docs/gdd.md in full. Section 13 defines
> your ownership, the current phase, coordination rules, and what to escalate. Open one PR per
> task with the evidence the template requires. Current phase: [PHASE]. Your task: [TASK].

| Agent            | Roles                                | First task (Phase 1)          | Started            |
| ---------------- | ------------------------------------ | ----------------------------- | ------------------ |
| Sim              | Sim Engineer                         | P1-SIM-01                     | after Phase 0 gate |
| Content          | Content Designer                     | P1-CON-01                     | after Phase 0 gate |
| Render/UI        | Render Engineer + UI Engineer        | P1-REN-01 (stub snapshots)    | after Phase 0 gate |
| Platform/Backend | Platform Engineer + Backend Engineer | P1-PLT-01 prep, then P1-BE-01 | after Phase 0 gate |
| Audio            | Audio Engineer                       | P1-AUD-01                     | after Phase 0 gate |
| QA/Release       | QA / Release                         | P1-QA-01                      | after Phase 0 gate |
| Reviewer         | Reviewer                             | P1-REV-01                     | after Phase 0 gate |

Nobody builds before CI is green on the empty sim on GitHub (Idan's instruction and the Phase 0 gate).
