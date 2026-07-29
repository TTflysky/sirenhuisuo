# v0.69 Child-Task Lifecycle Control

Child tasks now inherit their parent's member snapshot so the assigned employee and its model configuration remain executable after task creation, recovery, or a process restart.

Task controls cascade through the durable `parentTaskId` tree:

- `pause` pauses unfinished descendants and removes queued native jobs.
- `resume` requeues descendants before the parent resumes its dependency wait.
- `stop` stops unfinished descendants.
- `close` stops descendants while retaining their execution audit, then closes the requested parent task.

This prevents an orphaned employee task from continuing after its parent project has been paused, stopped, or closed.
