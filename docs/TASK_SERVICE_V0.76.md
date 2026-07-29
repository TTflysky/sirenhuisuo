# v0.76 Queued Parent Compensation

A stopped task can be queued while one of its descendants is executing. In that state it has no active `execute()` catch block, so a normal stop would otherwise remove it from the queue and leave its completed side effects uncompensated.

The adapter now adds a dedicated `compensating_queue` entry after descendant control propagation. The standard single queue processes this entry only after the currently active descendant has settled, calls the existing compensation executor, and records `queued_task_compensation_finished` before leaving the task stopped.

This preserves serial tool execution: parent and child compensation never run concurrently merely because their lifecycle states differ.
