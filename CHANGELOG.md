# 更新日志

## v2.6.1 (Phase 3: image editing, memory quality, and performance gates)

- Fixed image editing across assistant chat, employee direct messages, and team chat. A current-turn image now routes to `/images/edits` as multipart form data with the real source image; text-only prompts continue to use `/images/generations`.
- Added a dedicated image-request module and regression coverage for source selection, data-URL decoding, multipart payload fields, endpoint routing, and all three chat surfaces.
- Extracted user-memory quality and persistence from the oversized client module. Memory now supports normalized deduplication, explicit replacement, polarity conflict handling, importance-aware capacity, expiry review, and visible change reasons; review-due memories are excluded from model context.
- Extracted native execution policy from the runtime loop and added focused tests for endpoint normalization, deliverable inference, destructive compensation approval, verified artifacts, parent/child handoff, and public projections.
- Added leak-resistant local event fanout and a Phase 3 performance baseline covering 268 catalog experts, 320 employees, 12000 task events, and 12 simulated windows.
- Added module-size regression gates and upgraded the built-in assistant persona to v14. Persona migration now appends each missing protocol section independently while preserving user customization.

## v2.6.0 (Phase 3: execution observability and diagnostics)

- Migrated the canonical package, Windows App ID, installation identity, MCP client identity, and user-data directory to `taiji-office` / `com.taiji.office`. A tested one-time migration copies legacy employees, teams, conversations, tasks, memory, workspaces, and Chromium storage without overwriting newer files; the old directory remains available for recovery.
- Added a durable, redacted operation-diagnostics ledger for task storage, recovery preflight, native execution, IPC, main-process exceptions, and unhandled renderer-window errors. Records include task/team identity, module, operation, failure class, recoverability, and contextual evidence.
- Added Diagnostics Center error summary and JSON export. Every window writes to the same diagnostic source, so an issue can be exported after the original window has been closed or refreshed.
- Added execution-observability projections for queue, child-task waiting, compensation, retries, failure classes, evidence completeness, duration, and tool outcomes.
- Prevented stale renderer task snapshots from removing active durable tasks. Explicit removal remains available only for terminal tasks, with regression coverage for active parent-task protection.
- Added `verify:execution-observability`, `verify:operation-diagnostics`, and `verify:app-identity-migration` to the v2 core release gate.

## v2.5.2 (Office card action placement)

- Moved the office employee-card settings action from the top-left text area to a compact three-dot action at the bottom-right, preserving the existing employee configuration entry point while keeping identity information unobstructed.

## v2.5.1 (Phase 2: Coding Runtime foundation)

- Added an independent Coding Runtime for software tasks. It prepares a task workspace or isolated Git worktree, indexes files and symbols, resolves import relationships, captures diffs/checkpoints, and keeps bounded incremental command-session logs with classified failures.
- Added a ProjectBrief-to-DAG compiler. Approved software projects now receive named product, architecture, UX/UI, frontend, backend, verification, review, and delivery stages with explicit dependencies, responsible capability, retry policy, and acceptance conditions.
- A staffing gap now stops a coding project before execution instead of assigning an unrelated employee. Later team additions can be recorded with the reason, affected stages, and new acceptance criteria.
- Added Coding Runtime tools to the native team executor: repository index, code search, dependency lookup, and checkpoint. They operate only after a managed Git worktree exists.
- Added a TaskService coding task type. It persists the compiled DAG, workspace/index evidence, and a review decision that requeues only the responsible work step while leaving unrelated completed work intact.
- Added `verify:coding-runtime` and included it in the complete v2 release gate.

## v2.5.0 (Phase 2: expert personas and office navigation)

- Split bundled Agency expert data into a concise role prompt and a full `soul` operating manual. New experts now receive their detailed instructions in `soul`, where employee direct messages and team execution consume them as working context.
- Added an idempotent startup migration for previously materialized catalog experts. It moves the known legacy instruction payload out of `prompt`, fills an empty `soul`, and preserves user-authored prompt customizations.
- Added an employee-settings button to every occupied office staff card. It opens the same employee configuration surface used by the sidebar, including model, personality, avatar, and status settings.
- Removed the duplicate team list from the left employee sidebar. Teams are now managed from Team Hall, which remains the single surface for opening, renaming, archiving, and deleting teams.
- Added `verify:v250-personas-and-office` and included it in the complete v2 release gate.

## v2.4.0 (Phase 1: turn isolation and platform-wide GPT Image 2)

- Added turn-relation classification before task planning. A new independent goal, continuation, correction, control command, and status question are now treated as different conversational acts, so a new request no longer gets silently merged into an in-flight task.
- Added `gpt-image-2` as a first-class image model. It uses the OpenAI image-generation endpoint and its `output_format` request contract instead of a chat-completions fallback or the legacy image response field.
- Added a one-click `GPT Image 2` model entry in Settings. Image-capable entries are labelled clearly and can also be assigned to the existing employee-avatar generator.
- Added image-mode model selection to the assistant, employee direct-message, and team-chat composers. Generated images are saved into chat history, can be opened or downloaded, and survive normal message rendering.
- Kept temporary chat choices scoped to their chat surface. Switching a composer to an image model does not overwrite the assistant default, the active general model, or an employee's dedicated working model.
- Added regressions for image endpoint routing and task-turn isolation; they are included in the v2 core release gate.

## v2.3.1 (Software-project roster fidelity and complete office navigation)

- Compiled greenfield software, application, client, platform, system, website, and mini-program requests into a deterministic responsibility baseline covering coordination, software architecture, UI/UX, frontend/client implementation, backend services, engineering, and QA. Model-suggested capabilities are additive and can no longer erase this baseline.
- Replaced generic set-cover fallback ordering with specialty-aware ownership. Stable employee identity and explicit capabilities drive core role selection, so incidental UI or testing words inside a long role prompt cannot make an architect impersonate a designer or reviewer.
- Added structured roster rematching for correction turns such as “人员不对”, “重新看需求”, and “重新选人”. Corrections update the pending project in the same conversation using its original request instead of creating a new project from the correction sentence.
- Recognized “安排人帮我做” as explicit team dispatch and added an end-to-end regression reproducing the reported creator-publishing-client conversation. The test requires product, architecture, UI, frontend, backend, and QA coverage and rejects unrelated Drupal, WordPress, and education candidates.
- Added visible previous/next controls, vertical-wheel-to-horizontal navigation, active-category visibility, keyboard focus states, and narrow-window behavior to the office category strip. Verified the real 272-employee page at 1280×720 and 760×720 without page-level horizontal overflow.
- Renamed the Markdown transcript footer from “Hermes 助手” to “太极助手”, added `docs/自我评分.md`, and included `verify:v231-dispatch-and-brand` in the complete v2 release gate.

## v2.3.0 (Employee navigation, staff badges, and dedicated utility models)

- Added a horizontally scrollable office category navigator backed by live employee profiles. Product, design, engineering, data/AI, content, growth, business, finance/legal, people/education, GIS, and support counts update without maintaining a second employee list.
- Replaced office workstation tiles with theme-aware, reversible staff ID badges. The front shows the avatar frame, identity, concise capabilities and status; the back exposes the full ability summary and a dedicated direct-message action.
- Preserved large-office responsiveness with stable card dimensions, an independently scrolling office surface, offscreen `content-visibility`, reduced-motion support, and employee-keyed flip state across category changes.
- Added an AI generation tab to the employee avatar library. A dedicated OpenAI-compatible image model can return Base64 or a downloadable image URL; the result is validated and previewed, and never replaces the current avatar without explicit confirmation.
- Added a dedicated diagnostics model and one-click optimization flow. Model judgment is constrained by a deterministic whitelist: only user-installed unhealthy Skills and the reversible recommended sandbox/approval policy can be changed automatically; credentials, connectors, external software, paths, code, and runtime faults remain explicit user actions.
- Added `verify:v230-experience` for employee categories, badge interaction/accessibility, dedicated model persistence, image-response parsing, the diagnostics whitelist, and post-fix reinspection. The check is included in the v2 core and GitHub release gates.

## v2.2.2 (Durable team formation and staged execution)

- Made the project proposal the durable source of truth for team formation. Each draft now records its owning chat session, original goal, structured roster revision, and clarification state; a correction updates that same record instead of asking the dispatcher to infer a new project from recent wording.
- Added structural add, replace, and remove roster mutations. “换一个 UI 设计师” now replaces the corresponding responsibility only after a real employee is resolved; generic UI/UX wording never falls back to an unrelated general designer, and ambiguous specialty choices request a concrete employee instead of guessing.
- Routed “可以”“就这个团队，拉群吧” to approval of the pending project in the current chat session. It can no longer create a new proposal or re-run capability matching, preventing the previously observed irrelevant Drupal candidate regression.
- Separated team establishment from execution. Approval creates the group with the approved roster, asks for product boundary, sources, deployment, required capabilities and UI style, then waits for the owner to confirm direction before creating the staged task plan.
- Strengthened staged delivery visibility: work and review remain interleaved gates, queued members show “等待前置步骤” or “等待执行”, and only a truly running step marks an employee as working.
- Replaced high-frequency full task hydration with per-task incremental projections after native execution events. IPC wake-up events are compact, artifacts sync only on actual artifact events, and startup/recovery remains the only full reconciliation path.
- Added continuity and control-plane regressions covering scoped proposal approval, structured UI-role replacement, queued stage projection, clarification-before-execution, and incremental task refresh.

## v2.2.1 (Expert roster materialization)

- Materialized all 268 bundled MIT-licensed Agency specialists as real office employees on first launch while preserving existing employees, teams, chats, tasks, and local configuration.
- Assigned every specialist a stable specialty name, department, avatar frame, and office station. Office capacity now grows from a small baseline instead of rendering 999 empty stations.
- Kept the professional expert catalog, project brief, approval context, and live team-roster synchronization introduced in v2.2.0. Running teams receive a roster version update when experts are added during execution.
- Packaged the Windows installer `taiji-office-setup-2.2.1.exe` with its update metadata for GitHub Release distribution.

## v2.1.0 (Durable turn lifecycle)

- Aligned assistant chat, employee direct messages, and native team execution on one durable Turn Lifecycle without storing hidden chain-of-thought. The public trajectory records the goal, model decisions, paired tool calls and results, verified evidence, context compaction, user steering, budget, exit reason, and recovery conditions.
- Added monotonic lifecycle persistence to TaskService. Older or equal-sequence conflict snapshots cannot overwrite newer facts, while lifecycle status maps waiting, paused, checkpointed, stopped, failed, and completed outcomes without treating every non-completion as the same failure.
- Added lifecycle recovery capsules to parent and child tasks. Children inherit verified artifacts, references, the parent exit state, and the resumable handoff, but never inherit an unverified completion claim as fact.
- Separated process heartbeat from real progress throughout the lifecycle. Heartbeats retain the current activity but cannot advance `progressAt`; model decisions, real tool results, steering, and context updates remain the only progress sources.
- Hardened tool-call recovery. A persisted in-progress call is closed by a later matching evidence record with the same `callId`, rather than duplicated or left permanently running after restart.
- Added defense-in-depth redaction in the main process. Lifecycle and recovery snapshots are sanitized again at the TaskService boundary so API keys, tokens, cookies, passwords, Bearer credentials, and URL query credentials cannot be persisted even if a renderer sends unsafe data.
- Added `verify:turn-lifecycle`, expanded TaskService and native execution regressions, and included the lifecycle contract in the v2 core and GitHub release gates. See `docs/HERMES_RUNTIME_ALIGNMENT_V2.1.md` for the source-level four-layer alignment against Hermes commit `41a07f5`.

## v2.0.1 (Truthful progress and isolated conversations)

- Rebuilt Skill installation as one verified path for SkillHub names and slugs, SkillHub detail/API URLs, GitHub repositories or directories, ZIP packages, and direct `SKILL.md` sources. The installer now rescans, reads back, and health-checks the installed package before reporting success.
- Added explicit New Chat and restorable chat history to assistant, employee direct-message, and team windows. Messages, model context, queued follow-ups, retries, task runs, native execution messages, and dynamically delegated children retain their originating conversation ID so late background results cannot contaminate a new chat.
- Fixed task continuation ordering. A parent now resumes durable descendant tasks before re-entering its own execution loop, preventing the Continue button from immediately falling back into a paused-child wait state.
- Separated process heartbeat from real execution progress. Native tasks persist the current model/tool activity and last real-progress time; a heartbeat only proves the process is alive and can no longer make a stalled task appear productive.
- Added hard deadlines around model requests and tool calls, including providers that ignore abort signals. An unresponsive operation produces a plain-language, resumable paused handoff instead of spinning forever or repeating an uncertain side effect.
- Expanded the team live panel with current activity, real-progress age, heartbeat age, readable 12 px event text, pause/resume/stop controls, and honest employee states for queued, running, waiting, paused, and failed work.
- Fixed the employee direct-message composer at narrow window widths. Secondary actions now use stable icon controls, the toolbar wraps without crushing Chinese labels vertically, and theme colors remain inherited from the shared design tokens.
- Added `verify:chat-controls-ui`, which opens the real Electron assistant, employee, and team windows, clicks New Chat in all three, verifies a stalled task exposes a working Continue control with immediate feedback, and captures UI screenshots.
- Added `verify:chat-session-isolation` and extended native execution and Worker regressions for non-advancing heartbeats, uncooperative model requests, stalled tools, parent-child resume order, and conversation-bound background delivery. The complete `verify:v2-core-gate` passes.

## v2.0.0 (Unified autonomous runtime)

- Added one Turn Runtime for assistant chat, employee chat, and native team execution. Every model response and real tool result now becomes a structured observation, decision, evidence record, recovery decision, or finalization instead of passing through unrelated topic-specific loops.
- Restored the correct responsibility boundary: the model understands the goal and chooses business actions with exact parameters; the runtime validates tool availability, Schema, permissions, approval, safety, repetition, and budget without rewriting search terms or inventing business routes.
- Replaced keyword-heavy team selection with a stable capability graph. Explicit members remain authoritative, UI/UX design and frontend implementation are distinct capabilities, reviewers are added for verifiable delivery, and unrelated online employees no longer win by list order.
- Added MoA-style private advisors for complex team steps. Advisors cannot call tools, change task state, or announce completion; the action owner receives their bounded guidance and remains responsible for execution and evidence.
- Added typed delivery contracts for answers, files, connections, operations, decisions, and mixed work. File evidence is required only for file delivery; connection and operation tasks require their own real verification instead of a placeholder document.
- Removed hidden pre-loop Skill, Connector, forced-search, and forced-file branches. Explicit Skill packages still use the atomic native installer, while tool discovery uses the shared `search_tools` and `describe_tool` capabilities.
- Added classified recovery for authentication, authorization, billing, transient network errors, context overflow, invalid arguments, missing dependencies, result mismatch, and verification failure. Recovery is bounded; exhausted work produces a resumable checkpoint or plain-language handoff instead of an unbounded loop.
- Preserved tool-call IDs, exact arguments, results, result references, unresolved issues, user steering, and context-budget checkpoints through compression and restart recovery. Running user messages return to the observation stage before work continues.
- Passed the new v2 trajectory gate, the complete v1 core gate, v1 fault injection, native execution E2E, dispatch, delegation, context-pair, task-plan, runner, evidence, tool-registry, build, and lint checks.

## v1.0.2 (Readable execution details)

