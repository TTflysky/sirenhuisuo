const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const { buildTaskObservability } = require('./executionObservability.cjs');

const TASK_SERVICE_VERSION = 3;
const TASK_TYPES = new Set(['assistant', 'dm', 'team', 'child', 'coding']);
const DELIVERABLE_TYPES = new Set(['answer', 'file', 'connection', 'operation', 'decision', 'mixed']);
const ACTIVE_STATUSES = new Set(['queued', 'running', 'awaiting_user', 'paused']);
const TERMINAL_STATUSES = new Set(['failed', 'completed', 'stopped']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function list(value, fallback = []) {
  return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean) : fallback;
}

function normalizeDeliverableType(value) {
  const normalized = text(value, 40).toLowerCase();
  return DELIVERABLE_TYPES.has(normalized) ? normalized : undefined;
}

function inferLegacyDeliverableType(input = {}, parent = {}) {
  const declared = normalizeDeliverableType(input.deliverableType);
  if (declared) return declared;
  const source = `${text(input.title, 400)} ${text(input.assignment || input.goal, 3000)}`;
  if (/(?:\bhtml\b|\bpdf\b|\bexcel\b|\bword\b|\bppt\b|\bfile\b|\bcode\b|\bscript\b|\bpage\b|文件|文档|代码|网页|页面|脚本|安装包)/iu.test(source)) return 'file';
  if (/(?:\bconnect(?:ion|or)?\b|\bmcp\b|\bima\b|连接|接入|知识库)/iu.test(source)) return 'connection';
  if (/(?:\binstall\b|\bdeploy\b|\bpublish\b|\bexecute\b|\brun\b|安装|部署|发布|执行|运行|上传|下载)/iu.test(source)) return 'operation';
  if (/(?:\bdesign\b|\bplan\b|\banaly[sz]e\b|\breview\b|\bdecision\b|\bux\b|方案|设计|分析|审查|评估|调研|规划)/iu.test(source)) return 'decision';
  return normalizeDeliverableType(parent.deliverableType || parent.contract?.deliverableType || parent.taskDecision?.deliverableType) || 'answer';
}

function normalizeStep(input, index) {
  const stepId = text(input?.stepId || input?.id, 160) || `step-${index + 1}`;
  return {
    id: stepId,
    title: text(input?.title || input?.assignment || stepId, 240),
    assignment: text(input?.assignment || input?.title || stepId, 2000),
    employeeId: text(input?.employeeId, 160) || undefined,
    dependsOnStepIds: list(input?.dependsOnStepIds || input?.dependsOn, []),
    sideEffect: input?.sideEffect !== false,
    compensateStepId: text(input?.compensateStepId || input?.compensate_step, 160) || undefined,
    compensationOnly: input?.compensationOnly === true,
    approvalRequired: input?.approvalRequired === true,
    kind: text(input?.kind, 40) || undefined,
    codingRole: text(input?.codingRole, 80) || undefined,
    reviewPoint: input?.reviewPoint === true,
    acceptanceCriteria: list(input?.acceptanceCriteria, []),
    maxRetries: Number.isInteger(input?.maxRetries) ? Math.max(0, Math.min(10, input.maxRetries)) : undefined,
    deliverableType: normalizeDeliverableType(input?.deliverableType),
    status: 'queued',
    attempts: 0,
    events: [{ ts: Date.now(), type: 'status', detail: '任务步骤已创建，等待执行' }],
  };
}

function normalizeTaskInput(input = {}) {
  const taskType = TASK_TYPES.has(input.taskType) ? input.taskType : 'assistant';
  const goal = text(input.goal || input.request);
  if (!goal) throw new Error('TaskService: goal is required');
  const steps = Array.isArray(input.steps) && input.steps.length
    ? input.steps.map(normalizeStep)
    : [normalizeStep({ title: '完成用户目标', assignment: goal }, 0)];
  const requiresWorktree = taskType === 'coding' || input.requiresWorktree === true || /代码|编程|开发|脚本|构建|编译|测试|修复|bug|coding|software|repository/iu.test(goal);
  const rawTaskDecision = input.taskDecision && typeof input.taskDecision === 'object' && !Array.isArray(input.taskDecision)
    ? clone(input.taskDecision)
    : undefined;
  const taskDeliverableType = normalizeDeliverableType(input.deliverableType || rawTaskDecision?.deliverableType);
  const taskDecision = rawTaskDecision || taskDeliverableType ? {
    ...(rawTaskDecision || {}),
    ...(taskDeliverableType ? { deliverableType: taskDeliverableType } : {}),
  } : undefined;
  if (taskDeliverableType) {
    for (const step of steps) if (!step.deliverableType) step.deliverableType = taskDeliverableType;
  }
  return {
    id: text(input.id, 180) || id('task'),
    taskType,
    teamId: text(input.teamId, 180) || `scope:${taskType}`,
    conversationId: text(input.conversationId, 180) || undefined,
    ownerId: text(input.ownerId, 180) || 'assistant',
    parentTaskId: text(input.parentTaskId, 180) || undefined,
    projectId: text(input.projectId, 180) || undefined,
    sourceMessageId: text(input.sourceMessageId, 180) || undefined,
    workspaceId: text(input.workspaceId, 800) || undefined,
    title: text(input.title || goal, 240),
    request: text(input.request || goal),
    goal,
    status: 'queued',
    phase: 'preflight',
    acceptanceCriteria: list(input.acceptanceCriteria, ['完成用户目标', '留下真实可观察结果', '完成必要验收']),
    constraints: list(input.constraints),
    taskDecision,
    projectBrief: input.projectBrief && typeof input.projectBrief === 'object' ? clone(input.projectBrief) : undefined,
    deliverableType: taskDeliverableType,
    memberSnapshot: Array.isArray(input.memberSnapshot) ? clone(input.memberSnapshot) : undefined,
    steps,
    artifacts: [],
    references: [],
    toolAttempts: [],
    approvals: [],
    workspace: {
      mode: requiresWorktree && text(input.sourceRepo, 1200) ? 'git-worktree' : 'task-workspace',
      status: requiresWorktree && text(input.sourceRepo, 1200) ? 'pending' : text(input.workspaceId, 800) ? 'ready' : 'not-required',
      workspaceId: text(input.workspaceId, 800) || undefined,
      sourceRepo: text(input.sourceRepo, 1200) || undefined,
    },
    checkpoints: [],
    verifications: [],
    usage: { modelRounds: 0, promptTokens: 0, completionTokens: 0, estimatedTokens: 0, toolCalls: 0 },
    waitingFor: undefined,
    serviceEvents: [{ ts: Date.now(), type: 'task_created', detail: '任务已进入统一任务服务' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    taskServiceVersion: TASK_SERVICE_VERSION,
    idempotencyKey: text(input.idempotencyKey, 240) || undefined,
  };
}

function findExisting(runs, input) {
  const key = text(input?.idempotencyKey, 240);
  if (!key) return undefined;
  const teamId = text(input?.teamId, 180) || `scope:${input?.taskType || 'assistant'}`;
  return runs.find((run) => run.idempotencyKey === key && run.teamId === teamId);
}

function appendServiceEvent(task, type, detail, payload = {}) {
  task.serviceEvents = Array.isArray(task.serviceEvents) ? task.serviceEvents : [];
  task.serviceEvents.push({ ts: Date.now(), type, detail: text(detail, 1000), payload: clone(payload) });
  task.serviceEvents = task.serviceEvents.slice(-500);
}

function normalizeLifecycle(input) {
  const lifecycle = input?.lifecycle;
  if (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)) throw new Error('TaskService: lifecycle snapshot is required');
  const sequence = Math.max(0, Number(lifecycle.sequence) || 0);
  const status = text(lifecycle.status, 40) || 'running';
  if (!['running', 'completed', 'waiting_user', 'paused', 'checkpointed', 'stopped', 'failed'].includes(status)) {
    throw new Error(`TaskService: invalid lifecycle status ${status}`);
  }
  return {
    ...clone(lifecycle),
    protocolVersion: Math.max(1, Number(lifecycle.protocolVersion) || 1),
    sequence,
    status,
    phase: text(lifecycle.phase, 80) || status,
    activity: text(lifecycle.activity, 500) || undefined,
    progressAt: Number(lifecycle.progressAt) || Date.now(),
    updatedAt: Number(lifecycle.updatedAt) || Date.now(),
  };
}

async function sanitizeLifecycleInput(input = {}) {
  const projectRoot = path.resolve(__dirname, '..');
  const lifecycleEngine = await import(pathToFileURL(path.join(projectRoot, 'src/engine/turnLifecycle.mjs')).href);
  return {
    lifecycle: lifecycleEngine.sanitizeLifecycleValue(input.lifecycle),
    recovery: lifecycleEngine.sanitizeLifecycleValue(input.recovery),
  };
}

function updateStep(task, stepId, mutate) {
  const step = task.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`TaskService: unknown step ${stepId}`);
  mutate(step);
  step.updatedAt = Date.now();
  return step;
}

