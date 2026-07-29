# v0.74 Compensation Handoff

Compensation is now observable even when it cannot run. A missing compensation target, an unavailable owner, or a compensation route that belongs to a child task is persisted as a typed ledger record rather than disappearing after the executor stops.

For every non-executable compensation, the task creates a recovery handoff containing the original affected step, the specific blocker, and one concrete next action. The recovery capsule includes the same unresolved issue so process recovery does not lose the safety boundary.

Task metrics expose compensation `total`, `completed`, `blocked`, and `failed` counts. Completion validation ignores `compensationOnly` steps during normal work; those steps become relevant only after a rollback trigger.

The native adapter regression covers both paths: a real stop executes a declared rollback tool action, while a deliberately missing rollback target produces a persisted missing outcome and handoff.
