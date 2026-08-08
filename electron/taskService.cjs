const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTaskServiceQueries } = require('./taskServiceQueries.cjs');
const { createTaskServiceContextQueries } = require('./taskServiceContextQueries.cjs');
const { createTaskServiceEvidenceCommands } = require('./taskServiceEvidenceCommands.cjs');
const { createTaskServiceApprovalCommands } = require('./taskServiceApprovalCommands.cjs');
const { createTaskServiceLifecycleCommands } = require('./taskServiceLifecycleCommands.cjs');
const { createTaskServiceRecoveryCommands } = require('./taskServiceRecoveryCommands.cjs');
const { createTaskServiceTeamExecution } = require('./taskServiceTeamExecution.cjs');

const TASK_SERVICE_VERSION = 5;
const TASK_TYPES = new Set(['assistant', 'dm', 'team', 'child', 'coding']);
const DELIVERABLE_TYPES = new Set(['answer', 'file', 'connection', 'operation', 'decision', 'mixed']);
let adaptivePlanPromise;
let factLedgerPromise;

function loadAdaptivePlan() {
  if (!adaptivePlanPromise) adaptivePlanPromise = import(pathToFileURL(path.join(__dirname, '../src/engine/adaptivePlanGraph.mjs')).href);
  return adaptivePlanPromise;
}

function loadFactLedger() {
  if (!factLedgerPromise) factLedgerPromise = import(pathToFileURL(path.join(__dirname, '../src/engine/factLedger.mjs')).href);
  return factLedgerPromise;
}

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

function normalizeTaskContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output = value.output && typeof value.output === 'object' && !Array.isArray(value.output) ? value.output : {};
  const budget = value.budget && typeof value.budget === 'object' && !Array.isArray(value.budget) ? value.budget : {};
  return {
    contractVersion: Math.max(1, Number(value.contractVersion) || 1),
    inputRefs: list(value.inputRefs, []),
    output: {
      type: text(output.type, 80) || 'answer',
      path: text(output.path, 500) || undefined,
      description: text(output.description, 1000),
    },
    completionConditions: list(value.completionConditions, []),
    verification: list(value.verification, []),
    budget: {
      maxModelRounds: Math.max(1, Number(budget.maxModelRounds) || 8),
      maxToolCalls: Math.max(1, Number(budget.maxToolCalls) || 24),
      maxReworkAttempts: Math.max(0, Number(budget.maxReworkAttempts) || 0),
    },
    escalationConditions: list(value.escalationConditions, []),
  };
}