function classifyFailure(error) {
  const message = text(error, 1200);
  if (/401|unauthorized|api.?key|token|credential|凭据|密钥/iu.test(message)) return { category: 'authentication', retryable: false };
  if (/403|forbidden|permission|denied|权限|拒绝/iu.test(message)) return { category: 'permission', retryable: false };
  if (/429|rate.?limit|too many requests|限流/iu.test(message)) return { category: 'rate-limit', retryable: true };
  if (/timeout|timed out|aborted|超时|signal is aborted/iu.test(message)) return { category: 'timeout', retryable: true };
  if (/ECONN|ENOTFOUND|fetch failed|network|socket|网络|连接失败/iu.test(message)) return { category: 'network', retryable: true };
  if (/schema|required|invalid|parameter|参数|格式|校验/iu.test(message)) return { category: 'validation', retryable: false };
  if (/not found|missing|不存在|缺少|未配置/iu.test(message)) return { category: 'configuration', retryable: false };
  return { category: 'unknown', retryable: false };
}

function taskTreeNode(task, depth, children) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const compensation = Array.isArray(task.compensation) ? task.compensation : [];
  return {
    id: task.id,
    parentTaskId: task.parentTaskId,
    depth,
    taskType: task.taskType,
    title: text(task.title || task.goal, 240),
    status: task.status,
    phase: task.phase,
    blocked: text(task.handoff?.blocked || task.waitingFor || task.lastError, 1200) || undefined,
    nextAction: text(task.handoff?.nextAction, 1200) || undefined,
    childTaskIds: children.map((child) => child.id),
    steps: {
      total: steps.length,
      completed: steps.filter((step) => step.status === 'completed').length,
      failed: steps.filter((step) => step.status === 'failed').length,
      active: steps.filter((step) => ['running', 'queued', 'paused'].includes(step.status)).length,
    },
    artifacts: { verified: (task.artifacts || []).filter((artifact) => artifact.verified === true).length, final: (task.artifacts || []).filter((artifact) => artifact.category === 'final' && artifact.verified === true).length },
    compensation: {
      completed: compensation.filter((item) => item.status === 'completed' || item.status === 'already_completed').length,
      blocked: compensation.filter((item) => item.status === 'blocked' || item.status === 'missing').length,
      failed: compensation.filter((item) => item.status === 'failed').length,
    },
    updatedAt: task.updatedAt,
  };
}

