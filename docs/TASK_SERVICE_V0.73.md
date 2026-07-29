# v0.73 Executable Compensation

Task steps now persist three compensation attributes:

- `sideEffect`: whether a completed step may have changed external state.
- `compensateStepId`: the explicit task step that can undo or reduce that state.
- `compensationOnly`: marks a step that is excluded from normal scheduling and can execute only as a compensation action.

On a task stop, close, or non-control execution failure, the native executor finds completed side-effect steps with a declared compensation target and executes their targets in reverse completion order. It never invents a rollback for a step without an explicit target.

Each compensation step must make a real successful tool call. Its start, completion, failure, unavailable owner, and missing target are persisted in the task ledger, runner history, execution event stream, and recovery capsule. This keeps a task recoverable even when an attempted rollback cannot finish.

`scripts/verify-native-execution-adapter.cjs` covers the live sequence: complete a declared side effect, interrupt the next running step, assert that the compensation-only step calls `write_file`, then verify the recorded compensation result and execution event.