- Raised execution-step titles, summaries, parameters, and raw results from 9-10 px utility text to the same configurable content-size system used by chat messages. Long results scroll inside their own region, while parameters preserve their original layout with horizontal scrolling.
- Added a responsive wide execution-detail viewer with step navigation, success and failure states, full untruncated stored input and output, copy controls, and a wrap/original-display switch. Dark, light, 1000x850, and 600x760 visual regressions now cover the viewer.
- Replaced the separate team execution bubble with the same `ThoughtChainView` used by assistant and employee direct messages, so all three chat levels expose the same readable history and wide viewer.
- Restored the five selectable Chinese fonts accidentally removed in v1.0.0 while keeping 幼圆 as the default. The package gate now fails unless all six font files are present and non-empty inside `app.asar`.
- Added `verify:execution-detail-ui` for real Electron window regression. On machines where Electron 33 can launch, it checks extra-large global sizing, independent scrolling, viewport fit, selectable text, and screenshots; browser fixture coverage remains available when the local GPU process cannot initialize.

## v1.0.1 (Semantic team dispatch)

- Reconnected assistant team formation to the existing model task-decision kernel. The model now compiles the goal, route, required capabilities, and decision reason once; the same decision is reused by either the team dispatcher or the normal agent loop.
- Replaced broad keyword-only member selection with required-capability coverage. UI and operating-system interface work now selects UI/UX and frontend specialists before generalists, while unrelated roles cannot win because of online order or a generic “design” word.
- Member corrections now target the latest pending project or running project team first, support employee titles as well as names, and update the approval card without asking the user to repeat a team name.
- Office employee counts, rosters, online state, and team counts now read local client state directly in assistant and team chat, bypassing Skill discovery, web search, and the previous running route.
- Added a New Chat control with restorable local chat history. A fresh chat has an empty model context; active work must be paused or stopped before switching so task reports cannot cross sessions.
- Added `verify:dispatch-intelligence` and included dispatch plus team-membership regressions in the v1 core release gate.

## v1.0.0 (Durable execution core)

- Unified assistant, employee, and team work behind the durable TaskService: task contracts, executable plans, child tasks, evidence, artifacts, review, recovery, and a ledger-derived task tree now use one source of truth.
- Added safe cancellation and recovery semantics: bounded retries, failure classification, Worker leases and heartbeat recovery, parent-child propagation, ordered compensation, and approval gates for risky rollback actions.
- Added the v1 fault-injection matrix and release gate coverage for timeout, credentials, approval rejection, Worker restart, child interruption, compensation, tool evidence, and Skill activation evidence.
- Moved assistant prompt persistence and the Store hook out of React component modules. Release lint is now clean with no suppressed Fast Refresh warnings.
- Renamed every user-facing assistant entry and the built-in persona to `章北海助理`. Existing custom personas retain their text and receive the v1 execution appendix once.
- Standardized the built-in UI font on 幼圆. Legacy font settings fall back safely while five unused font payloads are no longer included in the renderer build.
- Fixed complete Skill bundle readback: nested `knowledge-base/SKILL.md` and `notes/SKILL.md` rules are now validated and injected with the root Skill, so installed Skills cannot report success while silently omitting their required sub-rules.

## v0.85.0 (Skill context module)

- Moved Skill selection readback and evidence generation from the mention-input UI component into the shared execution module `src/engine/skillContext.ts`.
- Assistant, employee, and team chat continue to use the same concrete Skill-read behavior while Fast Refresh warnings for the input component are removed.
- Excluded the already-unused `_deadcode` directory from release lint and replaced the declaration file's empty module marker. Lint warnings dropped from eleven to three.

## v0.84.0 (Release lint cleanup)

- Replaced control-character filename sanitization ranges with Unicode `\p{Cc}` property classes across attachment, renderer tool, and native tool paths.
- The safe-path behavior remains the same while removing three avoidable lint warnings from release verification.
- `verify:v1-core-gate` passes again; remaining warnings are existing Fast Refresh export-layout and declaration-module hygiene items.

## v0.83.0 (v1 core release gate)

- Added `npm.cmd run verify:v1-core-gate`, a repeatable release-grade baseline covering lint, production build, foundation, agent kernel, execution controller, durable task service, recovery gate, plan/runner, child dispatch, native execution E2E, and ecosystem health.
- The gate stops at the first failing command and reports the exact command, including a Windows-safe process launcher without Node shell deprecation warnings.
- The full gate passes on the current worktree; existing lint and Vite code-splitting warnings remain non-blocking and are now visible in one place.

## v0.82.0 (Task tree in team task details)

- Expanding a team task now loads its durable task-tree audit and recovery plan from the Electron main process.
- Task details show hierarchy, step progress, compensation outcomes, blockers, and whether continuation is currently allowed; the view no longer infers recovery state from chat-only data.
- The UI uses the shared TaskService IPC projection, preserving one source of truth for execution, diagnostics, and recovery.

## v0.81.0 (Approved compensation E2E)

- A native end-to-end regression now proves the high-risk path: stop work, create a pending compensation approval without executing the tool, approve it, resume through TaskWorker, and execute only the compensation action.
- Compensation approval decisions now transition to `paused`, matching the Worker resume state machine; the shared recovery gate then authorizes the dedicated compensation continuation.
- The regression also confirms the original task work is not re-run after approval.

## v0.80.0 (Compensation approval boundary)

- High-risk compensation steps now request a durable human approval before tool execution. Explicit step policy, compensation policy, and dangerous side-effect verbs all enter the same approval boundary.
- Approval is stored in the task ledger. Approval resumes only the dedicated compensation queue; rejection remains a recoverable blocked handoff and never restarts the original work.
- Approved compensation clears its temporary handoff so the shared recovery gate can permit the dedicated continuation path.

## v0.79.0 (Recovery resume gate)

- Resume commands now calculate the durable recovery plan before TaskWorker state changes. A blocked task is rejected with its recovery plan instead of being incorrectly requeued.
- The gate protects all resume entry points that use the shared worker command IPC, not only a specific chat or team screen.
- A dedicated regression verifies the plan check occurs before Worker dispatch and returns the actionable recovery result to the caller.

## v0.78.0 (Recovery plan)

- TaskService now derives a recovery plan from the durable task tree: root resumability, concrete blockers, safe compensation order, and the single next action are returned together.
- Compensation issues are ordered deepest-first so a parent cannot be resumed or rolled back ahead of an unresolved descendant.
- The plan is exposed through Electron IPC and verified against a task tree containing a child authorization handoff and blocked compensation.

## v0.77.0 (Task tree audit projection)

- TaskService now exposes a durable task-tree projection for a root task, including descendants, hierarchy depth, status, blockers, next actions, step counts, verified deliverables, and compensation outcomes.
- The task-tree projection is available through a typed Electron IPC endpoint, so recovery, diagnostics, and future UI consume one ledger-derived source of truth.
- Regression coverage creates a parent and child task with an authorization handoff and blocked compensation, then verifies the ordered tree and aggregate status counts.

## v0.76.0 (Queued parent compensation)

- A stopped task that was waiting in the native queue now receives a dedicated compensation queue entry instead of losing its rollback because it has no active `execute()` loop.
- The compensation entry waits behind an active descendant, preventing concurrent tool execution and ensuring child cancellation or compensation settles first.
- Native queue state distinguishes ordinary work from `compensating_queue`, and regression assertions protect the dedicated queue path.

## v0.75.0 (Queued child compensation ordering)

- Stopping a parent task now propagates to queued descendants before the parent begins its own compensation.
- A queued child has no active execution catch block, so the cascade explicitly runs its declared compensation and records a dedicated completion event before the parent can roll back shared state.
- Child-task dispatch regression coverage protects this ordering rule alongside existing lifecycle and handback checks.

## v0.74.0 (Compensation handoff)

- Missing compensation targets, unavailable compensation owners, and child-task-only compensation routes are now persisted as explicit ledger outcomes instead of being transient executor events.
- A blocked or missing compensation produces a recoverable handoff with the affected original step, concrete reason, and the one next action needed to resolve it.
- Task metrics now expose compensation totals and their completed, blocked, and failed counts. Normal completion validation excludes `compensationOnly` steps until a rollback is actually required.

## v0.73.0 (Executable compensation)

- A completed side-effecting step can now declare a concrete compensation step. When the task is stopped, closed, or ends in an execution failure, the native executor runs those declared compensations in reverse order.
- Compensation-only steps are excluded from normal task scheduling and completion checks. They run only during recovery, require a real successful tool call, and preserve their own completion or failure evidence in the task ledger.
- The ledger, recovery capsule, runner history, and execution events now record compensation start, per-step result, blocked owners, missing declarations, and failed rollback evidence. A native end-to-end regression stops live work and verifies that its rollback tool action actually executes.

## v0.72.0 (Unified manual delegation)

- Manual delegation through the native adapter now creates and persists a real child task, not only a visual delegation record.
- The delegated parent step is marked as child-owned and receives the child task ID through the same durable contract used by model-initiated delegation.
- When a parent job is already active, manual child tasks enter the native queue immediately; otherwise they remain recoverable and will start when the parent resumes.

## v0.71.0 (Child-task failure reconciliation)

- A failed or stopped child is now reconciled into its parent delegation and parent dependency step before the parent task enters its own failure handoff.
- The parent record retains the concrete child error, preventing a misleading "waiting" state after a child has already terminated.
- Native regression coverage now verifies failed-child propagation alongside dispatch, recovery, handback, and lifecycle controls.

## v0.70.0 (Child-task recovery resume)

- When a recovered parent finds a queued child task without an active native job, it now resumes that child automatically and yields until the real result returns.
- Restored child execution prefers persisted executable member configuration and safely falls back to the parent job's currently claimed team configuration for legacy snapshots.
- Paused and awaiting-user child tasks remain explicit blockers; they are not silently restarted by the parent.

## v0.69.0 (Child-task lifecycle control)

- Child tasks now inherit the parent team member snapshot, including the employee model configuration required for native execution.
- Pause, resume, stop, and close controls now cascade from a parent task to every non-terminal descendant; closing a parent stops descendants but preserves their audit records.
- Queued child jobs are removed from the native queue when paused or stopped, preventing background execution after the parent has been controlled.

## v0.68.0 (Verified child-task handback)

- A completed child task now returns a structured handback to its parent: verified deliverables, step summaries, task goal, and completion timestamp.
- The parent delegation step records the handback as verified evidence and the parent task preserves it for downstream model context after queue recovery or restart.
- Parent steps can consume completed child results without treating an in-progress child step as locally runnable.

## v0.67.0 (Durable child-task dispatch)

- Dynamic delegation now creates a child task for the resolved employee, binds its ID to the parent delegation step, and submits it to the native execution queue.
- A parent task yields its queue slot while a child is active; child completion or failure is synchronized back into the parent step, delegation record, runner plan, and team execution projection.
- This removes the previous false delegation state where a child task could be recorded but never enter an execution queue.

## v0.66.0 (Direct-chat worker lease)

- Executable assistant and employee chat tasks now claim the existing TaskWorker lease and renew it every 10 seconds while executing.
- On task completion, failure or a thrown client error, the lease is released; after a crash, the existing lease-recovery path can safely pause the interrupted task.
- A regression test now proves TaskService records are compatible with TaskWorker claim, heartbeat and release commands.

## v0.65.0 (Durable execution heartbeat)

- Executable assistant and employee chat tasks now persist controller heartbeats with execution phase, workspace and a 90-second lease.
- A restart can distinguish a completed task from one whose last active lease expired, instead of silently treating the last chat bubble as the truth.
- Heartbeat writes are drained before completion is evaluated, preserving the final observed state in the audit record.

## v0.64.0 (Verified chat artifact projection)

- Structured file evidence from assistant and employee chat tool calls is now written into the durable task record before completion is evaluated.
- Task artifacts retain logical path, disk path, workspace, byte size, content type, category, and read-back verification state.
- Only the native tool runtime can provide verified-on-disk evidence; chat text still cannot create a fake deliverable record.

## v0.63.0 (Direct-chat task service migration)

- Assistant chat and employee direct chat now create a durable TaskService task only after the shared decision kernel classifies a request as executable.
- Tool start/result events, bound Skill or conversation references, model token usage, controller stop/failure state, and completion-gate result are written to the same task record.
- Employee retry attempts reuse the same idempotency key, so a transient model failure resumes one durable task instead of creating disconnected records.
- Conversation-only messages remain lightweight and are not forced into the execution ledger.

## v0.50.4 (Durable conversation references)

- Chat now persists concrete references for Skill candidates, web pages, files, tasks, teams, employees, and completed answers.
- Follow-ups such as "send its link", "install it", and "read that rule" resolve the previous real object before tool routing; they do not re-search a similarly named object.
- Multiple matching objects require clarification rather than an arbitrary action. Assistant chat and employee direct chat share the same behavior.
- SkillHub discovery now has a typed official-market route and post-search source identity can be carried into installation and verification.

## v0.50.3 (Runtime-aligned assistant persona)

- 助理默认人格升级为 v12，与任务合同、Skill 证据、团队调度、上下文恢复和最终验收协议同步。
- 明确区分“已选择、已读取、已调用、已完成”，避免把 Skill 读取或工具成功误报为最终完成。
- 增加成员职责隔离、用户插话恢复、前置步骤等待和授权阻塞的行为约束。

## v0.50.2 (Employee Skill evidence)

- 员工单聊保留显式选择的 Skill 上下文和读取结果。
- 员工实际调用 `search_skills`、`read_skill` 或 `install_skill` 时记录真实成功/失败证据，并同步显示在回复下方。
- 重试和排队的员工任务保留 Skill 选择，不再只保留一段无来源的规则文本。

## v0.50.1 (Explicit Skill evidence in chat)

- 修复聊天窗口中 `@Skill` 只在输入框显示、发送后用户气泡看不到的问题。
- 显示 Skill 的选择、规则读取、实际工具调用和读取失败证据，避免把“已选择”误认为“已调用”。
- 显式选择的 Skill 规则会在任务决策前注入上下文，降低被普通 `web_search` 路由覆盖的概率。

## v0.50.0 (Team hall and in-chat authorization)

- 将“自主办公”入口改为“团队大厅”，只展示已经创建的团队，不再把待授权项目草案混在团队列表中。
- 团队大厅支持成员头像纵向滚动、团队用途说明、打开、重命名、归档、恢复和删除；删除团队会清理成员当前团队引用，但保留任务运行记录。
- 团队授权卡片移动到章北海助理聊天窗口，提供明确的“批准并组建团队”和“驳回”操作。
- 项目团队创建时持久化团队用途、创建时间和更新时间，驳回原因保留在项目记录中。

## v0.49.0 (Unified team execution protocol and release gate)

- v0.41-v0.49 完成统一执行协议：团队首发言、成员责任、步骤依赖、状态投影、计时、恢复、重试分类、跨窗口同步、Skill/Connector 决策证据、交付物索引和审查责任回退。
- 原生 Worker 的步骤开始、完成、失败和审查事件现在写入同一份团队协议，避免“助理说已调度但没有真实执行状态”。
- 新增 `verify:team-execution-protocol` 与 `verify:v049-release-gate`，发布前校验协议、构建、任务内核、技能、连接器、恢复和版本锁定。

## v0.40.0 (Team window recovery and live execution projection)

- 修复批准组建团队后偶发打开“团队不存在”空白窗口的问题：团队快照、首条消息和聊天子窗口初始化现在可恢复同步。
- 助理在正式执行前先复述需求、拆解顺序并点名成员；后续步骤继续等待前置步骤真实结果。
- 工具调用和原生 Worker 运行步骤实时投影到员工头像状态，执行完成或停止后恢复为空闲。
- 团队执行提示增加进行中流光状态，完成后停止动画，并保留已用时计时。
- 聊天执行过程过滤 Base64、data URL 和超长编码，真实证据仍保留在任务账本与回放中。

## v0.39.0 (Unified release and acceptance gate)

- 新增统一版本门禁 `src/engine/releaseGate.mjs`，集中校验版本号、锁文件、关键内核文件和核心回归结果。
- 新增 `verify:v039-release-gate`，实际执行构建、Lint、任务合同、执行控制器、任务运行器、团队 @ 路由、交接协议、状态机、执行协议、Skill 证据、动态委派和恢复胶囊回归。
- Windows 客户端改用内置 `build/icon.ico` 作为安装包和桌面快捷方式图标。
- 本版本已完成 Windows 安装包构建，待本地安装验收后发布 GitHub Release。