async function attachFormalPlan(task) {
  const projectRoot = path.resolve(__dirname, '..');
  const planEngine = await import(pathToFileURL(path.join(projectRoot, 'src/engine/taskPlan.mjs')).href);
  const incomingDecision = task.taskDecision || {};
  const primaryRoute = task.taskType === 'team' ? 'team_dispatch' : text(incomingDecision.primaryRoute, 80) || 'general_tools';
  const contract = planEngine.createTaskContract({
    contractId: `contract-${task.id}`,
    sourceRequest: task.request,
    scope: `task:${task.id}`,
    decision: {
      ...incomingDecision,
      deliverableType: task.deliverableType || incomingDecision.deliverableType,
      mode: 'execute',
      goal: task.goal,
      primaryRoute,
      acceptanceCriteria: list(incomingDecision.acceptanceCriteria, task.acceptanceCriteria),
      requiredConstraints: list(incomingDecision.requiredConstraints, task.constraints),
      requiresEvidence: true,
      source: incomingDecision.source === 'model' ? 'model' : 'rules',
      confidence: Number.isFinite(incomingDecision.confidence) ? incomingDecision.confidence : 1,
    },
    teamPolicy: {
      requiresTeam: task.taskType === 'team',
      explicitMemberIds: task.steps.map((step) => step.employeeId).filter(Boolean),
      allowDynamicDelegation: true,
    },
  });
  const plan = planEngine.createPlan({
    planId: `plan-${task.id}`,
    contract,
    steps: task.steps.map((step) => ({
      stepId: step.id,
      type: step.kind === 'review' ? 'review' : step.employeeId ? 'tool' : 'composite',
      connector: `task-step:${step.employeeId || 'assistant'}`,
      input: { assignment: step.assignment, employeeId: step.employeeId },
      expectedOutputSchema: { type: 'object' },
      dependsOn: step.dependsOnStepIds,
      retryPolicy: { maxRetries: Number.isInteger(step.maxRetries) ? step.maxRetries : 3, backoffMs: 1000, maxBackoffMs: 30000 },
      idempotencyKey: `task-${task.id}-${step.id}`,
      sideEffect: step.kind !== 'review',
      metadata: { taskServiceVersion: TASK_SERVICE_VERSION, deliverableType: step.deliverableType || contract.deliverableType, codingRole: step.codingRole, reviewPoint: step.reviewPoint === true, acceptanceCriteria: step.acceptanceCriteria || [] },
    })),
  });
  const validation = planEngine.validatePlan(plan, { allowInlineApproval: true });
  if (!validation.valid) throw new Error(`TaskService: invalid generated plan: ${validation.errors.join('; ')}`);
  task.contract = contract;
  task.plan = plan;
  task.serviceEvents.push({ ts: Date.now(), type: 'plan_created', detail: '任务 Contract 和 Plan 已通过校验' });
  return task;
}

async function attachCodingProject(task, input = {}) {
  const isCoding = task.taskType === 'coding' || input.codingProject === true;
  if (!isCoding) return task;
  const projectRoot = path.resolve(__dirname, '..');
  const compiler = await import(pathToFileURL(path.join(projectRoot, 'src/engine/codingProject.mjs')).href);
  const compiled = compiler.compileCodingProject({
    goal: task.goal,
    projectBrief: task.projectBrief,
    members: task.memberSnapshot?.length ? task.memberSnapshot : input.members || [],
    memberIds: input.memberIds,
    requiredCapabilities: input.requiredCapabilities,
  });
  task.codingProject = compiled;
  task.steps = compiler.codingProjectToTaskSteps(compiled).map(normalizeStep);
  task.acceptanceCriteria = [...new Set([...(task.acceptanceCriteria || []), 'Preserve a diff and rollback checkpoint', 'Record build or test evidence', 'A review rejection only reopens the responsible step'])];
  task.serviceEvents.push({ ts: Date.now(), type: 'coding_project_compiled', detail: `Coding project DAG compiled with ${task.steps.length} stages`, payload: { status: compiled.status, staffingGaps: compiled.staffingGaps } });
  return task;
}