function normalizeStep(input, index) {
  const stepId = text(input?.stepId || input?.id, 160) || `step-${index + 1}`;
  const status = ['queued', 'running', 'paused', 'stopped', 'failed', 'completed'].includes(input?.status) ? input.status : 'queued';
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
    requiredCapabilities: list(input?.requiredCapabilities, []),
    expectedEvidence: list(input?.expectedEvidence, []),
    outputPath: text(input?.outputPath, 500) || undefined,
    taskContract: normalizeTaskContract(input?.taskContract),
    maxRetries: Number.isInteger(input?.maxRetries) ? Math.max(0, Math.min(10, input.maxRetries)) : undefined,
    deliverableType: normalizeDeliverableType(input?.deliverableType),
    responsibilityTaskId: text(input?.responsibilityTaskId, 180) || undefined,
    executionBinding: input?.executionBinding && typeof input.executionBinding === 'object' ? clone(input.executionBinding) : undefined,
    status,
    attempts: Math.max(0, Number(input?.attempts) || 0),
    startedAt: Number(input?.startedAt) || undefined,
    completedAt: Number(input?.completedAt) || (status === 'completed' ? Date.now() : undefined),
    lastError: text(input?.lastError, 1200) || undefined,
    output: input?.output === undefined ? undefined : clone(input.output),
    evidence: Array.isArray(input?.evidence) ? clone(input.evidence) : [],
    events: Array.isArray(input?.events) && input.events.length
      ? clone(input.events)
      : [{ ts: Date.now(), type: 'status', detail: status === 'completed' ? '任务步骤作为已有成果导入' : '任务步骤已创建，等待执行' }],
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
  const createdAt = Date.now();
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
    requiredCapabilities: list(input.requiredCapabilities || rawTaskDecision?.requiredCapabilities),
    capabilityMatrix: input.capabilityMatrix && typeof input.capabilityMatrix === 'object' ? clone(input.capabilityMatrix) : undefined,
    hostEntrypoint: text(input.hostEntrypoint || (taskType === 'dm' ? 'employee' : taskType === 'team' ? 'team' : taskType === 'child' ? 'worker' : 'assistant'), 40),
    projectBrief: input.projectBrief && typeof input.projectBrief === 'object' ? clone(input.projectBrief) : undefined,
    deliverableType: taskDeliverableType,
    memberSnapshot: Array.isArray(input.memberSnapshot) ? clone(input.memberSnapshot) : undefined,
    steps,
    artifacts: [],
    references: [],
    toolAttempts: [],
    approvals: [],
    workspace: {
      mode: requiresWorktree ? 'git-worktree' : 'task-workspace',
      status: requiresWorktree ? 'pending' : text(input.workspaceId, 800) ? 'ready' : 'not-required',
      requiresEvidence: requiresWorktree,
      workspaceId: text(input.workspaceId, 800) || undefined,
      sourceRepo: text(input.sourceRepo, 1200) || undefined,
    },
    checkpoints: [],
    verifications: [],
    usage: { modelRounds: 0, promptTokens: 0, completionTokens: 0, estimatedTokens: 0, toolCalls: 0 },
    waitingFor: undefined,
    recoveryContext: {
      summary: '任务已创建，等待执行。',
      completedEvidence: [],
      unresolvedIssues: [],
      steeringMessages: [],
      autoResume: false,
      budget: { toolAttempts: 0, updatedAt: createdAt },
    },
    serviceEvents: [{ ts: Date.now(), type: 'task_created', detail: '任务已进入统一任务服务' }],
    createdAt,
    updatedAt: createdAt,
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

function synchronizeTaskFromAdaptiveGraph(task, adaptive) {
  task.steps = adaptive.projectGraphToTaskSteps(task.adaptivePlanGraph, task.steps);
  if (task.plan) {
    const prior = new Map((task.plan.steps || []).map((step) => [step.stepId, step]));
    task.plan.steps = task.adaptivePlanGraph.nodes.filter((node) => node.status !== 'superseded').map((node) => ({
      ...(prior.get(node.id) || {}),
      stepId: node.id,
      type: node.kind === 'review' ? 'review' : node.ownerEmployeeId ? 'tool' : 'composite',
      connector: `task-step:${node.ownerEmployeeId || 'assistant'}`,
      input: { assignment: node.objective, employeeId: node.ownerEmployeeId, taskContract: clone(node.taskContract) },
      expectedOutputSchema: prior.get(node.id)?.expectedOutputSchema || { type: 'object' },
      dependsOn: [...node.dependsOn],
      retryPolicy: clone(node.retryPolicy),
      idempotencyKey: prior.get(node.id)?.idempotencyKey || `task-${task.id}-${node.id}-r${task.adaptivePlanGraph.revision}`,
      sideEffect: node.kind !== 'review',
      compensateStepId: prior.get(node.id)?.compensateStepId || '',
      approvalRequired: node.approvalRequired,
      metadata: {
        ...(prior.get(node.id)?.metadata || {}),
        adaptivePlanRevision: task.adaptivePlanGraph.revision,
        acceptanceCriteria: node.acceptanceCriteria,
        requiredCapabilities: node.requiredCapabilities,
        expectedEvidence: node.expectedEvidence,
        outputPath: node.outputPath,
        taskContract: clone(node.taskContract),
        deliverableType: node.deliverableType,
      },
    }));
  }
  if (task.runner?.plan && task.plan) {
    task.runner.plan = clone(task.plan);
    const records = new Map((task.runner.steps || []).map((step) => [step.stepId, step]));
    task.runner.steps = task.plan.steps.map((step) => records.get(step.stepId) || {
      stepId: step.stepId, status: 'pending', attempts: 0, idempotencyKey: step.idempotencyKey, createdAt: Date.now(), updatedAt: Date.now(),
    });
    if (!['cancelled', 'failed'].includes(task.runner.status)) task.runner.status = 'ready';
  }
  if (task.codingProject?.stages) {
    const graphNodes = new Map(task.adaptivePlanGraph.nodes.map((node) => [node.id, node]));
    for (const stage of task.codingProject.stages) {
      const node = graphNodes.get(stage.id);
      if (!node) continue;
      stage.ownerEmployeeId = node.ownerEmployeeId;
      stage.ownerName = node.ownerName;
      stage.dependsOn = [...node.dependsOn];
      stage.status = node.status === 'superseded' ? 'queued' : node.status;
    }
    task.codingProject.revision = task.adaptivePlanGraph.revision;
  }
  task.planRevision = task.adaptivePlanGraph.revision;
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
      input: { assignment: step.assignment, employeeId: step.employeeId, taskContract: clone(step.taskContract) },
      expectedOutputSchema: { type: 'object' },
      dependsOn: step.dependsOnStepIds,
      retryPolicy: { maxRetries: Number.isInteger(step.maxRetries) ? step.maxRetries : 3, backoffMs: 1000, maxBackoffMs: 30000 },
      idempotencyKey: `task-${task.id}-${step.id}`,
      sideEffect: step.kind !== 'review',
      metadata: {
        taskServiceVersion: TASK_SERVICE_VERSION,
        deliverableType: step.deliverableType || contract.deliverableType,
        codingRole: step.codingRole,
        reviewPoint: step.reviewPoint === true,
        acceptanceCriteria: step.acceptanceCriteria || [],
        requiredCapabilities: step.requiredCapabilities || [],
        expectedEvidence: step.expectedEvidence || [],
        outputPath: step.outputPath,
        taskContract: clone(step.taskContract),
      },
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
  const { metrics, tree, recoveryPlan } = createTaskServiceQueries(store);
  const { context, readySteps, validateCompletion } = createTaskServiceContextQueries(store);

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

  const {
    recordToolAttempt, addArtifact, addReference, recordUsage, recordCheckpoint, recordVerification,
  } = createTaskServiceEvidenceCommands(update);
  const { requestApproval, decideApproval } = createTaskServiceApprovalCommands(update);
  const { recordLifecycle, heartbeat, setStatus } = createTaskServiceLifecycleCommands(update);
  const { recordReviewDecision, failStep, reviseAdaptivePlan, reassignAdaptiveNode } = createTaskServiceRecoveryCommands(update, {
    text, clone, updateStep, appendServiceEvent, loadAdaptivePlan, synchronizeTaskFromAdaptiveGraph, classifyFailure,
  });

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
      steps: input.steps || [{
        id: 'step-1',
        title: input.title || '员工子任务',
        assignment,
        employeeId: input.employeeId,
        acceptanceCriteria: input.acceptanceCriteria,
        requiredCapabilities: input.requiredCapabilities,
        expectedEvidence: input.expectedEvidence,
        outputPath: input.outputPath,
        maxRetries: input.maxRetries,
        taskContract: input.taskContract,
        deliverableType: input.deliverableType,
      }],
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

  const teamExecution = createTaskServiceTeamExecution({
    store,
    create,
    createChild,
    update,
    appendServiceEvent,
    clone,
    text,
    id,
    list,
    inferLegacyDeliverableType,
  });
  const { ensureTeamExecutionBinding, recordExecutionEvent, recordSteering, repairDelegationCollisions } = teamExecution;

  /* team execution binding and steering live in taskServiceTeamExecution.cjs */
  /* keep the public TaskService contract assembled below */
  /* __TEAM_EXECUTION_EXTRACTED__ */
  async function resolveFactConflict(taskId, input = {}) {
    const conflictId = text(input.conflictId, 220);
    const resolution = text(input.resolution, 40);
    if (!conflictId || !resolution) throw new Error('TaskService: conflictId and resolution are required');
    const factLedger = await loadFactLedger();
    await update(taskId, (task) => {
      const current = task.factLedger || task.situationModel?.factLedger;
      if (!current) throw new Error('TaskService: task has no fact ledger');
      const ledger = factLedger.resolveFactConflict(current, conflictId, resolution, {
        resolvedBy: text(input.resolvedBy || 'task-service', 160),
        now: Number(input.now) || Date.now(),
      });
      task.factLedger = ledger;
      task.situationModel = { ...(task.situationModel || {}), factLedger: ledger };
      task.serviceEvents = Array.isArray(task.serviceEvents) ? task.serviceEvents : [];
      appendServiceEvent(task, 'fact_conflict_resolved', `事实冲突已处理：${resolution}`, { conflictId, resolution });
    }, 'TaskService resolved a fact conflict through the unified host');
    const snapshot = await store.read({ taskId });
    return { ok: true, task: snapshot.runs?.[0] };
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

  return { version: TASK_SERVICE_VERSION, read, create, update, recordToolAttempt, addArtifact, addReference, createChild, ensureTeamExecutionBinding, recordExecutionEvent, recordSteering, repairDelegationCollisions, resolveFactConflict, context, recordLifecycle, readySteps, completeStep, recordReviewDecision, failStep, reviseAdaptivePlan, reassignAdaptiveNode, requestApproval, decideApproval, recordUsage, metrics, tree, recoveryPlan, heartbeat, recordCheckpoint, recordVerification, validateCompletion, setStatus };
}

module.exports = { TASK_SERVICE_VERSION, createTaskService };
