# v0.80 Compensation Approval Boundary

Before a compensation step that may affect external state runs, the native adapter checks its explicit approval flag, the execution policy, and high-risk action language. If approval is required, it creates a durable `compensation` approval record and writes an awaiting-approval compensation outcome instead of calling a tool.

After approval, a Resume command enters only the dedicated compensation queue for a stopped task. It does not re-run normal task steps. A rejected approval stays in the ledger as a blocked compensation handoff.
