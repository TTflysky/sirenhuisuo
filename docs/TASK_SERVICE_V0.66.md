# v0.66 Direct Chat Worker Lease

Direct assistant and employee chat tasks now use the existing `TaskWorker` lease protocol. Each executable task claims a lease, renews it every 10 seconds during model and tool execution, and releases it at terminal completion or failure.

This does not yet move the model loop out of the renderer. It makes direct-chat work recoverable by the same durable lease protocol already used by team tasks, which is required before the Worker can become the actual execution host.
