# v0.83 v1 Core Release Gate

Run `npm.cmd run verify:v1-core-gate` before declaring a core task-execution release ready. The gate invokes the existing lint, production build, foundation, agent-kernel, execution-controller, TaskService, recovery gate, task plan, runner, child dispatch, native execution E2E, and ecosystem-health checks in order.

It intentionally does not package or publish. Packaging, installer validation, release assets, and remote GitHub verification remain final-release steps after the user validates the v1 client.
