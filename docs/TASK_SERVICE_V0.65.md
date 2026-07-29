# v0.65 Durable Execution Heartbeat

Every executable assistant or employee direct-chat task records execution-controller heartbeats in TaskService. A heartbeat contains the observed controller state, phase, task workspace and a 90-second lease expiry.

This is the persistence prerequisite for a later background worker: after a crash or restart, recovery can identify a stale active task rather than infer success from the last visible message.