## v0.38.0 (Recovery capsule v2)

- 恢复胶囊保存合同版本、Plan ID、计划指纹、结构化交接、下一个候选步骤和恢复条件。
- 任务恢复提示优先展示已完成证据、未完成步骤、交接下一步和恢复条件，避免重启后重新猜测任务。

## v0.37.0 (Dynamic delegation v2)

- 委派同时评估员工姓名、职责、提示词、人格、在线状态和工作状态，记录选择理由与可用性。
- 委派拒绝不存在的依赖，并增加委派状态迁移校验，避免助理口头调度但没有实际成员或步骤。

## v0.36.0 (Skill evidence flow)

- Skill 匹配、读取、读取失败和调用阶段统一写入结构化证据，避免只显示“检索过”而无法确认是否真正读过规则。
- Skill 证据支持去重、来源、匹配分数和验证状态，供任务验收与恢复使用。

## v0.35.0 (Unified execution protocol)

- 工具注册表统一接入输入校验、输出校验、审批边界、幂等要求、重试策略和执行阶段。
- 执行失败按权限、网络、限流、校验和配置分类，只有可重试类别允许自动重试。

## v0.34.0 (Task state machine)

- 任务运行状态改为显式状态机，非法迁移会被拒绝并保留原状态。
- 暂停、等待用户、失败、恢复和完成路径统一经过状态迁移校验。

## v0.33.0 (Structured task handoff)

- 新增结构化任务交接协议，保存完成项、完成证据、阻塞分类、责任人、下一步、恢复条件、尝试路线和风险。
- 任务失败或中断后可按交接内容继续，不再只依赖聊天记录猜测上下文。

## v0.32.0 (Task Contract v2)

- 将任务合同升级为 v2，统一保存用户原始请求、清洗后的真实目标、不可丢失约束、验收标准、预期交付物、所需能力、风险等级和团队策略。
- 团队任务、任务恢复和模型决策共用同一份合同，不再由不同入口各自重新解释用户目标。
- 交付物增加格式、交付类别和是否必需字段；能力需求统一记录为 `coding`、`file_output`、`web_research`、`skill_selection`、`team_coordination` 等能力标识。
- 团队合同记录明确点名成员和是否允许动态委派，为后续 DAG 调度和成员冲突控制提供固定输入。
- 模型任务决策 Schema 支持交付物、能力、风险和团队策略；展示合同同时保留可读的决策依据，不输出隐藏思维链。
- 旧任务在恢复时会自动重新生成当前版本合同，保留原任务目标和已有执行状态。
- 修复团队消息的直接 `@` 路由：普通追问、进度确认和上下文跟进会进入被点名员工自己的模型对话，不会因旧任务结束而静默；明确写、改、执行、生成等请求仍创建正式 TaskRun。
- 助理回复中的明确员工点名会继续投递给对应员工，并保存回复关系、上下文、模型用量和失败信息；员工回复不会再次触发助理或创建循环任务。
- 新增 `verify:team-mentions` 回归，覆盖普通回复、正式派活、控制消息和助理转发。
- 本版本只更新核心代码、回归脚本和说明，不生成或发布 Windows 客户端。

## v0.31.4 (Unified native artifact projection)

- 修复原生 Electron 执行器已经真实写入 `.md`、代码或其他文件，但团队/员工聊天的产出物面板看不到文件的问题。
- 原生执行事件现在携带团队、任务、工作区和 artifact 信息；渲染层按同一事件流回读真实文件并登记到共享产出物索引，窗口重启后也会从任务账本恢复。
- 交付成功门禁不再接受只有口头结果或不完整 `verified` 标记的证据，必须有磁盘持久化、真实路径和验证信息。
- 工具明细继续保留在任务账本和回放中，聊天只展示步骤摘要，避免把底层调用平铺成大量聊天气泡。
- 本版本仅用于本地安装验证，不发布 GitHub Release。

## v0.31.3 (Explicit member selection)

- 点名员工时不再受自动推荐人数上限影响，明确姓名的员工全部进入项目草案；未点名时仍限制自动推荐数量。

## v0.31.2 (Team dispatch routing)

- 明确“拉团队/组建团队”时，助理先进入项目调度流程，不再把团队委派误路由为工作区检索。
- 助理每次调度都会重新读取共享员工配置；明确点名的员工优先加入项目草案，自动匹配专员时也不再由助理直接代做。
- 正在执行时收到团队委派要求，会先停止当前路线并保留已有文件，再创建团队草案。

## v0.31.1 (Avatar upload limit)

- 自定义员工头像及在线头像保存前的大小上限统一调整为 `10MB`。
- 本版本仅用于本地安装验证，不发布 GitHub Release。

## v0.31.0 (Skill mention picker usability)

- Fixed the `@` Skill picker being clipped by the chat composer overflow container.
- Added a visible Skill search field and empty/loading states.
- Expanded the picker from 8 truncated candidates to a scrollable list of up to 100 filtered Skills.
- Kept the picker shared across assistant chat, employee direct messages, and team chat.

## v0.30.0 (2026-07-29)

### Skill installation and IMA connector reliability
- Added a client-native SkillHub installation route. Explicit SkillHub requests no longer fall through to `skillhub.bat` or an unavailable `python3` executable.
- Added SkillHub download URL handling, atomic ZIP installation, post-install read-back verification, and clear failure stage reporting.
- Added native IMA knowledge-base and note actions with bounded retries, latency evidence, business-error reporting, and secret redaction.
- Added regression coverage for the native Skill route, IMA actions, retry behavior, malformed responses, and shell exit-code propagation.

## v0.29.0 (2026-07-29)

### 分层记忆与双重经验
- 新增组织、团队、员工、用户四层结构化记忆；团队共享经验与员工个人经验在执行前共同检索，当前用户要求始终优先。
- 记忆使用带 SHA-256 校验的 JSON 事实源、原子写入、损坏隔离、容量限制、脱敏、中文相似度去重和可重建 Markdown 投影。
- 助手、员工私聊和团队任务统一接入分层记忆；配置同步升级到 schema 3，可迁移非敏感记忆。

### 异步复盘与 Skill 草案
- 任务终态旁路进入持久化复盘队列，客户端重启后可恢复；真实验收路线直接沉淀，模型推断先生成待审批记忆建议。
- 设置新增独立审查模型、记忆写入审批和“四层记忆与学习”管理区，可查看容量、审批建议并重试失败复盘。
- 重复稳定流程只生成隔离 Skill 草案；批准后才可原子安装，且只允许精确更新太极自动生成的 Skill，内置和手动 Skill 禁止后台改写。

### 上下文、历史与诊断
- Context Router 将 assistant 工具调用及其结果作为原子消息组处理，压缩时不再拆散调用对。
- 任务历史检索覆盖步骤、工具事件、验收证据、交付文件、失败原因、恢复摘要和执行消息。
- 生态健康协议升级到 v2，新增记忆事实源与复盘队列检查；发布门禁加入四项新专项回归。

## v0.28.0 (2026-07-29)

### 生态健康与统一诊断
- 新增生态健康协议 v1，在主进程真实检查版本与兼容数据身份、任务账本、后台 Worker、工具注册、安装 Skill、物理工作区和 Git Worktree。
- 设置诊断中心新增“任务内核与恢复”，七个面向用户的诊断领域统一显示可用、提醒、阻塞原因和下一步。
- Git Worktree 不可用只影响代码隔离任务；任务账本、Worker、工具、Skill 或工作区等核心故障会明确阻止升级验收。

### 升级与发布闭环
- 新版本启动后的升级验证同时核对本地数据数量、工作区和主进程运行健康；核心健康检查失败时升级日志标记为验证失败，可继续回滚。
- 最终发布门禁新增 Context Router、动态委派、Git Worktree 和生态健康回归，并继续执行原有 Lint、内核、连接器、Skill、搜索、Word 与 Windows 打包验收。
- `v0.23.0` 至 `v0.28.0` 连续升级只在本版本统一发布，减少中间安装包反复覆盖和人工验证节奏打断。

## v0.27.0 (2026-07-28)

### Git Worktree 任务隔离
- 本地代码任务可创建独占分支和物理工作树；同一仓库的多个任务不会覆盖彼此文件。
- 恢复点保存 HEAD、已跟踪差异、未跟踪文件内容及 SHA-256，工作树目录丢失后可确定性重建。
- 有未提交修改时拒绝清理；普通文件、知识库和聊天任务不依赖 Git。

## v0.26.0 (2026-07-28)

### 动态委派与局部回退
- 新增动态子任务协议，模型和用户都可在运行中追加明确、可验收且绑定责任员工的子任务。
- 子任务同步进入正式 Plan/Runner 和持久化任务记录，客户端重启后仍能恢复。
- 审查不通过只追加责任子任务的修订与复审步骤，不重跑已完成的无关工作。

## v0.25.0 (2026-07-28)

### Context Router 与预算管理
- 运行中插话会区分控制、纠错、进度追问、新约束和独立任务，再决定抢占、合并或排队。
- 原目标、已验证证据、未决问题和最新约束写入恢复胶囊；任务恢复不再依赖散乱聊天历史。
- 上下文、模型轮次、工具调用和无进展次数达到阈值后先压缩或换路线，预算耗尽时保存恢复点并安全暂停。

## v0.24.0 (2026-07-28)

### 任务账本与恢复点
- 任务事件账本继续作为唯一事实源，快照和查询索引增加 SHA-256 完整性校验并可从事件确定性重建。
- 新增任务、团队、状态、时间和关键词查询，以及任务级或全量恢复点。
- 恢复操作通过追加事件完成，不改写既有审计历史；损坏快照和索引会从有效账本自动重建。

## v0.23.0 (2026-07-28)

### 统一工具注册中心
- 新增工具注册协议 v1，统一登记工具来源、能力、运行时、风险、审批方式、健康状态和参数 Schema 指纹。
- 助手、员工私聊、团队旧执行器和主进程原生执行器统一从注册中心获取可用工具；连接器动态工具不再绕过注册边界。
- 重名工具、损坏定义和不健康工具会被隔离，不再交给模型调用。

### 发现与调用前预检
- 工具支持按名称、说明、来源和能力检索发现，为后续 Skill/Connector 生态提供稳定目录。
- 每次真实执行前检查工具是否注册、必填参数、参数类型、枚举值和审批边界；失败返回通俗的预检原因。
- 主进程为每个步骤记录工具注册协议版本、可用数、隔离数、冲突和损坏项。

### 诊断与回归
- 诊断中心新增“工具注册中心”，显示当前可用工具数量、来源分布和隔离原因。
- 新增 `verify:tool-registry`，覆盖内置与动态工具、Schema 指纹、缺参数、未知工具、审批提示和重名隔离。

## v0.22.0 (2026-07-28)

### 跨启动后台任务队列
- 主进程原生 Execution Adapter 改为串行后台队列，公开当前任务、排队顺序和队列总数；多个团队任务不再同时争抢模型与工作区状态。
- 原生 Worker 租约遇到客户端重启时自动回到 `queued`，渲染进程从本机模型配置重新注入凭据并从未完成步骤继续；API Key 仍不进入任务账本。
- `TaskRecoveryContext` 增加自动恢复与等待条件，已完成步骤、工作区、证据和插话在进程重启后继续保留。

### 插话抢占与等待用户
- 运行中插话会立即取消当前模型请求，写入抢占事件并把当前步骤重新排队；下一次请求同时保留原目标和最新约束，不再等旧请求完整结束。
- 需要账号、授权、配置或业务选择时，TaskRun 进入独立 `awaiting_user` 状态，不再被记成普通失败；用户继续后从当前步骤恢复。
- 团队任务卡显示排队中、执行中、等待你处理、已暂停、待恢复和已完成，并为等待状态提供继续与停止控件。

### 办公室与团队扩容
- 办公室预设 999 个工位，超过 999 名员工后仍按实际人数继续扩展，没有硬编码人数上限。
- 办公室、员工列表和团队成员头像区支持独立滚轮；窄团队窗口不再压缩头像，所有主题沿用相同布局规则。
- 团队聊天和团队菜单增加成员管理，助手可识别“把某员工加入团队”并修改真实成员名单。

### 回归覆盖
- 扩展 `verify:native-execution`，覆盖串行排队、等待用户、插话请求取消、抢占后续跑和凭据不落盘。
- 新增办公室 999/1001 人、真实滚轮、团队成员维护和窄窗口头像滚动回归。

## v0.21.0 (2026-07-28)

### 主进程原生 Execution Adapter
- 新增 `electron/nativeExecutionAdapter.cjs`，团队模型请求、工具循环、步骤依赖、Worker 租约、心跳、检查点、暂停和停止全部由 Electron 主进程执行；关闭团队窗口不再终止任务。
- 渲染进程在 Electron 下只提交任务定义、员工有效模型、一次性连接器配置与审批策略，并从主进程任务投影恢复进度；浏览器开发环境保留旧执行器作为兼容回退。
- 主进程执行消息写入 `TaskRun.executionMessages`，重新打开团队窗口后按消息 ID 合并工具调用与员工回复，不会因窗口关闭丢失可观察进度。
- 运行中插话通过独立 IPC 注入当前原生 Job，下一轮模型会合并原目标和用户新约束；暂停、停止和关闭继续沿用 Worker 权威控制命令。

### 原生工具与验收
- 新增 `electron/nativeToolRuntime.cjs`，在主进程统一执行工作区文件、Word、命令、联网搜索、Skill、网页知识库、Obsidian、连接器 Action 与结构化审查。
- 完全相同的工具调用不会重复执行；连续只读路线会被催促转向真实动作，搜索词固定保留原始目标，文件交付与审查步骤必须留下客户端证据。
- API Key 与连接器凭据只保存在当前主进程 Job 内存中，不进入 TaskRun、JSONL 账本、Worker 命令或界面事件；工具参数写入投影前统一脱敏。
- 新增 `verify:native-execution`，覆盖无界面订阅继续执行、重复工具拦截、文件与审查证据、暂停中断以及凭据不落盘；打包验收确认原生 Adapter 和所需 Engine 模块进入 ASAR。

## v0.20.0 (2026-07-28)

### Execution Adapter v1
- 新增 `electron/executionAdapterProtocol.cjs`，定义版本化检查点协议：`step_started`、`step_completed`、`step_failed`、`run_failed` 和 `run_finished`。
- 主进程 Worker 新增 `checkpoint` 命令，检查点必须持有匹配租约并严格递增；协议版本、步骤 ID 和最终状态在写入前统一校验。
- 团队执行 Adapter 在普通步骤、审查结论、运行失败和最终验收处上报检查点；检查点串行落盘完成后才释放租约，避免任务收尾丢记录。
- 主进程任务存储保护 Worker 权威字段和检查点对应状态，旧渲染快照不能回退已完成步骤、失败结论或暂停/停止状态。
- 任务详情显示最新检查点编号与摘要；Worker 回归覆盖重复序号拒绝和旧快照竞态。
- 本版本仍由渲染进程 Adapter v1 执行模型和工具调用。主进程已拥有稳定的任务生命周期与步骤检查点协议，后续原生 Adapter 可在不改变 UI 控制协议的情况下替换执行实现。

## v0.19.0 (2026-07-28)

