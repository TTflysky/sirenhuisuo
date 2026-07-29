# v0.86 - v1.0 Release Closure

## v0.86 Release quality closure

- Moved assistant prompt persistence and the Store hook out of React component modules so Fast Refresh boundaries are correct and release lint has no warnings.
- Added `verify:v1-fault-injection`, a deterministic suite for timeout retry, credential and approval boundaries, Worker restart recovery, evidence integrity, Skill activation, and native task execution.
- Added `docs/V1_FAULT_INJECTION_MATRIX.md` and made the suite mandatory in `verify:v1-core-gate`.
- Standardized the renderer font payload on the required 幼圆 font. Historic appearance settings fall back to 幼圆 and unused font files are no longer emitted into `dist`.

## v1.0 Product baseline

- Rebranded the visible assistant and default built-in persona as 章北海助理.
- The default persona version is now v13. Existing user personas are retained; the first load appends the v1 task-ledger, delegation, evidence, recovery, and approval contract exactly once.
- The release baseline requires a passing clean lint, production build, durable task service and recovery tests, plan/runner tests, child dispatch, native execution E2E, fault injection, and ecosystem health.
