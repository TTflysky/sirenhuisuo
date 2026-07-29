# v0.70 Child-Task Recovery Resume

Native task recovery now handles a durable child task that survived while its in-memory executor did not.

When a resumed parent reaches a child dependency in `queued` state without an active native job, it starts the child again from the durable task record and yields its queue slot. The parent only proceeds after the child reaches a terminal state and its handback is synchronized.

The recovery path does not restart a `paused` or `awaiting_user` child: those states are preserved as a clear user-action blocker rather than being silently bypassed.