### 主进程 Worker 控制平面
- 新增 `electron/taskWorker.cjs`：主进程持有任务租约、心跳、暂停、恢复、停止、关闭和过期恢复，Worker 命令追加写入 `task-commands.jsonl` 并带 SHA-256 哈希链。
- Worker 命令支持 `commandId` 幂等；命令日志损坏尾部会隔离恢复。新 Electron 会话发现旧会话仍占用租约时会安全暂停任务，而不会重复继续执行。
- 团队运行器在执行前领取租约、每 5 秒心跳，并通过 Worker 统一处理暂停、恢复、停止与关闭。任务详情和回放增加 Worker 状态及只读命令记录。
- 新增 `verify:task-worker`，并扩展 Electron 基础验收以覆盖真实 IPC 的领取、心跳、暂停、命令读取和关闭。
- 本版本尚未将模型和工具调用迁入主进程。它们仍由现有渲染进程团队执行器作为第一执行适配器，Worker 先负责可恢复的生命周期控制和审计边界。

## v0.18.0 (2026-07-28)

### 追加式任务事件账本
- 新增 Electron 主进程 JSONL 事件账本，任务创建、变化、移除和旧快照迁移均写入版本化事件；事件包含严格序号、来源会话、状态迁移、变化域和 SHA-256 哈希链。
- `task-events.jsonl` 成为任务运行状态的唯一事实源，`task-runs.json` 仅作为可重建的投影缓存；客户端重启会从账本完整回放，不再信任可能滞后或被修改的快照。
- v0.17 任务快照在首次启动时自动转为迁移事件，不清空员工、团队、模型、聊天或任务数据。
- 账本发现无效 JSON、断裂序号或错误哈希时，将损坏尾部隔离到独立文件，保留有效前缀并重建任务投影。
- 主进程写入使用可恢复串行队列；重复状态不追加事件，并发更新保持顺序，落盘失败不会提前污染内存投影。

### 回放与验证
- 新增账本读取 IPC，渲染层写入携带执行会话和来源；团队任务回放优先展示事件序号、类型、来源、状态迁移、变化域和时间。
- 回放面板显示“账本完整”或“已恢复损坏尾部”；无账本旧任务继续使用上下文与 Runner 兼容回放。
- 扩展任务存储回归，覆盖迁移、哈希链、创建/更新/移除、去重、并发、从账本重建、损坏尾部恢复和无效写入。

## v0.17.0 (2026-07-28)

### 长任务上下文压缩
- 任务上下文升级为 v2，结构化保存确定性叙事摘要、已验证事实、已完成步骤、交付文件、未决问题和关联历史任务。
- 上下文保留最近 120 条可回放事件，提示词只注入压缩摘要和最近 18 条记录，避免长任务无限堆叠历史文本。
- 长任务达到事件数与内容量阈值后，异步调用助理模型生成不超过 500 字的导航摘要；摘要失败不影响任务，模型文本也不能覆盖结构化事实。
- 旧版 v1 上下文在加载时自动迁移，员工、团队、模型、聊天和任务数据不清空。

### 跨会话检索与只读回放
- 新增中文双字匹配的历史任务检索，按目标、摘要、已验证事实、交付文件、阻塞和事件加权排序。
- 新任务启动时自动检索相似历史任务，只读注入已验证路线和历史阻塞；旧记录禁止覆盖当前目标、输入和验收标准。
- 团队右侧任务栏新增跨团队历史搜索，结果展示团队、状态、摘要、事实和交付文件数量。
- 任务详情新增只读回放，按时间合并展示任务上下文事件与 Runner 事件，摘要、事实和交付文件保持可折叠。
- 新增 `verify:task-history`，扩展 `verify:task-context` 覆盖 v1 迁移、120 条压缩、模型摘要边界和历史关联。

## v0.16.0 (2026-07-28)

### 结构化交付与审查协议
- 新增版本化 `ToolExecutionEvidence`，文件交付记录相对路径、文件名、任务工作区、磁盘路径、大小、内容类型、交付类别、持久化方式和验证方式。
- `write_file` 在磁盘写入后重新读取文本并比对；Word 沿用主进程生成后重读校验。仅登记在渲染进程的文件不会标记为已验证。
- `run_command` 创建或修改的工作区文件统一同步为结构化交付事件，不再只返回“同步了若干文件”的文字。
- 新增 `submit_review` 工具。审查步骤必须提交 PASS/REJECT、具体理由、责任步骤/员工和实际检查文件，聊天里的口头结论不再直接改变任务状态。

### 正式 Plan 修订图
- `TaskRunner` 新增审查事件与动态步骤扩展；审查退回后把责任步骤、修订步骤和复审步骤写入正式 Plan，而不再只追加界面步骤。
- 修订与复审继续受依赖检查、幂等、持久化和恢复约束；验收不通过不会跳到无关后续步骤。
- 团队面板新增“交付文件事件”和“计划图事件”，展示文件落盘状态、交付分类、审查退回和新增修订节点。
- 新增 `verify:execution-evidence`，并扩展 `verify:task-runner` 覆盖“退回 → 责任修订 → 复审通过”的完整状态循环。

## v0.15.0 (2026-07-28)

### 统一 Connector 执行协议
- 新增独立 `ConnectorProtocol`，所有动态连接器 Action 固定执行输入 Schema 校验、权限检查、dry-run、真实调用、输出 Schema 校验和完成确认。
- HTTP、MCP、网页知识库和 Obsidian 继续复用现有适配器，但成功与失败改由结构化协议结果判断，不再匹配中文错误前缀。
- 连接器错误统一分类为认证、权限、限流、超时、网络、服务端、参数、配置和未知错误，并标记是否可重试。
- 输入、输出、错误和协议事件写入任务前统一脱敏；API Key、Token、密码和凭据不会进入任务证据。
- 发送、发布、写入等副作用 Action 使用确定性幂等键和五分钟结果缓存，相同调用重试时复用已验证结果，不重复影响外部服务。

### 客户端证据与验证
- 工具结果新增 `protocolEvidence`，沿 Agent 循环、团队成员步骤和任务持久上下文传递，成功状态只取客户端协议，不取模型表述。
- 团队任务详情新增“连接器证据”，显示连接器、Action、协议阶段、耗时和幂等状态，悬停可查看每一步客户端事件。
- 新增 `verify:connector-protocol`，覆盖完整六阶段、权限拒绝、输入/输出失败、网络分类、敏感信息脱敏和副作用幂等。

## v0.12.0 (2026-07-28)

### 任务合同与 Plan 基础层
- 新增版本化 `TaskContract`，固定用户原始目标、不可丢失约束、完成标准、证据要求和待用户提供条件。
- 新增版本化 `TaskPlan`，统一描述步骤、依赖、输出格式、重试策略、幂等键、补偿步骤和审批点。
- Plan 校验会拒绝重复步骤、缺失依赖、循环依赖、缺少输出规范，以及没有幂等键的副作用步骤。
- Plan 支持序列化与重新解析，为下一步 SQLite 持久化、Runner 恢复和任务回放建立共同格式。
- 新增 `verify:task-plan` 回归，现有助理、员工私聊和团队执行路径保持不变。

## v0.11.1 (2026-07-28)

### 目标一致性内核
- 新增 `taskFidelity`：从用户原始请求提取不可丢失的时间、地点、主题、指定工具和交付格式；任务决策模型只能分类和规划，不能再把完整目标改写成更短但偏题的目标。
- 用户纠正执行方式时会保留原任务并合并新增约束，例如“必须使用生图工具而不是直接写 SVG”，不再只恢复旧目标而丢掉最新限制。
- 工具调用前增加目标匹配检查；模型生成的联网搜索词统一从用户原始目标构造，地点、时间和主题缺失时直接拦截。指定生图工具时写 SVG、指定 Word 时写其他格式等错误路线不会真正执行。
- `ExecutionController` 新增目标一致性验收：工具有返回值不再等于完成；证据和最终回答必须覆盖任务合同，偏题时自动切换路线，多条路线仍不符合时如实停止。

### 联网结果可信度
- 搜索源返回内容后先检查是否覆盖原问题中的关键地点、时间和主题；百科、景点或地方介绍不能再冒充实时天气，旧闻也不能冒充“今天/最新”。
- 原始搜索结果只有与目标相关时才能进入整理、来源链接和兜底回复；所有结果偏题时明确报告“未取得可靠结果”，不再把无关内容整段展示给用户。
- 天气请求优先使用免密结构化实时数据源，返回并核对地点、日期、当前温度、体感、湿度、风向、今日温度范围、降雨概率和紫外线；失败后才尝试通用搜索，并继续受相关性门槛约束。
- 新增回归覆盖：模型把“今天安徽省滁州市全椒县天气”缩成“安徽省”、搜索返回安徽百科、指定生图工具却写 SVG、最终回答未覆盖原目标，以及真实全椒县天气数据查询。

## v0.11.0 (2026-07-28)

### 任务决策内核
- 新增 `taskDecisionKernel`：每条用户消息先由同一模型强制编译为结构化任务合同，包含模式、真实目标、首选路线、完成标准、证据要求和必要用户条件；模型不支持函数调用时使用确定性安全规则兜底。
- 助手、员工私聊、团队步骤与自主任务都继续经过 `runAgentLoop`，统一继承任务合同、`ExecutionController`、工具循环、失败换路线和独立验收，不再依赖人格提示词决定是否行动。
- 明确查询、实时资料、连接器、本地文件、文件产出、命令和“为什么不调用工具”的行为纠正，不能被降级为普通聊天；纯暂停、停止、状态询问和反馈仍不会偷跑旧任务。
- 新增首选路线约束：模型决策为具体可用工具时，第一轮会强制从该路线开始；联网搜索和连接器检查继续由客户端先取得真实证据。

### 记忆、经验与同步
- 用户长期记忆改为按当前任务相关度、重要性、置信度和时效筛选，不再机械注入固定最近条目。
- 新增任务经验库，记录真实执行后的成功工具路线、失败路线、阻塞类型、验收结果和复用次数；相似任务会先把这些经验注入任务合同。
- 设置 → 记忆新增“任务经验”可视化与清空入口，明确区分“了解用户”与“从任务中吸取经验”。
- 设置 → 备份迁移新增“导出同步配置”；同步文件现在可携带人格、画像、长期记忆和任务经验，`API Key`、密码、Token 等仍以本机占位符导出。
- 任务经验存储键迁移到 `hermes_office_*` 命名空间，覆盖安装、升级备份和回滚均可保留。

### 插话可靠性与验证
- 修复“暂停后正好中断模型请求，再插话会一直不回应”的竞态：执行控制器保存一次性插话唤醒信号，无论循环已在等待或稍后进入等待，都先回答新消息；答完仍保持原任务暂停。
- `verify:steering-e2e` 在隔离 Electron 窗口通过：插话优先回答、暂停状态保留、旧任务请求不再增长。
- 扩展 `verify:agent-kernel` 和 `verify:foundation-ui`，覆盖任务合同、行为纠正、显式新任务覆盖旧反馈、任务经验、配置脱敏同步、设置页任务经验显示与无横向溢出。
- 修复 `verify:foundation-ui` 的独立 TypeScript 加载器，使其可解析任务恢复所依赖的执行控制器模块。

## v0.10.1 (2026-07-27)

### 一键发布与跨电脑接力
- 新增 `npm.cmd run publish:release` 唯一发布入口，自动执行回归、Windows 打包、推送 `main`、创建或更新同版本 GitHub Release，并上传安装器、blockmap 和 `latest.yml`。
- 发布后同时核对远端 `main` 提交、Release 目标分支、三个资产的文件大小和 SHA-256；远端缺文件、传输不完整或摘要不一致都会明确失败。
- 发布与同步脚本统一从 Windows Git Credential Manager 读取现有 GitHub OAuth，只在当前进程使用，不保存或输出 Token。
- `release:win` 兼容命令已指向同一发布入口，移除交接文档中的旧临时脚本路径，办公室与家里不再分别维护上传方式。

## v0.10.0 (2026-07-27)

### 统一 ExecutionController
- 新增统一执行状态机，助理、员工私聊和团队任务共享“观察结果、判断进度、失败分类、重试或换路线、重新验收”的闭环，不再由各聊天入口分别根据提示词或回复文字猜测执行状态。
- 失败细分为认证、授权、审批、限流、超时、网络、服务端、权限、依赖、资源不存在、参数、冲突、重复、能力缺失、业务验收和未知错误；只有确实需要用户凭据、登录或审批时才等待用户。
- 相同工具路线遇到瞬时失败只自动重试一次，再次失败会禁用原路线并要求更换工具、参数来源或实现方式；替代路线取得新证据后会解除此前阻塞。
- 所有执行型请求必须取得真实工具证据，并经过独立目标复核才能完成；没有证据的模型口头完成声明会被客户端拒绝。

### 模型恢复与任务续跑
- 模型超时、断网、限流和服务异常纳入统一状态循环，每 10 秒保留上下文重试，最多 5 次；恢复后继续原任务，第 5 次仍失败才停止并保留真实进度。
- 员工私聊自动重试会持久化控制器快照、工作区、附件和上下文，避免重启成一项全新任务。
- 团队任务把路线历史、失败分类、证据和验收状态写入 `TaskRecoveryContext`；客户端重启或点击继续后从未完成步骤重新验证，不再只恢复文字摘要。
- 团队步骤成功或失败由控制器状态判定，不再依赖消息是否以警告符号开头；缺少要求的真实文件会直接进入验收阻塞，后续成员不会越过失败步骤。

### 可观察状态与回归
- 助理和员工私聊实时显示正在行动、瞬时重试、切换路线、等待必要条件和重新验收等控制器状态；团队成员状态与任务事件使用同一状态源。
- 新增 `verify:execution-controller`，覆盖网络重试后换路线、参数错误、认证边界、替代路线解除阻塞、无证据禁止完成、独立验收、快照恢复、运行中插话和 5 次模型重试。
- `verify:agent-kernel` 增加三条聊天入口统一接入、团队快照持久化及旧文本失败判断移除的静态防回归检查。

## v0.9.6 (2026-07-27)

### 连接器执行内核修复
- IMA 验证改为 Electron 主进程原生适配器直接调用固定官方端点，不再让 JSON 请求体穿过 PowerShell 命令行，修复引号损坏后出现“接口返回 code=缺失”的假错误。
- 原生适配器分别报告配置、网络、超时、HTTP、响应解析、业务验收和完成阶段，并返回 HTTP 状态、业务码、尝试次数与延迟；网络、408、429 和 5xx 最多自动尝试 3 次。
- 纯“验证、测试、诊断连接器”请求由客户端直接返回真实结果，不再调用模型二次加工，避免模型重复读取 Skill、寻找 README、索要命令或把验证责任推回用户。
- IMA 仍使用官方 Skill 作为公开规则来源，但真实执行与验收由客户端维护；连接器是统一能力入口，MCP 只是可选协议，IMA 当前不是 MCP Server。

### 命令与错误可信度
- Windows 通用命令外壳现在正确传播原生进程退出码；子进程失败时 PowerShell 不再错误退出 0。
- 空输出、畸形 JSON、HTTP 错误和业务错误不再被当作成功，失败原因保持脱敏并写入连接器状态。
- 新增连接器适配器回归测试，覆盖成功、业务失败、畸形响应、三次网络重试、凭据不泄漏和 PowerShell 退出码传播。
- Windows 打包固定使用项目缓存的官方免安装 Node 20.18.3，并核对官方 SHA-256 与实际运行版本，避免系统 Node 24 与旧版 ASAR 组合生成索引错位的不可启动安装包；构建后自动读取包内版本、入口和关键文件，验收失败时直接终止发布。

### 资料研究闭环
- 搜索得到候选结果后，客户端自动并行读取前 5 个可访问来源正文，再交给当前模型综合、去重并直接输出内容；网页内容按不可信证据处理，不能反向修改系统行为。
- “最新热点”等没有重复写“搜索”的追问也会触发真实检索，搜索词会剥离“跟我说、直接给我内容”等交付措辞。
- 新增交付拦截：模型不得只给链接、要求用户打开来源、贴截图或提供正文；页面无法读取时也必须基于可验证标题和摘要给出有限结论并标明证据边界。

