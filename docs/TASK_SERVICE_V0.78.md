# v0.78 Recovery Plan

`TaskService.recoveryPlan(taskId)` derives a safe recovery decision from the task-tree projection. It returns whether the root may resume, all nodes that require user action or have unresolved compensation, a deepest-first compensation order, and one concise next action.

The plan is intentionally advisory and ledger-derived: it does not restart a task, approve an action, or bypass an unresolved blocker. The native executor and UI can use the same result to decide when a Continue action is valid.

The response is exposed through `task-service:recovery-plan` so recovery controls do not independently infer ordering from raw task records.
