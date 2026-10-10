# Contributing

This repository is built by an agent team supervised by Idan (GDD section 13).

1. **Read `docs/gdd.md` in full** before your first task. It is binding.
2. **Stay in your lane.** Section 13 lists what each role owns and must not touch. Need something
   from another package? Ask its owner through the Lead.
3. **One task, one branch, one PR.** Branch `role/short-task` from `main`. Title is a
   conventional commit, e.g. `feat(sim): nagel-schreckenberg acceleration and gap rules`.
4. **Fill the PR template.** Test evidence always; balance report for content; screenshots for
   visuals; ADR link for decisions.
5. **Interfaces** (`packages/sim/src/types.ts`, `packages/app/src/{portal,entitlement,save}.ts`)
   change only after an announcement in `docs/tasks/` and Lead approval; dependents update in the
   same or a linked PR.
6. **Determinism.** Never use `Math.random`, clocks or floats in `packages/sim`. If the golden
   hashes change, the PR says why, regenerates with `pnpm golden:update`, and the Reviewer confirms.
7. **Merging** follows ADR-005: Reviewer verdict + green CI, Lead merges, nobody self-merges.
8. **Timebox.** A task past 2× its estimate stops and goes back to the Lead for re-planning.
9. **Standup.** Each role appends done / next / blocked to `docs/standup/YYYY-MM-DD.md` daily.
10. **Assets.** Generated in-repo only. Any third-party file must be OFL/CC0/MIT and listed in
    `THIRD_PARTY.md`.