## v0.9.5 (2026-07-27)

### IMA 官方能力完整内置
- 安装包完整内置 IMA 官方 Skill 1.1.8，包括总入口、笔记与知识库规则、API 文档、预检脚本、COS 上传脚本和官方调用脚本；用户只需在本机填写 Client ID 与 API Key。
- Skill 读取器会同时读取根 `SKILL.md` 明确引用的子模块 `SKILL.md`；连接器验收现在能识别位于 `knowledge-base/SKILL.md` 的 `search_knowledge_base`，不再错误拦截真实可用的 IMA 配置。
- 手动安装且仍有效的用户 Skill 继续优先使用；旧 Skill ID 失效时自动关联安装包内置版本，并把新关联持久化，避免每次启动重复失效。
- IMA 预设已内置官方说明页与 1.1.8 下载地址；配置窗口、助理准备流程、手动 `@技能`、自动 Skill 匹配和连接器验收统一使用完整规则包。
- 新增真实规则包回归测试，构造根规则引用知识库和笔记子规则，并通过 `readSkill()` 验证两个子模块及验收关键字确实可读。

### 外部 API 内置原则
- 后续外部 API 的公开能力适配器、Skill 规则、必要运行脚本和只读验收逻辑随安装包交付，避免依赖开发电脑上的临时文件。
- API Key、OAuth Token、验证码和账号凭据不写入安装包或 GitHub，只在用户电脑本机保存，并仅在批准的连接器进程中临时注入。

## v0.9.4 (2026-07-27)

### 连接器自主验证闭环
- “验证、测试、检查、诊断连接器是否可用”现在属于严格连接器任务，客户端会在模型回复前强制检查真实配置，不再因为意图漏判而只给出口头步骤。
- IMA Skill 连接器保存配置后会自动读取已关联 `SKILL.md`，核对官方脚本和查询规则，再通过只在本机 Skill 进程中注入的凭据执行最小只读查询；进程成功且 API 业务码通过才标记为已连接。
- 配置窗口保存后的助理请求沿用同一验证内核，用户不需要再次发送“继续配置”；失败会保留配置并显示 Skill 读取、命令执行或 API 业务状态的具体原因。

### 搜索结果交付闭环
- 修复搜索工具已经返回 8 条结果，但后续模型整理异常时仍被错误描述为“卡在查询资料”的问题；搜索成功和模型整理现在是两个独立、可观察的阶段。
- “查今日资讯并总结、带链接”等资料交付任务在搜索成功后不再携带整套工具定义，也不进入安装/开发任务的文件验收流程，模型直接完整阅读搜索结果并在聊天气泡中交付。
- 整理模型保留原搜索上下文，失败后每 10 秒重试，最多 5 次；最终仍不可用时，客户端直接用搜索标题、摘要和链接生成指定数量的可读结果。
- 模型遗漏链接时自动补齐选中资料的来源链接；搜索指令会剥离“5 条总结发给我”等交付格式，避免污染实际搜索关键词。
- 执行过程显示真实搜索结果数量，并在原有滚动区域中保留最多 12000 字符的搜索证据；原始资料仍归入执行过程，聊天正文只显示整理后的交付。

### 输入体验
- 助手清空聊天记录后主动恢复输入框焦点，避免大量历史记录卸载时短暂卡顿被误认为输入框失效。
- 员工私聊当前没有清空入口；团队“清理过程”仅删除旧执行记录，不改变输入框状态。

### 工程验证
- `npm.cmd run build`、`npm.cmd run lint`、`verify:foundation`、`verify:agent-kernel`、`verify:web-search`、`verify:tool-window`、`verify:assistant-background` 和 `verify:steering-e2e` 通过。

## v0.9.3 (2026-07-27)

### 真实联网搜索
- “今日、最新、实时、联网搜索”等明确依赖外部事实的请求由客户端先执行 `web_search`，再把真实结果交给当前员工模型整理；不再依赖模型在 `tool_choice: auto` 下是否主动选择工具。
- 搜索和公开网页读取统一使用 Electron `net.fetch`，继承 Chromium 与系统代理，不再走容易与客户端代理脱节的 Node `fetch`。
- DuckDuckGo HTML 作为中文资料主搜索源，Bing RSS 作为备用；每个源可自动重试，主源超时、空结果或 HTTP 失败后自动切换。
- 搜索指令会清洗为真实主题词，例如去掉“联网搜索一下”和“然后给我做简报”，减少搜索引擎误解长指令。
- 工具结果展示搜索源和耗时；双源失败时保留每次尝试的具体原因，主日志记录来源、次数、结果数与耗时，但不记录用户搜索词。

### Electron 本机运行时
- Windows 构建脚本除恢复 `electron.exe` 外，也会校验并补齐无换行的 `node_modules/electron/path.txt`，避免运行时已在本机却被误报为 Electron 安装不完整。
- 新增 `verify:web-search` 本地回归和 `diagnose:web-search` Electron 实网诊断。实测 DuckDuckGo 首轮空结果后自动重试成功，约 3.1 秒返回 8 条中文 AI 资讯。

### 工程验证
- `npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run verify:web-search`、`npm.cmd run verify:foundation`、`npm.cmd run verify:agent-kernel` 和 Electron 实网诊断通过。

## v0.9.2 (2026-07-27)

### 回滚下载可靠性
- 回滚安装包取消 120 秒整包总超时，改为 5 分钟无数据才判定连接停滞；慢速网络持续传输时不会被误判失败。
- 正式客户端回滚下载改用 Electron 网络栈，沿用 Chromium 与系统代理设置，避免 GitHub CLI 可连接而普通 Node 请求掉线。
- 下载使用 `.part` 临时文件和 HTTP Range 断点续传，网络中断最多自动重试 5 次；服务器忽略 Range 时会从头覆盖，禁止把完整响应追加成超大损坏文件。
- 已下载文件、等长临时文件、Release 记录大小和 SHA-256 会在启动旧安装包前统一校验；异常缓存自动丢弃，校验完成后原子改名为可执行安装包。
- 新增 `verify:update-download`，本地模拟半途断线、断点续传、服务器忽略 Range、等长损坏缓存和哈希不匹配。
- Windows 打包脚本发现 `node_modules/electron/dist/electron.exe` 缺失时，优先校验并解压本机 Electron 版本缓存；缓存不存在时才联网，避免每次构建重复下载运行时。

### 工程验证
- `npm.cmd run verify:update-download`、`node --check electron/releaseDownload.cjs electron/autoUpdate.cjs` 和 `git diff --check` 通过。

## v0.9.1 (2026-07-27)

### Skill 原子安装与修复
- 单文件、GitHub 目录和 ZIP Skill 统一使用“暂存、完整校验、备份、替换、失败恢复”事务，目标目录在新版本完全就绪前保持不变。
- 暂存内容会检查 `SKILL.md`、安装元数据、正文 SHA-256、文件数量、总体积、符号链接和引用文件；无效包不会触碰已安装版本。
- 替换失败会自动恢复旧目录，成功后清理备份；新增 `verify:skill-atomic` 回归，覆盖失败保护、成功替换、旧文件清理和哈希损坏拦截。

### 工程验证
- `npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run verify:foundation`、`npm.cmd run verify:agent-kernel` 和 `npm.cmd run verify:skill-atomic` 通过。

## v0.9.0 (2026-07-27)

### 八项稳定闭环
- **工作区隔离**：助手、员工私聊和团队任务每次请求创建独立工作区；自动重试、暂停和恢复继续使用原目录。新增受限附件复制 IPC，同名文件不会跨任务覆盖。
- **统一诊断中心**：设置首页一次真实检查模型、连接器与知识库、Skill、工作区和安全审批，并为每项展示可用状态、原因、处理入口和下一步。
- **上下文与预算管理**：团队任务持久化摘要、已完成证据、未决问题、运行中插话、工具尝试次数与上下文用量；客户端异常退出后转为“待恢复”，保留步骤和工作区。
- **Skill 健康与恢复**：扫描账号、环境变量、外部软件和引用文件要求；损坏 Skill 自动隔离，安装前先展示要求，来源明确的用户 Skill 支持重新安装修复并保存来源摘要。
- **任务验收与审查**：完成状态必须有文件、运行、连接、审查或人工证据；代码、安装、部署和连接器任务缺少对应验证时保持待恢复，审查退回只影响责任员工和对应步骤。
- **安全边界**：工具展示自动隐藏 API Key、Token、密码与验证码；命令和连接器分开审批；删除、付费、外发和凭据操作在完全访问模式下也必须单独确认。
- **升级与回滚**：更新前用 Windows 系统加密备份本地配置，更新后核对员工、团队、模型、任务和工作区；回滚先下载并校验旧安装包，再恢复配置并启动安装，下载失败不会改动当前配置。
- **太极品牌迁移**：产品、窗口、托盘、快捷方式、安装包和默认助理提示词统一为“太极”；保留内部包名、`appId`、用户数据目录和全部 `hermes_office_*` 键，旧配置无损继承。

### 工程验证
- 新增 `verify:foundation`，验证工作区隔离、附件复制布局、敏感信息隐藏、跨会话任务恢复和诊断中心五领域覆盖。
- 新增 `verify:foundation-ui`，在带调试端口的实际 Electron 客户端中复验工作区 IPC 与诊断中心五项渲染。
- 双机同步脚本优先识别 `taiji-office-setup-<version>.exe`，同时兼容下载 `v0.8.x` 及更早的旧安装包名。

## v0.8.11 (2026-07-27)

### 最新消息与任务边界
- 助手和员工私聊在等待模型、暂停等待及每次工具执行前都会先检查最新消息。暂停中的插话只临时唤醒一次用于回答，回答后仍保持暂停，不会先偷跑旧模型或旧工具。
- 聊天中直接说“暂停 / 继续 / 停止”与窗口按钮使用同一控制逻辑；停止后旧任务封存，普通反馈、状态询问和闲聊不会获得工具权限或重放旧任务。
- “这种操作没有意义、一直重复读取”等明确负面反馈会自动挂起当前任务，先结合真实进度回答。明确的新目标、修复要求和“把刚才的问题改掉”仍会被识别为可执行任务。
- 团队聊天同步任务边界：普通对话只由助理回答，不创建任务；暂停、继续和停止直接作用于现有任务，反馈不会被误建成新的团队项目。

### Agent 防循环内核
- 新增统一工具调用规范化、语义去重和资源级读取计数；同一个 Skill 在单次任务中只真实读取一次，重复参数、路径写法和大小写变化不能绕过限制。
- 连接器配置任务最多 24 次工具尝试、2 个执行阶段；连续只搜索/检查/读取、重复被拦截或单项工具超过合理次数时立即熔断，强制实际行动、换路线或明确交接真实缺项。
- 连接器任务必须先判断 HTTP、MCP、本地目录或 Skill 路线；未确认是 Skill 前禁止反复搜索和读取 Skill，避免 IMA 类任务再次跑到上百步。

### 窗口与自动化验收
- 连接器配置窗口默认尺寸调整为 `620 × 820`，并按当前显示器可用区域约束；首次打开即可看到完整凭据区和底部“保存并测试”，不恢复上次窗口大小。
- 新增 `verify:agent-kernel`、`verify:tool-window` 和 `verify:steering-e2e`。真实 Electron 插话测试会用本机假模型挂起旧请求，验证反馈优先回答、任务保持暂停且不会产生第三次旧任务请求。

## v0.8.10 (2026-07-26)

### 后台任务与统一控制
- 关闭助理窗口现在只会隐藏窗口，不再销毁执行中的助理；隐藏状态下模型调用、工具调用和计时仍会继续，只有点击“暂停”或“停止”才会改变任务状态。
- 主界面标题栏新增后台助理状态，实时显示当前动作、已完成动作数和运行时间；无需重新打开助理即可暂停、继续或停止，也可点击状态重新查看完整过程。
- 助手和员工私聊移除固定的 `2/3` 假进度，改为真实动作计数和运行时间；团队任务补齐明确的停止状态，暂停、继续、停止不再与关闭记录混用。
- 新增桌面端后台执行回归命令 `npm run verify:assistant-background`，自动验证助理隐藏后渲染进程仍存在且主界面计时继续变化。

### 连接器配置闭环
- 连接器配置窗口重新整理为“安装 Skill、填写凭据、真实验证”三步结构，字段标签、状态反馈、安全提示和底部操作区在深浅主题下保持一致。
- 修复深色主题弹窗外围白底和小窗口底部按钮被遮挡的问题；独立工具窗口不再出现两个关闭入口。
- Skill 连接器主操作改为“保存并交给助手验证”。保存后自动打开助理，检查连接器、读取已安装 Skill 的真实说明，并执行说明中的最小验证命令；只有真实成功才标记已连接。
- Skill 命令会在已安装技能目录中运行，凭据只通过本机进程环境变量注入，不写入提示词、聊天记录或技术日志。

### 外观
- 新增“霓虹赛博”可选主题，使用青色、洋红、绿色和黄色表达操作、角色与状态；主界面、聊天、设置和连接器统一使用主题语义色。

## v0.8.9 (2026-07-26)

### 文档驱动的第三方能力配置
- 外部服务不再一律套用“地址 + 单个 API Key”表单。助手会先检查接入类型，再搜索并读取官方说明，根据文档选择 HTTP、MCP、本地目录或 Skill 路线。
- 新增真实网页结果搜索和说明页正文读取；助手能从官方文档提取下载地址、必要配置项和验收步骤，而不是把说明工作推回用户。
- 新增代理可调用的 Skill 安装工具，支持 `SKILL.md`、GitHub 完整目录和官方 ZIP 技能包；ZIP 安装前检查文件数量、压缩/解压大小、越界路径与符号链接。
- Skill 支持关联外部服务配置。多项凭据以命名字段保存，执行官方验证命令时只通过环境变量注入，不把密钥原文交给模型或写进聊天日志。

### IMA 接入纠正
- 移除未经验证的 `https://ima.qq.com/openapi` 普通 HTTP 预设和虚构接口动作；IMA 改为按官方 Skill 说明安装并配置 API Key、Client ID。
- 升级后自动清理旧版 IMA 错误预设中残留的认证 Token 和自定义 Header，要求使用重新生成的凭据配置。
- 安装文件、保存凭据和真实调用分别验收；只有执行 Skill 官方连通测试成功后才显示已连接。

## v0.8.8 (2026-07-26)

### 连接器任务全链路修复
- 连接器、MCP、知识库和外部服务任务统一先做能力分类与状态检查，不再误入 Skill 搜索和失效恢复循环；助手、员工、团队讨论及自主任务使用同一规则。
- 新增始终可用的连接器检查、配置准备和真实测试工具。可查看全部预设与现有配置、明确缺少地址/目录/凭据，直接打开对应配置窗口，并且只在真实测试通过后确认可用。
- 连接器入口不再只展示网页知识库和 Obsidian；网页知识库、Obsidian、ima、QQ 邮箱、腾讯文档、企业微信、GitHub 和自定义 HTTP 统一从“添加连接器”菜单配置。
- 用户专属 API Key、验证码和外部授权不会被猜测或伪造；配置草稿会保留，失败时说明具体缺项和最省事的下一步。

### 员工私聊执行反馈统一
- 所有员工私聊同步助手窗口的实时执行状态：显示当前工具、通俗短报告、可展开输入细节和已完成步骤；完成后自动收进单条“执行过程”。
- 员工处理中收到新消息时会立即确认，并按“引导 / 排队”策略继续，不再让用户插话后没有回应。
- 员工私聊同时接入已配置连接器，工具能力与助手窗口保持一致。

### 员工目录实时同步
- 助手每次处理请求前重新读取当前员工、职务、在线状态和团队归属；新建、改名、删除员工后跨窗口立即生效。
- 用户点名现有员工时，助手会先核对真实办公室名单，不再凭旧上下文回答“没有这名员工”。

