# v1 Fault Injection Matrix

The v1 gate treats a model response as untrusted until the execution record, artifact, review, and task state agree. This matrix records the failure paths that must remain safe on every release.

| Failure scenario | Required system behavior | Regression coverage |
| --- | --- | --- |
| Model timeout, abort, or temporary network error | Classify the error, keep the same task context, schedule bounded exponential retry, and do not skip dependent work. | `verify-task-retry-policy.mjs` |
| Credential, permission, schema, or missing configuration failure | Stop retrying that route, record the exact blocking class, and wait for the minimum required user action. | `verify-task-retry-policy.mjs`, `verify-task-approval-metrics.mjs` |
| Approval rejected | Preserve the task and evidence, mark the action blocked, and never execute the protected side effect. | `verify-task-approval-metrics.mjs`, native execution regression |
| Main process or Worker session changes | Recover the ledger, invalidate the old lease, preserve checkpoints, and queue only native tasks that are safe to continue. | `verify-task-worker.cjs`, `verify-task-recovery-gate.mjs` |
| Child task stops or fails | Propagate the real result to its parent; parent steps must wait or fail rather than inventing completion. | `verify-native-execution-adapter.cjs` |
| Compensation is dangerous | Require durable approval, then run only the declared compensation route after approval. | `verify-native-execution-adapter.cjs` |
| Tool or Skill claim lacks evidence | Retain the failed or partial attempt and block completion instead of accepting a verbal success claim. | `verify-unified-tool-evidence.mjs`, `verify-skill-activation-evidence.cjs` |

Run the complete matrix with:

```powershell
npm.cmd run verify:v1-fault-injection
```

`npm.cmd run verify:v1-core-gate` includes this command, so a v1 release cannot silently omit the fault paths above.
