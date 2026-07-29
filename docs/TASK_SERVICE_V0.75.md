# v0.75 Queued Child Compensation Ordering

Task execution is serial in the native adapter. A parent can be active while a delegated child is queued, so a stop request previously risked letting the parent begin rollback before the child had handled its own completed side effects.

The lifecycle cascade now detects queued children. It dispatches their stop control, executes each child's declared compensation while the parent is still waiting, and emits `queued_child_compensation_finished`. Only after this cascade returns can the active parent run its own compensation.

This is deliberately limited to queued descendants. The next iteration covers the inverse case where the parent is queued behind an actively running child, requiring an explicit wait-and-recover contract rather than concurrent rollback.