### 交付文件闭环
- 修复产出物广播只通知其他窗口、生成文件的当前聊天窗口不刷新的问题；助手、员工和团队窗口统一即时更新。
- 消息里的真实产出物文件名统一高亮可点击；`sandbox:` 文件链接会匹配本机真实产出，找不到时明确标注，不再显示无效下载链接。
- 网页链接由桌面端交给系统浏览器打开，普通网址和 Markdown 链接行为一致。
- `.docx` 不再以纯文本伪装 Word 文件：客户端生成真正的 Office Open XML 文档，写入后重新解析正文，校验通过才登记为最终交付。

### 设置窗口
- 设置中心取消每次打开自动最大化，统一以 1100×760 的标准尺寸居中打开；本次可自由缩放，但下次仍回到标准尺寸。

## v0.8.7 (2026-07-26)

### 自主执行与 Skill 恢复
- “本机没有匹配的 Skill”和“读取了已经失效的 Skill”不再被记为任务进展，避免助手在无效检索里耗尽执行次数。
- 失效 Skill 会自动触发一次本机重新检索；没有可用候选时自动联网查询官方资料或替代方案，再回到原任务使用通用工具继续完成。
- 执行阶段从 5 个扩展到 8 个，并将无进展停止条件改为连续 3 个阶段；每次仍会压缩上下文并阻止重复的无效 Skill 读取。
- 内部执行额度不再作为让用户回复“继续”的理由。只有确实缺少账号、授权、文件或业务选择时，才会明确告诉用户所需内容。

### 模型上下文可见性
- 助手、员工私聊和团队聊天的模型选择器现在显示本次输入上下文用量。
- API 返回 `prompt_tokens` 时显示服务端真实值；未返回时明确标识为本地估算。
- 模型库可为每个模型保存官方上下文上限，选择器会显示“已用 / 上限”和百分比预警；没有可靠上限时如实显示“未获知上限”。

## v0.8.6 (2026-07-26)

### 审批边界加固
- “替我审核”只会自动放行单条、白名单内的目录检查、状态查询、构建和测试命令。命令链、重定向、变量插值或任何不在白名单内的写法都会请求审核，不能再借由安全命令前缀绕过确认。
- 在“请求审核”和“替我审核”两档中，连接器统一先确认再访问外部服务；只有“完全访问权限”才会直接调用。

## v0.8.5 (2026-07-26)

### 沙盒与审批
- 设置中心新增“命令沙盒”开关。开启时，主进程会拒绝明显指向工作区外的路径；关闭后，命令仍从当前聊天工作区启动，但可按用户授权访问本机其他位置。
- 新增三档工具审批：`请求审核`、`替我审核`、`完全访问权限`。默认“替我审核”会直接处理目录检查、状态查询、构建和测试；安装依赖、联网发布、启动程序、删除文件和未归类命令会先明确请求同意。
- 助手、员工私聊和团队聊天的输入区统一显示审批方式与沙盒状态。任意一个窗口变更后会同步到其他已打开的聊天窗口，并在重启后保留。
- 审批被取消时，命令和连接器不会执行，助手会收到“未执行”的真实结果，不会把取消误报成完成。

## v0.8.4 (2026-07-26)

### Skill 自主替代
- 读取 Skill 失败后，助手会先重新检索本地技能库，再自动联网搜索替代 Skill、官方资料或通用方案，而不是要求用户重复回复“继续”。
- 执行器会拒绝重复读取同一个已失败的 Skill ID，强制改用不同关键词、替代工具或新路线。只有联网搜索本身不可用且任务确实依赖外部资料时，才会向用户说明需要的网络条件。

## v0.8.3 (2026-07-26)

### 自主续跑
- 助手不再在第 24 次工具调用后直接停止并要求用户回复“继续”。它会自动压缩已完成步骤、保留真实证据，并进入下一执行阶段。
- 单次任务最多可自主完成 5 个受控执行阶段。只有连续两个阶段没有任何实质进展，或五个阶段后仍无法完成，才会停止并说明确实需要用户提供的账号、授权、文件或选择。

## v0.8.2 (2026-07-26)

### 助手窗口联动
- 主界面标题栏新增助手窗口锁定按钮。未锁定时助手保持独立；锁定后会贴靠主界面右侧，并跟随主界面的移动、缩放、最大化、最小化、还原和隐藏。
- 团队聊天和员工私聊标题栏也新增独立锁定按钮。当前锁定的一个聊天会占用主界面左侧联动位并参与同样的联动；选择另一个聊天锁定时会自动替换左侧内容。助手始终使用右侧位置，不与聊天窗口冲突。
- 锁定状态会在本机保存，下一次打开客户端仍然生效。需要独立操作时再次点击锁图标即可解除。

## v0.8.1 (2026-07-26)

### 版本识别
- 主窗口、聊天窗口、设置窗口和全部工具窗口标题栏现在都会显示统一的版本角标。
- 版本号由构建配置自动读取，安装包版本、界面角标和系统窗口标题保持一致，便于确认当前正在使用的版本。

## v0.8.0 (2026-07-26)

### 太极任务内核
- 在既有团队任务系统上增加目标、验收条件、前置检查、真实证据、运行阶段和可恢复交接；旧任务自动兼容补齐字段。
- 团队任务创建前检查所有被调度员工的模型。缺少模型时不再派发后失败，而是生成“待恢复”任务，明确未配置成员和设置入口。
- 团队执行过程记录工具与成员的真实结果；失败时保留已完成步骤、阻塞原因和可执行的下一步，继续执行不会丢失进度。
- 团队任务卡片新增目标、前置检查、当前交接和每步证据视图。

### 完整技能包
- GitHub 技能目录链接现在以完整目录安装，递归保存 `SKILL.md`、参考资料、脚本和模板，并限制文件数量与总体积。
- 单文件技能来源会保存安装方式并标注“需完整目录”，避免配套文件缺失时仍被误认为完整可用。

### 设计依据
- 完成 Hermes Agent 公开安装、配置、功能、更新与开发文档的对照，吸收前置验证、预算控制、上下文、隔离、诊断和更新验证理念；不采用其品牌、安装器、CLI、界面或产品形态。

## v0.7.19 (2026-07-26)

### 当前动作与折叠记录
- 实时执行区跟随助手窗口宽度，只突出当前正在运行的一项，不再把已完成动作连续堆在聊天窗口。
- 当前动作可直接展开查看本步输入；成功或失败返回后自动归档到折叠的“执行过程”。
- 执行过程默认收起，每一条历史步骤也默认折叠，可单独展开通俗结果和技术详情。

### 运行中插话确认
- 用户在助手执行期间继续发消息时，聊天窗口会立即确认已经收到，并明确是调整当前工作还是排队接续处理。
- 插话继续传给正在运行的代理循环，不会只留下一条机械记录，也不会中断已经完成的进度。

### 失败交接与执行预算
- 单次任务的工具记录上限调整为 24 条；连续两个执行阶段没有实质进展时提前停止，避免几十次重复尝试消耗模型额度。
- 到达预算或模型留下模糊失败答复时，系统会基于真实执行记录重新生成交接，明确已完成项、最后阻塞点和用户当前需要操作的一步。
- 默认助手提示词升级到第 7 版，禁止以“重新验收”“请重试”或“查看执行过程”代替可执行的下一步说明。

### 技能库健康审计
- 已核对内置技能：源码与安装包均包含 73 个有效 `SKILL.md`，不存在内置技能被打包时删除的情况。
- 发现旧的一键安装只保存单个 `SKILL.md`，带参考资料或脚本的第三方技能会缺少配套文件；完整目录安装、依赖校验和无效技能隔离已列为下一大版本优先项。

## v0.7.18 (2026-07-26)

### 按进展自主续跑
- 固定工具次数上限改为检查点阶段制：每 10 轮压缩执行记忆，保留目标和成果并自动续跑，最多提供 5 个受控阶段。
- 每个检查点判断是否产生新的成功结果；有进展就延续，停滞则要求推翻原假设并换一条本质不同的路线。
- Windows 命令执行器从默认 cmd 统一为 PowerShell，输出统一使用 UTF-8，修复代理按 PowerShell 思考却被 cmd 拒绝的问题。

### 实时执行报告
- 助手处理时展示最近 5 项简短工具报告，例如“技能库 · 查找技能”“文件工具 · 读取说明”“终端工具 · 核对版本”。
- 当前调度项流动高亮，完成和失败状态即时更新；完整命令、参数和日志仍不直接铺在聊天中。
- 折叠“执行过程”改为按时间编号的规范列表，默认只显示通俗摘要，每一步可单独展开技术详情。

### 独立助手窗口
- 驴狗蛋助手解除与主界面的父子窗口关系，拥有独立任务栏入口、位置和最小化状态。
- 主界面最小化、隐藏、移动或缩放时不再牵连助手窗口；首次打开仍自动排列在主界面旁边。

## v0.7.17 (2026-07-26)

### 自主代理循环
- 所有工具任务开始前先理解最终目标和完成标准，再按当前任务动态判断环境、资料、依赖、权限、账号、版本和验收方式，不套固定清单。
- 每次操作后读取真实结果；失败时判断原因并修正、换工具或换路线，连续失败会强制重新检查假设，避免机械重复同一方法。
- 只有缺少用户专属凭据、验证码、外部授权、付费决定或业务取舍时才暂停询问，并保留已经完成的进度。
- 首次准备交付时自动进行独立自检；发现可自行补救的缺口会继续执行，完成后再按最初目标做端到端验收。

### 可信结果与通俗交接
- 不再用“最后一个操作成功”判断整个任务成功；安装任务区分下载、解压、放置、版本、配置和实际可用性。
- 指定版本与包内版本不一致、必要 API Key 尚未配置或没有真实验证时，会拦截错误的“安装成功”结论。
- 回答改为“明确结论 + 做了什么 + 用户下一步怎么操作”的通俗总结；命令、参数和错误原文继续收纳在折叠的“执行过程”中。
- 明确 Windows PowerShell 执行环境，失败后不得重复使用不兼容的 Bash 命令写法。

### 原生独立工作窗口
- 添加员工、编辑员工、新建团队、重命名团队、连接器配置和助手设置统一改为 Electron 独立窗口，可拖出主程序并在整个桌面或多显示器间移动。
- 独立窗口统一提供拖拽标题栏、最小化、最大化/还原和关闭控件；初始位置保持在当前屏幕可见区域内。
- 主窗口与工具窗口通过现有广播总线同步员工、团队和连接器变化；普通浏览器预览继续保留页内弹层作为兼容方式。

## v0.7.16 (2026-07-25)

### 同步流光状态
- 助手窗口上方状态条和消息区当前执行项使用同一套流光动画、时长和主题色，处理状态保持同步。
- 当前执行文案不再暴露 `run_command`、参数和长命令，改为“正在安装或检查”“正在保存文件”等通俗状态。

### 小白友好的结果说明
- 助手、员工私聊和团队回复统一面向非技术用户：第一句先明确成功、失败或仍在处理中。
- 安装任务必须直接回答“已经安装好了”或“还没有安装好”，并说明在哪里打开；失败时说明卡在下载、安装、账号连接、保存或验证中的哪一步。
- 最终回答不再重复工具名、命令、参数、退出码、STDOUT、STDERR、原始日志和长路径；技术记录只保留在折叠的“执行过程”中。
- 删除工具循环达到上限时自动生成的长篇操作清单，改为简短状态；旧聊天中的同类清单升级后也会自动收起。
- 模型或网络出错时转换为通俗原因和下一步，不再直接显示难以理解的原始异常。

### 执行稳定性
- 连续工具调用上限由 10 次提高到 14 次，让模型在完成操作后有机会整理最终结论。
- 工具结果缓存同时保留真实成功或失败状态，避免复用失败结果时被错误标记为成功。

## v0.7.15 (2026-07-25)

### 在线像素头像
- 员工头像库接入 DiceBear 官方 Pixel Art API，默认一次展示 24 个像素角色，达到 20 个以上的首批可选数量。
- 增加“换一批”功能，可继续生成新的 24 个头像，并提供官方来源入口和 `CC0 1.0` 授权标识。
- 点击在线头像后先下载 SVG，再保存为员工的本地 Data URL；已选头像不会依赖外部 URL，断网后仍可正常显示。
- 上一版 5 个简单像素化头像从可见分类撤下，仅保留旧数据解析兼容，不再计入头像库数量。
- 在线加载、保存中、接口失败和重新选择状态均有明确反馈；新增和编辑员工共用同一套入口。

## v0.7.14 (2026-07-25)

### 员工头像库
- 新增统一的员工头像库，按“会所角色 / 像素宠物 / 经典头像”分类展示 20 个随安装包内置的预设头像。
- 首批加入 5 个 Q 版像素宠物员工头像，使用本地资源，无需连接第三方网站。
- 新增员工和编辑员工均可直接打开头像库，一键选择后立即预览；继续支持上传自定义头像。
- 保留旧头像 key、员工数据、头像框和四列方形员工卡布局，升级不迁移、不覆盖已有员工形象。

### 驴狗蛋助手
- 全局助理名称由“章北海助理”统一为“驴狗蛋助手”，同步主窗口、聊天标题、团队监督身份、托盘菜单和设置入口。
- 新默认提示词补齐团队调度、真实工具调用、文件落盘、连接器优先级、失败说明和禁止虚构进度规则。
- 新版默认提示词使用版本迁移：只覆盖旧内置默认值，用户后续手动修改的人格内容继续保留。

### 工作台与聊天界面
- 办公室增加成员、在线和工作中统计，保留大头像、头像框、身份牌和四列员工工位展示。
- 助理和聊天窗口收敛为连续的标题栏、消息画布与输入带，减少层层嵌套边框。
- 执行过程控件统一为矢量图标，并继续使用十套主题变量；头像库已验证明亮与深色主题。

## v0.7.13 (2026-07-25)

### 桌面工作台视觉系统
- 主窗口改为紧凑的半透明桌面标题栏，统一品牌标识、视图导航、模型状态、助理入口、主题、设置和系统窗口按钮。
- 表情符号导航替换为同一套矢量图标；窗口控件使用固定尺寸和明确悬停状态，主窗口与独立设置窗口保持一致。
- 全局圆角收敛为 6–8px，降低大面积白色边框与浮夸阴影，改用低对比发丝线、分层背景和克制的浮起反馈。
- 办公室工位改为更紧凑的四列工作台网格；浅色与深色主题均重新校准边界、阴影和选中状态。
- 侧栏筛选改为稳定四列分段控件，底部操作改为“添加员工 + 三项工具”两行布局，小宽度下不再出现文字断裂。
- 支持系统“减少动态效果”偏好，并为 1180、920、720px 三档窗口宽度提供导航自适应。

### 跨设备一键同步
- 新增 `npm.cmd run sync:project`，统一查询 GitHub `main`、下载最新源码和对应 Release 安装包。
- 源码按版本与提交号写入新目录，不覆盖正在修改的工作区；已有依赖通过 Junction 复用。
- 安装包下载后按 GitHub Release 记录的字节数校验，并支持 `-Install` 静默覆盖指定安装目录。
- 同步流程使用系统 Git Credential Manager 中已有 OAuth，不在代码、日志或文档保存凭据，也不再依赖不稳定的 Git Smart HTTP 拉取。

### 稳定性
- 删除自动更新错误监听器中的不可达代码；后台更新失败继续仅写诊断日志，不冒充模型网络错误。
- Windows 打包直接复用项目依赖中的 Electron 运行时和工作区缓存，避免每次构建重复下载运行时与签名工具。

## v0.7.12 (2026-07-25)