function createTaskService(store, options = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function' || typeof store.updateTask !== 'function') {
    throw new Error('TaskService requires a task runtime store');
  }

  async function read(options = {}) {
    return store.read(options);
  }

  async function create(input = {}) {
    const normalized = normalizeTaskInput(input);
    await attachCodingProject(normalized, input);
    await attachFormalPlan(normalized);
    const snapshot = await store.read();
    if (!snapshot.ok) throw new Error(snapshot.error || '无法读取任务账本');
    const existing = findExisting(snapshot.runs || [], input);
    if (existing) return { ok: true, created: false, idempotent: true, task: clone(existing) };
    const result = await store.write([...(snapshot.runs || []), normalized], {
      source: 'task-service',
      detail: `统一任务服务创建 ${normalized.taskType} 任务`,
    });
    if (!result.ok) throw new Error(result.error || '无法写入任务账本');
    let task = (await store.read({ taskId: normalized.id })).runs?.[0] || normalized;
    if (task.workspace?.status === 'pending' && options.codingRuntime) {
      const prepared = await options.codingRuntime.prepareTask({ taskId: task.id, sourceRepo: task.workspace.sourceRepo, baseRef: input.baseRef });
      if (prepared.ok) {
        await update(task.id, (current) => {
          current.workspace = { ...current.workspace, ...prepared.workspace, index: prepared.index };
          appendServiceEvent(current, 'coding_workspace_ready', 'Coding workspace and repository index are ready', { workspaceId: prepared.workspace.workspaceId, fileCount: prepared.index?.fileCount });
        }, 'Prepare independent coding workspace');
      } else {
        await update(task.id, (current) => {
          current.workspace = { ...current.workspace, status: 'failed', error: text(prepared.error, 1200) };
          current.status = 'failed'; current.phase = 'blocked'; current.lastError = text(prepared.error, 1200);
          appendServiceEvent(current, 'coding_workspace_failed', current.lastError, {});
        }, 'Coding workspace preparation failed');
      }
      task = (await store.read({ taskId: normalized.id })).runs?.[0] || task;
    }
    return { ok: true, created: true, idempotent: false, task };
  }

  async function update(taskId, mutate, detail = '统一任务服务更新任务') {
    const result = await store.updateTask(taskId, (task) => {
      mutate(task);
      task.taskServiceVersion = TASK_SERVICE_VERSION;
      task.updatedAt = Date.now();
    }, { source: 'task-service', detail });
    if (!result.ok) throw new Error(result.error || '无法更新任务');
    return result;
  }

  async function recordToolAttempt(taskId, input = {}) {
    const attempt = {
      id: text(input.id, 180) || id('attempt'),
      stepId: text(input.stepId, 160) || undefined,
      toolName: text(input.toolName, 240),
      status: ['started', 'succeeded', 'failed', 'skipped'].includes(input.status) ? input.status : 'started',
      errorClass: text(input.errorClass, 120) || undefined,
      inputSummary: text(input.inputSummary, 1200),
      outputSummary: text(input.outputSummary, 2000),
      evidenceIds: list(input.evidenceIds),
      startedAt: Number(input.startedAt) || Date.now(),
      finishedAt: Number(input.finishedAt) || undefined,
    };
    if (!attempt.toolName) throw new Error('TaskService: toolName is required');
    return update(taskId, (task) => {
      task.toolAttempts = Array.isArray(task.toolAttempts) ? task.toolAttempts : [];
      const index = task.toolAttempts.findIndex((item) => item.id === attempt.id);
      task.usage = { modelRounds: 0, promptTokens: 0, completionTokens: 0, estimatedTokens: 0, toolCalls: 0, ...(task.usage || {}) };
      task.usage.toolCalls += index >= 0 ? 0 : 1;
      if (index >= 0) task.toolAttempts[index] = { ...task.toolAttempts[index], ...attempt };
      else task.toolAttempts.push(attempt);
      if (attempt.stepId) updateStep(task, attempt.stepId, (step) => {
        step.attempts = Math.max(Number(step.attempts) || 0, task.toolAttempts.filter((item) => item.stepId === attempt.stepId).length);
        step.events = Array.isArray(step.events) ? step.events : [];
        step.events.push({ ts: Date.now(), type: 'tool_attempt', detail: `${attempt.toolName}: ${attempt.status}` });
      });
      appendServiceEvent(task, 'tool_attempt', `${attempt.toolName} ${attempt.status}`, { attemptId: attempt.id, stepId: attempt.stepId });
    }, '记录工具尝试与结果');
  }

  async function addArtifact(taskId, input = {}) {
    const artifact = {
      id: text(input.id, 180) || id('artifact'),
      name: text(input.name || input.path, 500),
      path: text(input.path, 1600),
      diskPath: text(input.diskPath, 1800) || undefined,
      workspaceId: text(input.workspaceId, 800) || undefined,
      bytes: Number.isFinite(Number(input.bytes)) ? Math.max(0, Number(input.bytes)) : undefined,
      contentType: text(input.contentType, 160) || undefined,
      verification: text(input.verification, 120) || undefined,
      category: ['final', 'working', 'reference'].includes(input.category) ? input.category : 'final',
      verified: input.verified === true,
      source: text(input.source, 120) || 'task-service',
      createdAt: Date.now(),
    };
    if (!artifact.name || !artifact.path) throw new Error('TaskService: artifact name and path are required');
    return update(taskId, (task) => {
      task.artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
      const index = task.artifacts.findIndex((item) => item.id === artifact.id || item.path === artifact.path);
      if (index >= 0) task.artifacts[index] = { ...task.artifacts[index], ...artifact };
      else task.artifacts.push(artifact);
      appendServiceEvent(task, 'artifact_registered', `登记交付物：${artifact.name}`, { artifactId: artifact.id, verified: artifact.verified });
    }, '登记任务交付物');
  }

  async function addReference(taskId, input = {}) {
    const reference = {
      kind: text(input.kind, 80) || 'answer',
      id: text(input.id, 500) || id('ref'),
      label: text(input.label, 500),
      sourceUrl: text(input.sourceUrl, 1600) || undefined,
      state: text(input.state, 80) || 'unknown',
      createdAt: Date.now(),
    };
    if (!reference.label) throw new Error('TaskService: reference label is required');
    return update(taskId, (task) => {
      task.references = Array.isArray(task.references) ? task.references : [];
      const index = task.references.findIndex((item) => item.id === reference.id);
      if (index >= 0) task.references[index] = { ...task.references[index], ...reference };
      else task.references.push(reference);
      appendServiceEvent(task, 'reference_bound', `绑定引用：${reference.label}`, { referenceId: reference.id, kind: reference.kind });
    }, '绑定任务上下文引用');
  }

  async function createChild(parentTaskId, input = {}) {
    const assignment = text(input.assignment || input.goal || input.title, 3000);
    const childIdempotencyKey = input.idempotencyKey || `child:${parentTaskId}:${input.employeeId || 'assistant'}:${crypto.createHash('sha256').update(`${input.title || ''}\n${assignment}\n${input.deliverableType || ''}`).digest('hex').slice(0, 16)}`;
    const parentSnapshot = await store.read({ taskId: parentTaskId });
    const parent = parentSnapshot.ok ? parentSnapshot.runs?.[0] : undefined;
    const result = await create({
      ...input,
      taskType: 'child',
      parentTaskId,
      projectId: input.projectId || parent?.projectId || parent?.goalState?.projectId,
      deliverableType: normalizeDeliverableType(input.deliverableType || input.taskDecision?.deliverableType),
      teamId: input.teamId || parent?.teamId,
      conversationId: input.conversationId || parent?.conversationId,
      memberSnapshot: input.memberSnapshot || parent?.memberSnapshot,
      steps: input.steps || [{ id: 'step-1', title: input.title || '员工子任务', assignment, employeeId: input.employeeId }],
      idempotencyKey: childIdempotencyKey,
    });
    if (result.task && !input.steps && normalizeDeliverableType(input.deliverableType || input.taskDecision?.deliverableType)) {
      await update(result.task.id, (child) => {
        for (const step of child.steps || []) step.deliverableType = normalizeDeliverableType(input.deliverableType || input.taskDecision?.deliverableType);
      }, '同步子任务交付类型');
      result.task = (await store.read({ taskId: result.task.id })).runs?.[0] || result.task;
    }
    if (result.task && parent) {
      const inheritedReferences = Array.isArray(parent.references) ? parent.references.slice(-30) : [];
      const inheritedArtifacts = Array.isArray(parent.artifacts) ? parent.artifacts.filter((item) => item.verified).slice(-20) : [];
      await update(result.task.id, (child) => {
        child.inheritedContext = {
          parentTaskId,
          parentGoal: text(parent.goal, 2000),
          acceptanceCriteria: list(parent.acceptanceCriteria),
          verifiedArtifacts: clone(inheritedArtifacts),
          references: clone(inheritedReferences),
          parentLifecycleRecovery: clone(parent.lifecycleRecovery),
          parentLifecycleExit: clone(parent.turnLifecycle?.exit),
          capturedAt: Date.now(),
        };
        child.references = [...inheritedReferences, ...(child.references || [])].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(-60);
        appendServiceEvent(child, 'context_inherited', '已从父任务继承目标、验收标准和已验证引用', { parentTaskId });
      }, '子任务继承父任务上下文');
      result.task = (await store.read({ taskId: result.task.id })).runs?.[0] || result.task;
    }
    return result;
  }

  async function repairDelegationCollisions(parentTaskId) {
    const snapshot = await store.read({ taskId: parentTaskId });
    const parent = snapshot.ok ? snapshot.runs?.[0] : undefined;
    if (!parent) throw new Error(snapshot.error || `找不到任务：${parentTaskId}`);
    const seen = new Set();
    const collisions = (parent.steps || []).filter((step) => {
      const childTaskId = text(step.childTaskId, 180);
      if (!childTaskId) return false;
      if (seen.has(childTaskId)) return true;
      seen.add(childTaskId);
      return false;
    });
    const repaired = [];
    for (const step of collisions) {
      const deliverableType = inferLegacyDeliverableType(step, parent);
      const created = await createChild(parent.id, {
        employeeId: step.employeeId,
        title: step.title,
        assignment: step.assignment,
        goal: step.assignment || step.title,
        deliverableType,
        teamId: parent.teamId,
        conversationId: parent.conversationId,
        memberSnapshot: parent.memberSnapshot,
      });
      if (!created.task?.id) throw new Error('修复重复子任务引用时未能创建新任务');
      const replacementId = created.task.id;
      const previousId = step.childTaskId;
      await update(parent.id, (current) => {
        const currentStep = (current.steps || []).find((item) => item.id === step.id && item.childTaskId === previousId);
        if (!currentStep) return;
        currentStep.childTaskId = replacementId;
        currentStep.deliverableType = deliverableType;
        currentStep.status = 'queued';
        currentStep.lastError = undefined;
        currentStep.events = [...(currentStep.events || []), {
          ts: Date.now(), type: 'migration', detail: '已修复旧版本重复复用的子任务引用，改为独立执行。',
        }].slice(-100);
        const delegation = (current.delegations || []).find((item) => item.delegationId === currentStep.delegationId || item.id === currentStep.delegationId);
        if (delegation && delegation.childTaskId === previousId) {
          delegation.childTaskId = replacementId;
          delegation.deliverableType = deliverableType;
          delegation.status = 'queued';
          delegation.error = undefined;
        }
        appendServiceEvent(current, 'delegation_collision_repaired', '已为旧版重复委派创建独立子任务。', {
          stepId: currentStep.id, previousChildTaskId: previousId, replacementChildTaskId: replacementId, deliverableType,
        });
      }, '修复旧版本动态委派重复子任务引用');
      repaired.push({ stepId: step.id, previousChildTaskId: previousId, replacementChildTaskId: replacementId, deliverableType });
    }
    return { ok: true, parentTaskId: parent.id, repaired };
  }

  async function context(taskId, options = {}) {
    const snapshot = await store.read({ taskId });
    if (!snapshot.ok || !snapshot.runs?.[0]) throw new Error(snapshot.error || `找不到任务：${taskId}`);
    const task = snapshot.runs[0];
    const limit = Math.max(1, Math.min(50, Number(options.limit) || 20));
    return {
      ok: true,
      taskId,
      goal: task.goal,
      acceptanceCriteria: clone(task.acceptanceCriteria || []),
      parentTaskId: task.parentTaskId,
      inheritedContext: clone(task.inheritedContext || {}),
      verifiedArtifacts: (task.artifacts || []).filter((item) => item.verified).slice(-limit).map(clone),
      references: (task.references || []).slice(-limit).map(clone),
      completedSteps: (task.steps || []).filter((step) => step.status === 'completed').slice(-limit).map((step) => ({ id: step.id, title: step.title, output: clone(step.output) })),
      unresolvedIssues: [task.lastError, ...(task.steps || []).filter((step) => step.status === 'failed').map((step) => step.lastError)].filter(Boolean).slice(-limit),
      turnLifecycle: clone(task.turnLifecycle),
      lifecycleRecovery: clone(task.lifecycleRecovery),
    };
  }

  async function recordLifecycle(taskId, input = {}) {
    const safeInput = await sanitizeLifecycleInput(input);
    const incoming = normalizeLifecycle(safeInput);
    return update(taskId, (task) => {
      const currentSequence = Number(task.turnLifecycle?.sequence) || 0;
      if (task.turnLifecycle && incoming.sequence <= currentSequence) return;
      task.turnLifecycle = incoming;
      if (safeInput.recovery && typeof safeInput.recovery === 'object') task.lifecycleRecovery = clone(safeInput.recovery);
      if (incoming.status === 'waiting_user') {
        task.status = 'awaiting_user';
        task.phase = 'awaiting_user';
        task.waitingFor = text(incoming.exit?.waitingFor || incoming.recovery?.reason, 1200) || task.waitingFor;
      } else if (incoming.status === 'paused' || incoming.status === 'checkpointed') {
        task.status = 'paused';
        task.phase = 'blocked';
        task.waitingFor = undefined;
      } else if (incoming.status === 'stopped') {
        task.status = 'stopped';
        task.phase = 'blocked';
        task.waitingFor = undefined;
      } else if (incoming.status === 'failed') {
        task.status = 'failed';
        task.phase = 'blocked';
        task.waitingFor = undefined;
      }
      const previousType = task.serviceEvents?.at(-1)?.payload?.lifecycleType;
      const lifecycleType = incoming.events?.at(-1)?.type;
      if (lifecycleType && lifecycleType !== previousType) {
        appendServiceEvent(task, 'lifecycle_advanced', incoming.activity || lifecycleType, {
          lifecycleType,
          sequence: incoming.sequence,
          phase: incoming.phase,
          status: incoming.status,
        });
      }
    }, `记录 Turn Lifecycle #${incoming.sequence}`);
  }

  async function readySteps(taskId) {
    const snapshot = await store.read({ taskId });
    if (!snapshot.ok || !snapshot.runs?.[0]) throw new Error(snapshot.error || `找不到任务：${taskId}`);
    const task = snapshot.runs[0];
    return {
      ok: true,
      taskId,
      steps: task.steps.filter((step) => ['queued', 'paused'].includes(step.status)
        && (step.dependsOnStepIds || []).every((dependency) => task.steps.find((item) => item.id === dependency)?.status === 'completed')).map(clone),
    };
  }

  async function completeStep(taskId, input = {}) {
    const stepId = text(input.stepId, 160);
    if (!stepId) throw new Error('TaskService: stepId is required');
    return update(taskId, (task) => {
      const step = updateStep(task, stepId, (current) => {
        current.status = 'completed';
        current.output = clone(input.output ?? { summary: text(input.summary, 1200) });
        current.completedAt = Date.now();
        current.events = Array.isArray(current.events) ? current.events : [];
        current.events.push({ ts: Date.now(), type: 'completed', detail: text(input.summary || '步骤已完成', 800) });
      });
      appendServiceEvent(task, 'step_completed', `步骤完成：${step.title}`, { stepId });
      if (task.steps.every((item) => item.status === 'completed')) task.status = 'awaiting_user';
    }, `记录步骤完成：${stepId}`);
  }

  async function recordReviewDecision(taskId, input = {}) {
    const reviewStepId = text(input.reviewStepId || input.stepId, 160);
    const responsibleStepId = text(input.responsibleStepId, 160);
    const approved = input.approved === true;
    const reason = text(input.reason, 1200) || (approved ? 'Review passed' : 'Review rejected');
    if (!reviewStepId) throw new Error('TaskService: reviewStepId is required');
    return update(taskId, (task) => {
      const review = updateStep(task, reviewStepId, (step) => {
        if (step.kind !== 'review') throw new Error(`TaskService: ${reviewStepId} is not a review step`);
        step.status = approved ? 'completed' : 'queued';
        step.output = { review: { decision: approved ? 'pass' : 'reject', reason, responsibleStepId: responsibleStepId || undefined } };
        step.lastError = approved ? undefined : reason;
        step.events = [...(step.events || []), { ts: Date.now(), type: approved ? 'review_passed' : 'review_rejected', detail: reason, responsibleStepId: responsibleStepId || undefined }].slice(-100);
      });
      if (!approved) {
        if (!responsibleStepId) throw new Error('TaskService: responsibleStepId is required for a rejected review');
        const responsible = updateStep(task, responsibleStepId, (step) => {
          if (step.kind === 'review') throw new Error('TaskService: a review cannot reject another review as the responsible work step');
          step.status = 'queued'; step.lastError = reason; step.retryAt = undefined;
          step.events = [...(step.events || []), { ts: Date.now(), type: 'review_rework_requested', detail: reason, reviewStepId }].slice(-100);
        });
        task.status = 'queued'; task.phase = 'execution'; task.lastError = reason;
        appendServiceEvent(task, 'review_rejected', `Review returned only responsible step: ${responsible.title}`, { reviewStepId, responsibleStepId, reason });
      } else {
        appendServiceEvent(task, 'review_passed', `Review passed: ${review.title}`, { reviewStepId });
      }
    }, approved ? 'Record coding review pass' : 'Return only the responsible coding step');
  }

  async function failStep(taskId, input = {}) {
    const stepId = text(input.stepId, 160);
    if (!stepId) throw new Error('TaskService: stepId is required');
    const reason = text(input.error || input.reason, 1200) || '步骤执行失败';
    const classification = input.errorClass ? { category: text(input.errorClass, 120), retryable: input.retryable === true } : classifyFailure(reason);
    return update(taskId, (task) => {
      const step = updateStep(task, stepId, (current) => {
        current.attempts = (Number(current.attempts) || 0) + 1;
        const maxRetries = Number.isInteger(current.maxRetries) ? current.maxRetries : 3;
        const retryable = classification.retryable === true && current.attempts <= maxRetries;
        current.status = retryable ? 'queued' : 'failed';
        current.lastError = reason;
        current.errorClass = classification.category;
        current.retryAt = retryable ? Date.now() + Math.min(300000, 1000 * (2 ** Math.max(0, current.attempts - 1))) : undefined;
        current.events = Array.isArray(current.events) ? current.events : [];
        current.events.push({ ts: Date.now(), type: retryable ? 'retry_scheduled' : 'failed', detail: reason, errorClass: classification.category, retryable });
        input._retryable = retryable;
      });
      task.status = input._retryable ? 'queued' : 'failed';
      task.phase = 'blocked';
      task.lastError = reason;
      appendServiceEvent(task, input._retryable ? 'step_retry_scheduled' : 'step_failed', `步骤失败：${step.title}`, { stepId, retryable: input._retryable, errorClass: classification.category });
    }, `记录步骤失败：${stepId}`);
  }

  async function requestApproval(taskId, input = {}) {
    const approval = {
      id: text(input.id, 180) || id('approval'),
      stepId: text(input.stepId, 160) || undefined,
      scope: text(input.scope, 120) || 'task',
      reason: text(input.reason, 1600),
      requestedBy: text(input.requestedBy, 180) || 'assistant',
      status: 'pending',
      requestedAt: Date.now(),
    };
    if (!approval.reason) throw new Error('TaskService: approval reason is required');
    return update(taskId, (task) => {
      task.approvals = Array.isArray(task.approvals) ? task.approvals : [];
      task.approvals.push(approval);
      task.status = 'awaiting_user';
      task.phase = 'awaiting_user';
      task.waitingFor = approval.reason;
      appendServiceEvent(task, 'approval_requested', `等待授权：${approval.reason}`, { approvalId: approval.id, stepId: approval.stepId });
    }, '任务请求人工授权');
  }

  async function decideApproval(taskId, input = {}) {
    const decision = input.decision === 'approved' ? 'approved' : input.decision === 'rejected' ? 'rejected' : '';
    if (!decision) throw new Error('TaskService: approval decision must be approved or rejected');
    const result = await update(taskId, (task) => {
      const approval = (task.approvals || []).find((item) => item.id === input.approvalId && item.status === 'pending');
      if (!approval) throw new Error(`找不到待处理授权：${input.approvalId}`);
      approval.status = decision;
      approval.decidedAt = Date.now();
      approval.decidedBy = text(input.decidedBy, 180) || 'user';
      approval.note = text(input.note, 1000) || undefined;
      task.waitingFor = undefined;
      const approvedCompensation = decision === 'approved' && approval.scope === 'compensation';
      task.status = decision === 'approved' ? (approvedCompensation ? 'paused' : 'queued') : 'failed';
      task.phase = decision === 'approved' ? (approvedCompensation ? 'awaiting_user' : 'preflight') : 'blocked';
      if (decision === 'approved' && approval.scope === 'compensation' && task.handoff?.compensation?.compensateStepId === approval.stepId) task.handoff = undefined;
      if (decision === 'rejected') task.lastError = approval.note || '用户拒绝了任务授权';
      appendServiceEvent(task, `approval_${decision}`, `授权${decision === 'approved' ? '通过' : '拒绝'}`, { approvalId: approval.id });
    }, '记录人工授权决定');
    return result;
  }

  async function recordUsage(taskId, input = {}) {
    return update(taskId, (task) => {
      task.usage = { modelRounds: 0, promptTokens: 0, completionTokens: 0, estimatedTokens: 0, toolCalls: 0, ...(task.usage || {}) };
      for (const key of ['modelRounds', 'promptTokens', 'completionTokens', 'estimatedTokens', 'toolCalls']) {
        const value = Number(input[key]);
        if (Number.isFinite(value) && value >= 0) task.usage[key] += value;
      }
      appendServiceEvent(task, 'usage_recorded', '记录模型与工具用量', { usage: clone(input) });
    }, '记录任务用量');
  }

  async function metrics(taskId) {
    const snapshot = await store.read({ taskId });
    if (!snapshot.ok || !snapshot.runs?.[0]) throw new Error(snapshot.error || `找不到任务：${taskId}`);
    const task = snapshot.runs[0];
    const attempts = task.toolAttempts || [];
    const failures = attempts.filter((item) => item.status === 'failed');
    const startedAt = Number(task.startedAt || task.createdAt) || Date.now();
    const endedAt = Number(task.completedAt || task.updatedAt) || startedAt;
    return {
      ok: true,
      taskId,
      status: task.status,
      durationMs: Math.max(0, endedAt - startedAt),
      active: ACTIVE_STATUSES.has(task.status),
      steps: { total: task.steps?.length || 0, completed: (task.steps || []).filter((step) => step.status === 'completed').length, failed: (task.steps || []).filter((step) => step.status === 'failed').length },
      compensation: {
        total: (task.compensation || []).length,
        completed: (task.compensation || []).filter((item) => item.status === 'completed' || item.status === 'already_completed').length,
        blocked: (task.compensation || []).filter((item) => item.status === 'blocked' || item.status === 'missing').length,
        failed: (task.compensation || []).filter((item) => item.status === 'failed').length,
      },
      tools: { total: attempts.length, succeeded: attempts.filter((item) => item.status === 'succeeded').length, failed: failures.length, byErrorClass: Object.fromEntries([...new Set(failures.map((item) => item.errorClass || 'unknown'))].map((key) => [key, failures.filter((item) => (item.errorClass || 'unknown') === key).length])) },
      artifacts: { total: task.artifacts?.length || 0, verified: (task.artifacts || []).filter((item) => item.verified).length, final: (task.artifacts || []).filter((item) => item.category === 'final').length },
      usage: clone(task.usage || {}),
      approvals: { total: task.approvals?.length || 0, pending: (task.approvals || []).filter((item) => item.status === 'pending').length },
      observability: buildTaskObservability(task),
      integrity: snapshot.integrity,
    };
  }

  async function tree(taskId) {
    const rootId = text(taskId, 180);
    if (!rootId) throw new Error('TaskService: taskId is required');
    const snapshot = await store.read();
    if (!snapshot.ok) throw new Error(snapshot.error || '无法读取任务账本');
    const root = (snapshot.runs || []).find((task) => task.id === rootId);
    if (!root) throw new Error(`找不到任务：${rootId}`);
    const byParent = new Map();
    for (const task of snapshot.runs || []) {
      if (!task.parentTaskId) continue;
      const children = byParent.get(task.parentTaskId) || [];
      children.push(task);
      byParent.set(task.parentTaskId, children);
    }
    const nodes = [];
    const visit = (task, depth) => {
      const children = (byParent.get(task.id) || []).sort((left, right) => (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0));
      nodes.push(taskTreeNode(task, depth, children));
      children.forEach((child) => visit(child, depth + 1));
    };
    visit(root, 0);
    return {
      ok: true,
      rootTaskId: rootId,
      tree: {
        nodes,
        totals: {
          tasks: nodes.length,
          completed: nodes.filter((node) => node.status === 'completed').length,
          active: nodes.filter((node) => ACTIVE_STATUSES.has(node.status)).length,
          failed: nodes.filter((node) => node.status === 'failed' || node.status === 'stopped').length,
          blocked: nodes.filter((node) => node.blocked || node.compensation.blocked || node.compensation.failed).length,
        },
        generatedAt: Date.now(),
      },
      integrity: snapshot.integrity,
    };
  }

  async function recoveryPlan(taskId) {
    const projection = await tree(taskId);
    const nodes = projection.tree.nodes;
    const root = nodes[0];
    const blockers = nodes.filter((node) => node.status === 'awaiting_user' || node.blocked || node.compensation.blocked || node.compensation.failed)
      .map((node) => ({ taskId: node.id, title: node.title, depth: node.depth, status: node.status, reason: node.blocked || (node.compensation.failed ? '补偿执行失败' : node.compensation.blocked ? '补偿尚未可执行' : '等待用户操作'), nextAction: node.nextAction }));
    const compensationOrder = nodes.filter((node) => node.compensation.blocked || node.compensation.failed)
      .sort((left, right) => right.depth - left.depth || String(left.id).localeCompare(String(right.id)))
      .map((node) => ({ taskId: node.id, title: node.title, depth: node.depth, action: 'resolve_compensation', reason: node.compensation.failed ? '存在失败的补偿步骤' : '存在受阻的补偿步骤' }));
    // Clicking "resume" is an explicit acknowledgement that the user has
    // handled the previously requested input. Paused/awaiting descendants are
    // therefore work to resume, not a reason to reject the parent's control
    // command before the native adapter can cascade it to those descendants.
    // Compensation failures remain a hard safety gate.
    const resumable = ['queued', 'paused', 'failed', 'awaiting_user'].includes(root.status)
      && compensationOrder.length === 0;
    const resumeOrder = resumable
      ? nodes
        .filter((node) => node.id === root.id || ['queued', 'paused', 'failed', 'awaiting_user'].includes(node.status))
        .sort((left, right) => right.depth - left.depth || String(left.id).localeCompare(String(right.id)))
        .map((node) => ({
          taskId: node.id,
          action: node.id === root.id ? 'resume_root' : 'resume_descendant',
          reason: node.id === root.id ? '所有可恢复子任务已先入队，恢复根任务' : '先恢复被父任务依赖的子任务',
        }))
      : [];
    return {
      ok: true,
      taskId: root.id,
      plan: {
        rootTaskId: root.id,
        rootStatus: root.status,
        ready: resumable,
        resumeOrder,
        blockers,
        compensationOrder,
        nextAction: resumable
          ? '可以继续。系统会先恢复可恢复的子任务，再恢复根任务，并从已持久化的未完成步骤继续。'
          : compensationOrder.length
            ? '先按补偿顺序解决最深层的受阻或失败补偿，再重新计算恢复计划。'
            : blockers.length
              ? '先完成列出的授权、配置或业务选择，再重新计算恢复计划。'
              : `根任务当前为 ${root.status}，不需要恢复操作。`,
        generatedAt: Date.now(),
      },
      integrity: projection.integrity,
    };
  }

  async function heartbeat(taskId, input = {}) {
    const observedAt = Number(input.observedAt) || Date.now();
    const progressAt = Number(input.progressAt) || undefined;
    return update(taskId, (task) => {
      task.heartbeat = {
        state: text(input.state, 80) || 'running',
        detail: text(input.detail, 800) || undefined,
        activity: text(input.activity, 500) || task.heartbeat?.activity || undefined,
        workspaceId: text(input.workspaceId, 800) || undefined,
        observedAt,
        progressAt: progressAt ? Math.max(Number(task.heartbeat?.progressAt) || 0, progressAt) : task.heartbeat?.progressAt,
        leaseExpiresAt: observedAt + 90000,
      };
      if (task.status === 'queued') task.status = 'running';
      appendServiceEvent(task, 'heartbeat', `Execution heartbeat: ${task.heartbeat.state}`, { observedAt, state: task.heartbeat.state });
    }, 'Record task execution heartbeat');
  }

  async function recordCheckpoint(taskId, input = {}) {
    const checkpoint = {
      id: text(input.id, 180) || id('checkpoint'),
      kind: text(input.kind, 80) || 'workspace',
      label: text(input.label, 500) || '任务检查点',
      head: text(input.head, 240) || undefined,
      patchSha256: text(input.patchSha256, 160) || undefined,
      workspaceId: text(input.workspaceId, 800) || undefined,
      createdAt: Date.now(),
    };
    return update(taskId, (task) => {
      task.checkpoints = Array.isArray(task.checkpoints) ? task.checkpoints : [];
      task.checkpoints.push(checkpoint);
      if (task.workspace) task.workspace = { ...task.workspace, status: 'ready', workspaceId: checkpoint.workspaceId, lastCheckpointId: checkpoint.id };
      appendServiceEvent(task, 'checkpoint_created', `保存检查点：${checkpoint.label}`, { checkpointId: checkpoint.id });
    }, '记录代码工作树检查点');
  }

  async function recordVerification(taskId, input = {}) {
    const verification = {
      id: text(input.id, 180) || id('verification'),
      kind: text(input.kind, 100) || 'command',
      label: text(input.label, 500),
      status: input.status === 'passed' ? 'passed' : input.status === 'blocked' ? 'blocked' : 'failed',
      command: text(input.command, 1200) || undefined,
      detail: text(input.detail, 1600),
      exitCode: Number.isInteger(input.exitCode) ? input.exitCode : undefined,
      createdAt: Date.now(),
    };
    if (!verification.label) throw new Error('TaskService: verification label is required');
    return update(taskId, (task) => {
      task.verifications = Array.isArray(task.verifications) ? task.verifications : [];
      task.verifications.push(verification);
      appendServiceEvent(task, 'verification_recorded', `${verification.label}: ${verification.status}`, { verificationId: verification.id });
    }, '记录任务验证结果');
  }

  async function validateCompletion(taskId) {
    const snapshot = await store.read({ taskId });
    if (!snapshot.ok || !snapshot.runs?.[0]) throw new Error(snapshot.error || `找不到任务：${taskId}`);
    const task = snapshot.runs[0];
    const checks = [
      { id: 'steps', label: '所有正常步骤已完成', passed: (task.steps || []).some((step) => step.compensationOnly !== true) && task.steps.filter((step) => step.compensationOnly !== true).every((step) => step.status === 'completed') },
      { id: 'approval', label: '没有待处理授权', passed: !(task.approvals || []).some((item) => item.status === 'pending') },
    ];
    if (task.workspace?.mode === 'git-worktree') {
      checks.push({ id: 'checkpoint', label: '存在工作树检查点', passed: task.workspace.status === 'ready' && (task.checkpoints || []).length > 0 });
      checks.push({ id: 'verification', label: '至少一个验证通过', passed: (task.verifications || []).some((item) => item.status === 'passed') });
    }
    return { ok: true, taskId, passed: checks.every((item) => item.passed), checks, status: task.status, integrity: snapshot.integrity };
  }

  async function setStatus(taskId, status, detail) {
    if (!ACTIVE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status)) throw new Error(`TaskService: invalid status ${status}`);
    return update(taskId, (task) => {
      task.status = status;
      task.phase = status === 'completed' ? 'completed'
        : status === 'failed' || status === 'stopped' || status === 'paused' ? 'blocked'
          : status === 'awaiting_user' ? 'awaiting_user'
            : status === 'running' ? 'executing' : task.phase || 'preflight';
      if (status !== 'awaiting_user') task.waitingFor = undefined;
      appendServiceEvent(task, `status_${status}`, detail || `任务状态变为 ${status}`);
    }, '更新任务状态');
  }

  return { version: TASK_SERVICE_VERSION, read, create, update, recordToolAttempt, addArtifact, addReference, createChild, repairDelegationCollisions, context, recordLifecycle, readySteps, completeStep, recordReviewDecision, failStep, requestApproval, decideApproval, recordUsage, metrics, tree, recoveryPlan, heartbeat, recordCheckpoint, recordVerification, validateCompletion, setStatus };
}

module.exports = { TASK_SERVICE_VERSION, createTaskService };