### 人格、用户画像与长期记忆
- 明确三层上下文边界：助理人格约束行为，用户画像由用户主动维护，长期记忆由系统筛选提炼；自动分析不再覆盖手写画像。
- 长期记忆新增身份、偏好、约束、流程、决策和项目六类标签，以及重要性、置信度和更新时间。
- 新记忆写入前执行相似去重、来源归并和冲突替换；容量收紧为 100 条，并按重要性与时效保留高价值内容。
- 上下文不再机械读取最近十条，而是兼顾六类信息并优先注入高重要性记忆；设置页新增旧记忆一键整理。

### 运行中跟进
- 执行策略新增“排队 / 引导”：引导模式允许在章北海或团队运行期间继续发消息，并在下一次工具调用或步骤前应用最新要求。
- 模型请求已经发出时不会伪装成实时改写，而是在响应返回后先读取追加指令，阻止过时方向继续执行。

### 全局员工状态
- 员工私聊的模型调用与团队执行步骤统一写回全局工作状态，左侧员工栏、办公室工位和聊天标题不再各自显示不同结果。
- 状态固定为黄色工作中、绿色空闲、红色离线；成功、失败、等待重试、任务结束和异常退出都会释放工作状态。

### 交付物与聊天统一
- `write_file` 新增最终交付、工作文件、参考资料三类用途，团队角色按职责标注文件，旧产物会依据路径和文件名自动归类。
- 三种聊天窗口共用文件链接渲染：消息中的真实产出文件名高亮可点，点击后展开右栏对应分类并定位文件。
- 交付物侧栏改为可折叠分组，默认不强制打开预览；点击同一文件或“收起预览”可恢复完整列表，预览打开时仍保留分类导航。
- 员工私聊与章北海统一使用可折叠执行过程，工具参数和结果不再直接堆满最终回复气泡。
- 团队标题区头像轨道和全局横向滚动条改为细型样式，减少对紧凑聊天空间的占用。
- 团队聊天移除重复的大标题和头像横栏，只在成员栏保留紧凑团队标题；标题旁可直接重命名，并同步主界面团队列表与独立窗口。
- 章北海伴随窗改为主窗口的系统级拥有窗口，移动、恢复和聚焦时保持同一 Z 轴窗口组，其他软件不再夹在主界面与助理之间；切换应用时不会跨软件永久置顶。

### 独立设置与界面层级
- 设置中心改为独立原生窗口，默认最大化，可恢复后拖动和缩放，不再受主界面遮罩限制。
- 建立统一的三档阴影与边界层级，增强工作区、侧栏、设置和聊天面板的凸起感与可辨识度。

### 十套主题
- 扩展为明亮、深色、护眼、柔和灰、海湾蓝、静谧蓝、玻璃晨光、玻璃深夜、云杉绿、石墨十套预设。
- 玻璃主题使用半透明面板、边界和阴影的配套组合，保持可读性与控件边界。

### 大字号自适应
- 字体档位不再缩放整个 Electron 窗口，避免标题栏、头像网格、侧栏和控件被整体挤压。
- 大号与特大号仅增强正文、消息、表单和人员信息，紧凑导航与图标尺寸保持稳定，并增加换行、滚动和高度余量。

### 章北海助理提示词
- 默认提示词与真实执行链对齐：简单任务由助理工具执行，多人项目先生成草案，批准后才由调度器启动。
- 增加 Skill 检索、附件真实性、产物落盘、失败诊断、禁止虚构进度和审查退回规则。
- “助理设置”和“设置 > 人格”共用同一份配置；人格页新增应用新版默认人格入口，同时保留用户自定义内容。

## v0.7.11 (2026-07-25)

### 助理窗口恢复入口
- 主窗口标题栏新增固定的章北海助理机器人按钮，关闭独立助理窗后可随时一键重新打开。
- 继续复用同一个伴随聊天窗口和历史上下文，不会重复创建窗口或清空对话。

### 独立聊天窗视觉与状态
- 助理思考过程改为仅在自己的聊天窗口显示，不再挤压主界面标题栏。
- 新增半透明流光处理状态，展示当前工具调用或回复整理阶段。
- 黑夜模式在主窗口和所有聊天子窗口间实时同步。
- 移除助理窗内部重复标题，统一单层边界、圆角层级和暗色对比度。

### 预设主题
- 标题栏新增主题选择菜单，提供明亮、深色、护眼和柔和灰四套预设。
- 护眼主题降低大面积蓝光与纯白刺激，同时保持文字、控件和边界清晰。

### 面板与模型操作
- 提高全局控件、输入框、列表卡片和工作区边界的对比度，避免相邻层级混在一起。
- 左侧栏支持横向拖动调宽；员工和团队分区可分别折叠，并可上下拖动分配显示高度。
- 添加模型时可从当前 API 自动读取 `/models` 列表，直接选择模型 ID；失败时显示接口、鉴权或网络错误，仍可手动配置。

## v0.7.9 (2026-07-25)

### 章北海伴随聊天窗
- 移除办公室底部拥挤的内嵌助理聊天区，改为主窗口右侧的独立章北海助理伴随窗。
- 伴随窗跟随主窗口移动、缩放、最小化和恢复；右侧空间不足时自动转到左侧或收进屏幕可用区域。
- 员工头像继续打开各自独立私聊；章北海助理入口会复用伴随窗，不会创建重复窗口。

### 后台常驻
- 新增 Windows 系统托盘图标，主窗口关闭按钮改为隐藏到托盘，任务和上下文继续保留。
- 托盘支持打开主窗口、打开章北海助理和彻底退出；单击或双击托盘图标可恢复主界面。

### macOS 圆角界面
- 统一窗口、侧栏分区、办公室、聊天消息区、输入区、设置中心、浮层和控件的圆角层级与留白。
- 减少大面积直线硬切，主界面和独立聊天窗使用一致的玻璃质感、阴影和交互动画。

## v0.7.8 (2026-07-25)

### 产出物导航
- 修复章北海助理和团队聊天的“返回聊天”按钮无效问题。
- 三类聊天统一使用同一返回逻辑；无回调的产出物面板不再显示无效返回按钮。

## v0.7.7 (2026-07-25)

### 办公室交互
- 设置中心右侧内容的非交互区域也可拖动整个面板。
- 主办公室底部新增章北海助理默认聊天区，员工头像只打开对应员工私聊。

## v0.7.6 (2026-07-25)

### 模型稳定性
- 正常模型请求超时从 30 秒调整为 300 秒；连接测试仍保持短超时。

## v0.7.4 (2026-07-25)

### 助理进度与诊断
- 章北海助理单聊状态同步至主窗口顶部进度条，显示思考、工具调用和整理回复阶段。
- 模型请求超时改为明确诊断信息，不再显示无原因的 Abort 信号错误。

## v0.7.3 (2026-07-25)

### 头像预设
- 将当前会所成员的 5 张上传头像固化为随安装包分发的预设资源。
- 新安装的默认员工改用会所成员头像；旧围巾头像保留用于兼容已有配置。

## v0.7.2 (2026-07-25)

### 设置体验
- 设置中心左上角可拖动整个设置面板，表单和滚动区域不参与拖动。

## v0.7.1 (2026-07-25)

### 品牌名称
- 用户可见的默认监督与调度身份统一改为“章北海助理”。
- 保留既有应用 ID 与本地数据键作为兼容层，覆盖升级不会丢失员工、团队、聊天或模型配置。

## v0.7.0 (2026-07-25)

### Hermes 项目编排
- 新增可持久化项目实体：项目需求、候选成员、选择理由、步骤、预期产出、项目团队和生命周期状态。
- Hermes 助理收到明确的组队/拉群/项目调度请求后只创建待批准草案，不会擅自调用员工模型或假装执行。
- 批准项目后自动创建隔离团队，按成员个人模型启动既有顺序任务运行器；完成或失败会回写项目状态，支持归档。
- 自主办公页从单模型代办改为项目草案与审批入口，展示成员选择依据并可直接打开项目团队。

## v0.6.4 (2026-07-25)

### 跨设备协作
- 新增 `npm.cmd run status:project` 统一状态查询，显示本地版本、分支、提交、远端差异、工作区改动与安装包状态。
- 新增 `docs/CROSS_DEVICE_WORKFLOW.md`，固定办公室与家里两台电脑的拉取、接力、提交和发布流程。
- 交接手册改为以统一状态命令和 GitHub `main` 为跨设备协作的唯一事实来源。

## v0.6.3 (2026-07-25)

### 更新发布
- 自动更新源改为本项目 GitHub Releases，不再访问失效的占位地址。
- 后台检查更新失败时仅记录诊断日志，不再伪装成应用或模型网络故障。
- 后续发布需将安装器、`.blockmap` 和 `latest.yml` 一并上传到对应 GitHub Release。

## v0.6.2 (2026-07-25)

### 团队对话与任务执行
- 修复聊天记录将 Base64 头像或附件主体误渲染为长文本的问题；启动时自动清理已有异常记录，后续写入同样拦截。
- 修复 Hermes 助理未单独选择模型时没有继承全局激活模型的问题，避免误回退到机械“已记录”文案。
- 取消成员的假对话兜底。模型不可用时任务明确失败并保留上下文，提示配置后继续执行。
- 交付型任务要求成员通过 `write_file` 保存真实成果；未检测到文件产出时不会再标记任务完成。
- 任务调度仅向成员传递老板原始需求，不再混入监工回复，减少上下文污染。

## v0.6.1 (2026-07-24)

### 技能与设置
- 设置中心移除与主界面重复的技能库入口，仅保留主界面技能库。
- 完整迁入 Hermes Agent 上游 69 个 Skill，连同原有 4 个基础 Skill，共内置 73 个。
- Skill 商城增加 Hermes Agent 官方技能目录入口，技能卡片与详情说明字号同步增大。

### 外观与桌面体验
- 设置中心新增外观页，提供幼圆及 5 款内置字体和四档界面字号。
- 修复深色模式弹窗白色边框，并为主标题栏和设置品牌区补充窗口拖动区域。
- 安装包包含 Hermes Agent MIT 许可证和新增字体的 OFL 许可证。

## v0.6.0 (2026-07-24)

### 技能中心
- 技能库改为“内置 Skill / 我的 Skill / Skill 商城”三页签结构。
- Skill 商城增加 SkillHub、SkillsMP、Skills.sh 和 Anthropic Skills 可视化卡片，并通过系统浏览器打开第三方站点。
- 支持粘贴 `SKILL.md`、GitHub 文件、技能目录或仓库地址，一键安装到本机 WorkBuddy 技能目录。
- 随安装包提供知识检索、任务规划、文档交付和代码审查 4 个基础 Skill；内置技能不可删除。

### 知识库连接器
- 连接器入口重构为知识库中心，支持网页知识库和 Obsidian 一键配置。
- 网页知识库可抓取并整理网页、公开文档和在线知识库正文，作为员工可调用工具。
- Obsidian 支持原生选择 Vault、连接检查、Markdown 全库搜索和笔记读取。
- 旧 HTTP/MCP 连接器配置继续保留并可管理，避免升级时丢失用户数据。

### 设置中心
- 设置改为宽版左侧分组导航，集中管理模型、档案、知识库、工作区、记忆、人格、自动化和备份迁移。
- 知识库管理可从设置中心直接进入；技能库统一保留在主界面，避免入口重复。

## v0.5.9 (2026-07-24)

### 配置同步
- 新增 `config/local-test-profile.sanitized.json`，同步 9 名员工、2 个团队、3 个模型和 8 个连接器的非敏感配置。
- 新增侧栏“同步”导入入口，目标电脑可直接导入员工、团队和模型结构。
- API Key、Token、密码等敏感字段自动替换为占位符，不进入 Git；导入后需在目标电脑本地回填。
- 同步文件不包含聊天记录、任务运行记录、长期记忆、Token 日志和产出物。

## v0.5.8 (2026-07-24)

### 项目交接与资料整理
- 新增 `docs/PROJECT_HANDOFF.md`，集中记录产品约束、模块职责、数据位置、附件处理链路、已交付能力、风险、验收清单和发布流程。
- README 增加交接手册入口，并同步到 v0.5.8 Release 链接。
- 将 `开发资料全记录.md` 标记为 v0.1.x 历史档案，明确当前实现应以交接手册、更新日志和源码为准。
- 增加脱敏同步配置文件和侧栏导入入口；API Key 不进入 Git，需要在目标电脑本地填写。

## v0.5.7 (2026-07-24)

### 真实附件导入
- 助理、员工单聊、团队聊天统一支持文件选择、剪贴板粘贴和拖拽导入。
- 图片、文本和二进制附件都会先写入当前聊天的隔离工作区，附件芯片显示已保存或具体失败状态。
- 同名附件使用独立批次目录保存，避免覆盖；聊天记录不再持久化大体积二进制 base64。
- 图片继续作为多模态视觉输入，并同步给团队中所有被调度成员。

### 文档读取
- 引入 `officeparser`，支持 Excel、Word、PowerPoint、PDF、OpenDocument、RTF 和 EPUB 内容提取。
- `read_file` 支持按字符偏移分段读取长文档，避免只读取开头后误判文件不完整。
- 未知扩展名会先检测是否为 UTF-8 文本；无法解析的二进制返回真实路径和明确处理建议，不再读取成乱码。

### 产出物整理
- 产出物只展示成功写入磁盘的最终文件，移除聊天纪要、任务摘要、导出记录、命令日志和附件占位。
- 输入附件保留在 `uploads/` 中供工具使用，但不会冒充最终产出物。
- 同路径文件自动更新，命令执行只同步本次新增或修改的文件，保留目录、类型、大小和时间信息。

## v0.5.6 (2026-07-24)

### 模型连通性
- 模型库测试改为真实调用 `/chat/completions`，只有模型返回有效聊天内容才判定成功。
- 测试结果显示延迟、HTTP 状态、实际请求端点、测试时间和服务端错误详情。
- 超时、网络错误、非 JSON 响应、空响应和 HTTP 错误分别给出明确原因。
- 移除正式聊天请求中固定的 `temperature: 0.7`，兼容不支持该参数的新模型和推理模型。
- 启动探测与设置测试使用相同的真实聊天检测，测试全局模型后立即同步跨窗口状态。
- 状态文案改为“默认模型可用/不可用”，避免把全局接口结果误解为所有员工模型状态。

## v0.5.5 (2026-07-24)

### 文档与发布
- README 全面同步到当前版本，补充多模型协作、任务调度、状态控制、模型诊断和桌面交互说明。
- 明确模型规则：员工关闭独立配置时继承全局模型，开启后继续使用员工自己的模型；同一团队支持多个模型协作。
- 修正安装包名称、开发目录、发布分支、自动更新现状和最近版本摘要。
- 清理 README 中的旧编码残留和过时的 `master:main` 推送命令。

## v0.5.4 (2026-07-24)

### 修复与改进
- 员工有效模型改为统一解析：未开启独立配置时继承全局激活模型，开启后保留员工独立模型。
- 团队执行、员工单聊、任务进度、模型诊断和任务快照使用相同的模型解析结果。
- 暂停、模型汇报、状态汇报和报数改为轻量控制指令，不创建任务、不检索 Skill、不调用文件工具。
- 右侧任务列表默认收起，点击后再展开。

## v0.5.3 (2026-07-24)

### 修复与改进
- 模型超时会阻塞并暂停当前步骤，不再跳过上一步继续执行。
- 增加模型诊断报告，显示 API 地址、模型、耗时、HTTP 状态、上下文大小和错误摘要。
- 聊天快速跳转增加悬停内容预览，团队任务面板和员工产出物面板支持拖动调整宽度。
- 员工产出物面板增加返回聊天入口。

## v0.3.0 (2026-07-24)

### 重大改进
- **团队自动讨论调度器**：发送消息后系统根据内容自动判断是否发起团队讨论
  - 基于紧急程度、协作意图、任务关键词、@ 提及、附件/长文本等维度智能评分
  - 支持 `off`/`smart`/`always` 三种自动讨论模式，用户可在设置中切换
  - 手动「发起讨论」入口保留，手动触发跳过评分阈值
  - 自动消息 400ms 聚合窗口，窗口内多条消息合并为一次讨论
  - 团队级调度锁，讨论进行中到达的新请求自动排队，讨论结束后补触发最多一次
  - `publishTask` 支持自动触发讨论，尊重 `autoDiscussMode='off'` 选项
- **团队聊天界面升级**：
  - 顶部团队成员头像条，一目了然谁在团队里
  - 左侧成员列表栏：头像、姓名、职位/角色、在线状态
  - 点击成员头像自动插入 `@成员名称` 到输入框，支持替换未完成的 @query
- **连接器错误处理增强**：连接器执行异常不再崩溃，转为结构化失败结果提示

### 技术改进
- 新增 `DiscussionTriggerInput` / `DiscussionParticipantPlan` 等类型定义
- 新增 `src/engine/discussionTrigger.ts`：自动讨论评分与参与者选择纯函数
- 新增 `plans/team-collaboration-auto-discussion.md`：团队协作自动讨论方案文档
- `store.tsx` 调度器重���：`schedulerRef`(Map) + `discussingRef`(Set) 双锁 + `keys` 去重
- `teamDiscussion.ts` 支持 participantPlan、forcedMemberIds、讨论元数据回写
- `hermesClient.ts` AppSettings 新增 `autoDiscussMode`/`autoDiscussMinScore`/`autoDiscussCooldownMs`/`autoDiscussMaxRounds`

## v0.2.9 (2026-07-23)

### 重大改进
- **连接器系统从空壳到真正可用**：
  - 连接器数据结构大幅升级，支持 baseUrl、认证配置（API Key/Bearer/无认证）、自定义 headers 等完整配置
  - 每个连接器预设自带操作定义（ConnectorAction），含 HTTP 请求模板和参数 JSON Schema
  - 新增 `ConnectorConfigModal` 配置界面：设置服务地址、认证方式、Token，支持一键测试连接
  - 连接器面板新增 ⚙ 配置按钮、🔍 测试按钮，每个连接器显示 已连接/断开/未配置 状态标签
  - 新增 `connector:call` IPC 桥：Electron 主进程代理 HTTP 请求，绕过渲染进程 CORS 限制
  - **IMA 知识库**：预设 3 个操作（搜索知识/列出知识/添加知识），配置 IMA API Key 后即可使用
  - **QQ 邮箱**：预设 2 个操作（发送邮件/搜索邮件），配置 SMTP 服务后可用
  - **GitHub**：预设搜索仓库操作，配置 GitHub Token 后可用
  - **自定义 HTTP**：通用 REST API 连接器，支持 GET/POST，可对接任何 HTTP 服务
  - 连接器工具自动注入聊天 agent 循环——助手可直接调用外部服务（如 `connector_ima_search_knowledge`）
- **聊天 @ 技能弹窗大幅放大**：高度范围从 160-400px 扩至 300-600px，默认 380px；从左-8px/右-8px 扩至 16px；卡片网格从 2 列改为 3 列；卡片字号图标都加大，技能信息一目了然

### 技术改进
- 新增 `src/engine/connectorTools.ts`：从已启用连接器生成 OpenAI 工具定义，执行连接器 API 调用
- `executeTool` 新增动态分发：以 `connector_` 开头的工具调用自动路由到连接器引擎
- `AssistantChat` 聊天合并内置工具和连接器工具，System Prompt 更新提及连接器能力
- `electron/preload.cjs` 暴露 `connectorCall` API，`electron/main.cjs` 注册 `connector:call` IPC handler

## v0.2.8 (2026-07-23)

### 新增功能
- **侧栏连接器面板**：侧栏底部新增「🔌 连接器」折叠区域，展示外联程序（ima 知识库、微信助理、飞书文档等），可添加/移除/展开折叠；每个连接器显示状态灯（已连接🟢/断开🔴/未知⚪）。
- **员工模型配置新增「引用模型库」模式**：编辑员工时，独立模型配置新增两种方式——「📦 引用模型库中已配置的模型」直接下拉选择已有模型（不再重复填写 API Key/地址），或「✏️ 手动填写模型配置」保留原有手动方式；引用模式自动同步服务商/地址/密钥/模型名。

### 技术改进
- `ModelConfig` 类型新增 `refModelId` 字段，支持引用模型库中的模型 ID
- `resolveChatSettings()` 新增引用模型解析逻辑
- 新增 `src/data/connectors.ts` 连接器数据层
- 新增 `src/components/sidebar/ConnectorPanel.tsx` 连接器 UI 组件

---

## v0.2.7 (2026-07-23)

### 修复与改进
- **聊天 @ 技能弹窗改为卡片展示**：弹出技能候选改为 2 列卡片格网，名称/说明/来源标记一目了然，不再挤成列表小字；弹窗宽度扩展到覆盖输入区两侧，默认高度从 220px 提升到 260px，最小值/最大值调整为 160–400px。
- **技能库改为九宫格卡片布局**：主视图从单列列表改为 `auto-fill minmax(200px, 1fr)` 网格布局，每个技能以大图标 + 名称 + 描述 + 来源的卡片呈现，删除按钮置于卡片右上角。
- **已选技能独立显示**：输入框上方新增已选技能 chip 行，选中后能清晰看到已绑定的技能名称。

---

## v0.2.6 (2026-07-23)

### 修复与改进
- **技能详情就地展开**：点击技能卡片后在卡片下方直接展示技能正文，不再跳到页面底部，再次点击或点其他卡片切换。
- **技能删除功能**：每个技能卡片增加删除按钮，首次点击进入确认态（红色"确认删除"），二次点击确认后实际删除技能目录，支持取消。

### 新增文件
- `electron/skills.cjs` 新增 `deleteSkill()` 安全删除函数（realpath 校验 + 仅限技能根目录范围）
- `src/skills.ts` 新增 `deleteSkill()` renderer 封装
- `electron/main.cjs` / `preload.cjs` / `electron.d.ts` 新增 `skills:delete` IPC

---

## v0.2.5 (2026-07-23)

### 修复与改进
- **技能候选区域可调节**：聊天框输入 `@` 后，技能列表增加可拖动上沿，展示高度可在聊天窗口内调整，范围限制为 140–360px，避免遮挡输入区或越出聊天窗口。
- **技能面板滚动**：候选项过多时在面板内部滚动，保持输入框和发送工具栏可用。

---

## v0.2.4 (2026-07-23)

### 新增
- **技能库板块**：第四主视图「🧩 技能库」，扫描本地已安装 WorkBuddy 技能（`~/.workbuddy/skills/`），展示名称、说明、来源、版本，支持搜索和详情查看。
- **聊天 @ 技能引用**：DM/团队/助手输入框输入 `@` 弹出技能选择，键盘导航，选中显示 chip，发送时读取正文注入 AI 上下文。消息和 localStorage 不存正文。
- **GitHub 远端**：项目推送至 https://github.com/TTflysky/sirenhuisuo，每次修改自动推送溯源。

### 新增文件
- `electron/skills.cjs` — 技能扫描与安全读取服务
- `src/data/skills.ts` — 技能数据加载层
- `src/components/skills/SkillLibraryView.tsx` — 技能库浏览面板
- `src/components/skills/SkillMentionInput.tsx` — @ 技能搜索选择输入组件
- `README.md`、`CHANGELOG.md`

---

## v0.2.3 (2026-07-22)

### 修复
- **聊天窗口被主界面遮挡**：Windows 上聊天窗口改为主窗口的非模态 owned window，始终位于本应用上方，但不压住外部应用。移除 300ms 临时全局置顶方案。
- **输入栏不能贴底**：补齐 `html → body → #root → .app-root` 全高 flex 链，消息区自动占满剩余高度并独立滚动，输入栏固定底部。
- **顶栏 Segmented 不可点击**：`.view-tabs` 及其后代显式 `no-drag`，修复 Ant Design Segmented 被 Electron 拖拽区吞点击。「数据分析」「自主办公」恢复点击。
- **级联窗口重叠**：改用实际占用探测算法，对角槽优先、有限网格回绕。开 A/B/C 后关 B 开 D 不会与 C 重叠。

---

## v0.2.2 (2026-07-22)

### 修复
- **统一原生聊天窗口**：左侧员工头像与办公室工位统一调用 `openDmChat`；DM/团队/助手统一通过 Electron `BrowserWindow` 打开。
- **删除双轨浮窗**：移除 `FloatWindowLayer`、`WinState` 及应用内浮窗 actions。
- **窗口去重复用**：按聊天业务 key 用 `Map` 管理，重复点击聚焦已有窗口。
- **级联定位**：新窗口按主窗口位置 28px 级联偏移，限制在显示器工作区。
- **标题栏按钮**：`ChatOnlyView` 统一最小化/关闭按钮。
- **消息滚动**：补齐 flex 高度链，消息区独立滚动，输入栏自适应。

---

## v0.2.1 (2026-07-22)

### 发布
- 安装包 `release/私人办公会所 Setup 0.2.1.exe`

---

## v0.2.0 (2026-07-22)

### 修复
- **套娃根因**：移除 `sessionStorage` 子窗口检测，仅用 `location.hash` 判断。
- **标题栏按钮失效**：拖拽区域仅限 `.titlebar-left`。
- **对话框自适应+滚动**：补齐聊天 flex 高度链。
- **多模型库**：Settings 支持添加/编辑/删除/测试模型，测试通过高亮绿点。
- **助理模型选择器**：办公页侧栏直接切换模型。
- **模型回退**：员工→助理模型→全局设置三阶回退。

---

## v0.1.14 (2026-07-22)

### 修复
- **标题栏按钮失效**：drag 区域仅限 titlebar-left，右侧按钮区独立 no-drag。
- **团队展开为空**：修复 TeamChatApp 三元表达式破坏 `.map()` 回调的问题。

---

## v0.1.13 (2026-07-22)

### 修复
- **点击员工替换主窗口**：移除 hashchange 监听器，子窗口检测仅首次渲染读一次 hash。
- **浏览器 fallback**：从 `location.hash` 改为 `window.open` 新标签页。

---

## v0.1.12 (2026-07-22)

### 修复
- **点击失效真因**：App.tsx 把所有 hooks 移到 hash 判断前，加 hashchange 监听。
- **助理模型选择**：侧栏嵌入模型选择器，三阶回退（员工→助理→全局）。

---

## v0.1.11 (2026-07-22)

### 修复
- **点击失效**：Electron fallback → 非 Electron 环境走 `location.hash`。
- **团队管理**：Dropdown 操作菜单（重命名/归档/删除），二次确认弹窗。

---

## v0.1.10 (2026-07-22)

### 新增
- **Ant Design 引入**：antd ^6.5.1，全局 ConfigProvider+AntApp，theme token 主色 `#1a1f36`。
- 迁移：顶栏 Segmented+Button、SettingsModal、EditEmployeeModal、AutopilotPanel。

---

## v0.1.9 (2026-07-22)

### 新增
- **自主办公可中断**：停止按钮，`shouldStop` 回调。
- **工作区一键导出 zip**：powershell Compress-Archive，零额外依赖。

---

## v0.1.8 (2026-07-22)

### 新增
- **自主代理引擎**：真实文件系统桥（沙箱工作区），ReAct 内核工具调用循环。
- **改名**：软件对外名「私人办公会所」。

---

## v0.1.7 (2026-07-22)

### 新增
- **窗口间 IPC 广播层**：主办公室与聊天子窗口实时状态同步。
- **store 跨窗口同步**：团队消息/任务/进度/员工实时一致。

---

## v0.1.6 (2026-07-22)

### 新增
- **聊天窗口改为原生桌面窗口**：独立 BrowserWindow，frame:false 无边框，CSS drag 拖动。
- **文件上传/粘贴**：附件分类、图片多模态视觉、文件保存为产出物。
- **ChatOnlyView**：解析 #chat hash，统一聊天子窗口入口。

---

## v0.1.5 (2026-07-22)

### 修复
- HTML 产出物撑开 UI → iframe sandbox 沙箱。
- 浮窗全屏覆盖，clampPos 全屏范围。

---

## v0.1.4 (2026-07-22)

### 修复
- 产出物面板不再导致全局布局变化。
- 外部浏览器打开产出物预览。

---

## v0.1.3 (2026-07-22)

### 新增
- **ChatOutputsPanel**：聊天内嵌产出物面板。
- **OutputRenderer**：多类型预览（Markdown/HTML/代码/JSON/CSV/图片/URL）。
- **OutputRecord**：contentType + scope 字段，分项目过滤。

---

## v0.1.2 (2026-07-22)

### 新增
- **浮窗拖拽边界 clamp + 置顶 + 文本复制 + 右侧产出物面板**。
- **链接可点击**：linkify 自动检测渲染。
- 安装包 `Hermes 主动协作办公室 Setup 0.1.2.exe`（80MB）。

---

## v0.1.1 (2026-07-22)

### 新增
- **初始版本**：Electron + Vite + React 骨架，OPC 四角色种子员工和团队，OpenAI 兼容 API 调用。
- 安装包 `Hermes 主动协作办公室 Setup 0.1.1.exe`（80MB）。
## 0.51.0

- 新增主进程统一 `TaskService`，为助理、员工、团队和子任务提供统一任务实体。
- 增加任务幂等创建、工具尝试、交付物、上下文引用、子任务和状态控制接口。
- 增加重启回放与账本完整性验收脚本 `verify:task-service`。
- 明确本版本只建立任务底座，后续版本逐步迁移旧聊天入口，避免把未迁移能力冒充完成。
## 0.52.0

- 普通工具、Skill、连接器、文件和命令调用统一回写 TaskService 工具尝试记录。
- 工具产出的真实文件统一登记为任务交付物，并保留是否验证落盘的状态。
- 失败记录保存错误分类，后续 Runner 可据此决定重试、换路线或暂停。
## 0.53.0

- TaskService 创建任务时生成并校验版本化 Contract/Plan。
- 增加步骤依赖查询，只有前置步骤真实完成后才会进入可执行列表。
- 增加步骤成功、失败、可重试和阻塞状态的统一写回接口。
## 0.54.0

- 步骤失败增加认证、权限、限流、超时、网络、配置和校验错误分类。
- 可重试错误使用指数退避并记录下一次重试时间；不可重试错误直接阻塞任务。
- 重试次数、最后错误和调度事件全部持久化，恢复任务时不会丢失失败原因。
## 0.55.0

- `delegate_subtask` 的独立 child task 数据底座已准备完成，子任务会保存父任务、员工、步骤和幂等关系。
- 后续委派执行将把领取、提交、失败状态同步回父任务。
## 0.56.0

- 子任务创建时继承父任务的目标、验收标准、已验证产物和上下文引用。
- 新增任务上下文查询接口，按任务边界提供摘要、已完成步骤、引用和阻塞原因。
- 不复制完整聊天记录，降低上下文串台和无效 token 消耗。
## 0.57.0

- Skill 原生读取结果增加结构化激活证据：Skill ID、名称、引用文档数量和读取验证状态。
- 区分 Skill 检索、读取、安装和实际执行，安装成功不再等同于“已经按 Skill 规则完成任务”。
## 0.58.0-0.60.0

- 连接器和外部工具结果统一进入任务尝试账本，保留失败分类与验证状态。
- 增加任务级人工授权请求、授权决定和审计记录。
- 增加任务耗时、步骤、工具、错误类别、交付物、授权和模型用量指标查询。
## 0.61.0

- 代码、脚本、构建和测试任务自动标记为需要 Git Worktree 隔离。
- 增加代码任务检查点和命令验证记录，支持后续回滚与审查。
## 0.62.0

- 增加统一交付门禁，代码任务必须通过步骤、检查点、验证和授权四类检查。
- 提供 `validateCompletion` 接口，模型总结不能直接替代真实验收。
