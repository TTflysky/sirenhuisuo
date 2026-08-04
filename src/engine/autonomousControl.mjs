import {
  assessAdaptiveBudget,
  readyAdaptiveNodes,
  restoreAdaptivePlanGraph,
} from './adaptivePlanGraph.mjs';
import { selectAutonomousDecision } from './autonomousDecisionAuthority.mjs';

const CONTROL_VERSION = 2;
const GOAL_VERSION = 1;
const SITUATION_VERSION = 1;
const DECISION_VERSION = 1;
const MAX_FACTS = 24;
const MAX_DECISIONS = 24;
const MAX_ROUTE_HISTORY = 16;

function text(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 16, itemMax = 800) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, itemMax)).filter(Boolean))].slice(-max)
    : [];
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function recordId(prefix, ...parts) {
  const source = parts.map((part) => text(part, 300)).filter(Boolean).join('|') || 'unknown';
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}

function equal(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function withoutUpdatedAt(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = clone(value);
  delete copy.updatedAt;
  return copy;
}

function goalStatus(run) {
  if (run?.status === 'completed') return 'completed';
  if (run?.status === 'stopped') return 'stopped';
  if (run?.status === 'failed') return 'blocked';
  return 'active';
}

export function createGoalState(input = {}) {
  const now = Number(input.createdAt) || Date.now();
  const taskId = text(input.taskId || input.id, 180) || `task-${now}`;
  const originalGoal = text(input.originalGoal || input.currentGoal || input.goal || input.request, 2400);
  const projectId = text(input.projectId, 180) || `project-${taskId}`;
  const conversationId = text(input.conversationId, 180) || `legacy:${taskId}`;
  return {
    goalVersion: GOAL_VERSION,
    goalId: text(input.goalId, 180) || `goal-${taskId}`,
    projectId,
    conversationId,
    originalGoal,
    currentGoal: text(input.currentGoal || originalGoal, 2400),
    successCriteria: list(input.successCriteria || input.acceptanceCriteria, 16),
    constraints: list(input.constraints, 20),
    prohibitions: list(input.prohibitions, 16),
    scopeChanges: Array.isArray(input.scopeChanges) ? clone(input.scopeChanges).slice(-30) : [],
    userDecisions: Array.isArray(input.userDecisions) ? clone(input.userDecisions).slice(-30) : [],
    appliedSteeringEventIds: list(input.appliedSteeringEventIds, 60, 180),
    status: ['active', 'blocked', 'completed', 'stopped'].includes(input.status) ? input.status : 'active',
    createdAt: now,
    updatedAt: Number(input.updatedAt) || now,
  };
}

export function restoreGoalState(snapshot, fallback = {}) {
  const base = createGoalState(fallback);
  if (!snapshot || typeof snapshot !== 'object') return base;
  return createGoalState({
    ...base,
    ...clone(snapshot),
    goalId: snapshot.goalId || base.goalId,
    projectId: snapshot.projectId || base.projectId,
    conversationId: snapshot.conversationId || base.conversationId,
    originalGoal: snapshot.originalGoal || base.originalGoal,
    currentGoal: snapshot.currentGoal || base.currentGoal,
    successCriteria: snapshot.successCriteria?.length ? snapshot.successCriteria : base.successCriteria,
    createdAt: Number(snapshot.createdAt) || base.createdAt,
    updatedAt: Number(snapshot.updatedAt) || base.updatedAt,
  });
}

export function applyGoalSteering(snapshot, steering = {}) {
  const state = restoreGoalState(snapshot);
  const instruction = text(steering.instruction || steering.summary, 2400);
  if (!instruction) return state;
  const at = Number(steering.at) || Date.now();
  const relation = ['new_goal', 'correction', 'constraint', 'prohibition', 'decision', 'control', 'question'].includes(steering.relation)
    ? steering.relation
    : 'decision';
  if (relation === 'new_goal') {
    return createGoalState({
      ...state,
      goalId: text(steering.goalId, 180) || recordId('goal', state.goalId, instruction, at),
      originalGoal: instruction,
      currentGoal: instruction,
      successCriteria: list(steering.successCriteria, 16),
      constraints: [],
      prohibitions: [],
      scopeChanges: [],
      userDecisions: [{ id: recordId('user-decision', instruction, at), relation, instruction, at }],
      appliedSteeringEventIds: [],
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });
  }
  if (relation === 'correction') {
    state.scopeChanges.push({ id: recordId('scope-change', instruction, at), relation, instruction, previousGoal: state.currentGoal, at });
    state.currentGoal = text(steering.replacementGoal, 2400)
      || text(`${state.currentGoal}\nUser correction: ${instruction}`, 2400);
  } else if (relation === 'constraint') {
    state.constraints = list([...state.constraints, instruction], 20);
  } else if (relation === 'prohibition') {
    state.prohibitions = list([...state.prohibitions, instruction], 16);
  } else if (relation !== 'question') {
    state.userDecisions.push({ id: recordId('user-decision', instruction, at), relation, instruction, at });
  }
  state.scopeChanges = state.scopeChanges.slice(-30);
  state.userDecisions = state.userDecisions.slice(-30);
  state.updatedAt = at;
  return state;
}

function fact(statement, source, sourceId, at, verified = true) {
  const clean = text(statement, 900);
  return clean ? { id: recordId(verified ? 'fact' : 'assumption', source, sourceId, clean), statement: clean, source, sourceId: text(sourceId, 180) || undefined, at: Number(at) || 0, verified } : undefined;
}

function uniqueRecords(records, max = MAX_FACTS) {
  const seen = new Set();
  return records.filter(Boolean).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(-max);
}

function artifactRecords(run) {
  const records = [];
  for (const item of run?.artifacts ?? []) {
    const artifactPath = text(item?.path || item?.diskPath || item?.name, 1000);
    if (artifactPath) records.push({
      id: recordId('artifact', item?.id, artifactPath),
      path: artifactPath,
      source: 'task_artifact',
      at: Number(item?.createdAt) || 0,
      verified: item?.verified === true,
    });
  }
  for (const item of run?.evidence ?? []) {
    const artifactPath = text(item?.artifact?.path || item?.artifact?.diskPath, 1000);
    if (artifactPath) records.push({ id: recordId('artifact', artifactPath), path: artifactPath, source: 'task_evidence', at: Number(item.ts) || 0, verified: item.verified === true });
  }
  for (const artifactPath of run?.context?.summary?.artifactPaths ?? []) {
    const clean = text(artifactPath, 1000);
    if (clean) records.push({ id: recordId('artifact', clean), path: clean, source: 'task_context', at: Number(run.context?.updatedAt) || 0, verified: true });
  }
  return uniqueRecords(records, 30);
}

function routeRecords(run) {
  const controllerRoutes = run?.executionState?.routeHistory ?? run?.recoveryContext?.controller?.routeHistory ?? [];
  return controllerRoutes.slice(-MAX_ROUTE_HISTORY).map((route) => ({
    routeId: text(route.id, 180),
    toolName: text(route.toolName, 160),
    strategy: text(route.strategySignature, 300),
    attempts: Math.max(0, Number(route.attempts) || 0),
    failures: Math.max(0, Number(route.failures) || 0),
    successes: Math.max(0, Number(route.successes) || 0),
    lastOutcome: text(route.lastOutcome, 500),
    updatedAt: Number(route.updatedAt) || 0,
  }));
}

export function deriveSituationModel(run = {}, goalSnapshot) {
  const goal = restoreGoalState(goalSnapshot, run);
  const confirmedFacts = [];
  const assumptions = [];
  for (const item of run.evidence ?? []) {
    const entry = fact(item.summary, 'task_evidence', item.id || `${item.ts || 0}`, item.ts, item.verified === true);
    if (item.verified === true) confirmedFacts.push(entry);
    else assumptions.push(entry);
  }
  for (const item of run.turnRuntime?.evidence ?? []) {
    const entry = fact(
      `${item.toolName || 'tool'}: ${item.summary || (item.success ? 'succeeded' : 'failed')}`,
      'turn_runtime',
      item.evidenceId || item.toolCallId,
      item.createdAt,
      item.success === true && item.useful !== false,
    );
    if (item.success === true && item.useful !== false) confirmedFacts.push(entry);
    else assumptions.push(entry);
  }
  for (const item of run.toolAttempts ?? []) {
    if (item.status !== 'succeeded') continue;
    confirmedFacts.push(fact(
      `${item.toolName}: ${item.outputSummary || 'succeeded'}`,
      'tool_attempt',
      item.id,
      item.finishedAt || item.startedAt,
      true,
    ));
  }
  for (const item of run.verification ?? []) {
    if (item.status === 'passed') confirmedFacts.push(fact(`${item.label}: ${item.detail}`, 'verification', item.label, 0, true));
  }
  for (const step of run.steps ?? []) {
    if (step.status === 'completed') confirmedFacts.push(fact(`Completed step: ${step.title}`, 'task_step', step.id, step.completedAt, true));
    for (const item of step.evidence ?? []) {
      const entry = fact(item.summary, 'step_evidence', `${step.id}:${item.id || item.ts || 0}`, item.ts, item.verified === true);
      if (item.verified === true) confirmedFacts.push(entry);
      else assumptions.push(entry);
    }
  }
  const blockers = [
    ...(run.context?.openIssues ?? []),
    ...(run.recoveryContext?.unresolvedIssues ?? []),
    ...(run.turnRuntime?.unresolvedIssues ?? []),
    ...(run.preflight ?? []).filter((item) => item.status === 'blocked').map((item) => `${item.label}: ${item.detail || 'blocked'}`),
    ...(run.verification ?? []).filter((item) => item.status === 'blocked').map((item) => `${item.label}: ${item.detail}`),
    ...(run.lastError ? [run.lastError] : []),
  ];
  const failures = (run.steps ?? []).filter((step) => step.status === 'failed').map((step) => ({
    id: recordId('failure', step.id, step.lastError),
    stepId: step.id,
    summary: text(step.lastError || `${step.title} failed`, 900),
    at: Number(step.completedAt || step.events?.at(-1)?.ts) || 0,
  }));
  if (run.lastError && failures.every((item) => item.summary !== run.lastError)) {
    failures.push({ id: recordId('failure', run.id, run.lastError), summary: text(run.lastError, 900), at: 0 });
  }
  const steeringEvents = (run.context?.events ?? []).filter((event) => event.source === 'user' || event.type === 'steering');
  const userSteering = [
    ...steeringEvents.map((event) => ({ id: event.id || recordId('steering', event.summary, event.ts), summary: text(event.summary, 900), at: Number(event.ts) || 0 })),
    ...(run.recoveryContext?.steeringMessages ?? []).map((summary, index) => ({ id: recordId('steering', index, summary), summary: text(summary, 900), at: 0 })),
  ].filter((item) => item.summary).slice(-20);
  const availableCapabilities = list([
    ...(run.memberSnapshot ?? []).flatMap((member) => member.capabilities ?? []),
    ...(run.skillRefs ?? []).flatMap((skill) => [skill.id, skill.name]),
  ], 60, 180);
  const activeIds = new Set((run.steps ?? []).filter((step) => step.status === 'running').map((step) => step.employeeId));
  const activeMembers = (run.memberSnapshot ?? []).filter((member) => activeIds.has(member.id)).map((member) => ({ id: member.id, name: member.name, title: member.title }));
  return {
    situationVersion: SITUATION_VERSION,
    goalId: goal.goalId,
    confirmedFacts: uniqueRecords(confirmedFacts),
    assumptions: uniqueRecords(assumptions, 16),
    openQuestions: list(run.context?.openIssues, 16),
    availableCapabilities,
    activeMembers,
    artifacts: artifactRecords(run),
    evidence: uniqueRecords(confirmedFacts),
    failures: failures.slice(-16),
    blockedBy: list(blockers, 16),
    userSteering,
    routeHistory: routeRecords(run),
    updatedAt: Number(run.updatedAt) || Date.now(),
  };
}

function nextReadyStep(run) {
  const completed = new Set((run.steps ?? []).filter((step) => step.status === 'completed').map((step) => step.id));
  return (run.steps ?? []).filter((step) => step.status === 'queued' && (step.dependsOnStepIds ?? []).every((id) => completed.has(id))).sort((a, b) => a.order - b.order)[0];
}

function recommendAction(run, situation, adaptivePlanGraph, budgetAssessment) {
  const repeatedRoute = situation.routeHistory.find((route) => route.failures >= 2 && route.successes === 0);
  if (run.status === 'completed') return { kind: 'verify_completion', summary: 'Verify that every success criterion has evidence before closing the goal.' };
  if (run.status === 'awaiting_user') return { kind: 'await_user', summary: situation.blockedBy.at(-1) || 'Wait only for the specific user input required to proceed.' };
  if (run.status === 'paused' || run.status === 'stopped') return { kind: 'hold', summary: 'Keep the execution site intact until the user explicitly continues.' };
  if (repeatedRoute) return { kind: 'switch_route', routeId: repeatedRoute.routeId, summary: `Stop repeating route ${repeatedRoute.toolName || repeatedRoute.routeId}; select a materially different route.` };
  if (budgetAssessment.action === 'stop') return { kind: 'stop_safely', summary: budgetAssessment.reason };
  if (budgetAssessment.action === 'await_user') return { kind: 'await_user', summary: budgetAssessment.reason };
  if (budgetAssessment.action === 'checkpoint') return { kind: 'checkpoint', summary: budgetAssessment.reason };
  if (budgetAssessment.action === 'compact') return { kind: 'compact_context', summary: budgetAssessment.reason };
  if (budgetAssessment.action === 'replan') return { kind: 'replan', summary: budgetAssessment.reason };
  if (run.status === 'failed') return { kind: 'reflect', summary: 'Classify the failure, preserve valid evidence, and replan only the affected work.' };
  const running = adaptivePlanGraph.nodes.find((step) => step.status === 'running');
  if (running) return { kind: 'continue_step', stepId: running.id, summary: `Continue ${running.title} and collect its required evidence.` };
  const ready = readyAdaptiveNodes(adaptivePlanGraph)[0] || nextReadyStep(run);
  if (ready) return { kind: 'start_step', stepId: ready.id, summary: `Start ${ready.title}; its dependencies are satisfied.` };
  if (!adaptivePlanGraph.nodes.length) return { kind: 'propose_plan', summary: 'Build a revisable plan from the current goal and verified situation.' };
  if (situation.blockedBy.length) return { kind: 'resolve_blocker', summary: situation.blockedBy.at(-1) };
  return { kind: 'observe', summary: 'Refresh the situation before selecting another action.' };
}

function decisionPhase(action) {
  if (action.kind === 'verify_completion') return 'verify';
  if (action.kind === 'reflect' || action.kind === 'switch_route') return 'reflect';
  if (action.kind === 'await_user' || action.kind === 'hold') return 'validate';
  if (action.kind === 'propose_plan' || action.kind === 'observe') return 'propose';
  return 'act';
}

export function createDecisionRecord(input = {}) {
  const at = Number(input.at) || Date.now();
  const cycle = Math.max(1, Number(input.cycle) || 1);
  const selectedAction = clone(input.selectedAction ?? { kind: 'observe', summary: 'Observe the current situation.' });
  const goalId = text(input.goalId, 180);
  return {
    decisionVersion: DECISION_VERSION,
    decisionId: text(input.decisionId, 180) || recordId('decision', goalId, cycle, selectedAction.kind, selectedAction.stepId, selectedAction.routeId),
    goalId,
    cycle,
    phase: input.phase || decisionPhase(selectedAction),
    observedFacts: list(input.observedFacts, 8, 900),
    selectedAction,
    publicRationale: text(input.publicRationale, 1200),
    expectedEvidence: list(input.expectedEvidence, 12, 600),
    riskLevel: ['low', 'medium', 'high'].includes(input.riskLevel) ? input.riskLevel : 'low',
    approvalRequirement: input.approvalRequirement === true ? 'required' : 'none',
    result: text(input.result, 600) || 'pending',
    nextDecision: text(input.nextDecision, 800),
    createdAt: at,
  };
}

export function buildPublicDecisionSummary(goal, situation, decision, adaptivePlanGraph, budgetAssessment) {
  const latestRevision = adaptivePlanGraph?.revisionHistory?.at(-1);
  const attemptedRoutes = situation.routeHistory.slice(-4).map((route) => `${route.toolName || route.routeId}: ${route.lastOutcome || `${route.attempts} attempt(s)`}`);
  return {
    currentGoal: goal.currentGoal,
    confirmedFacts: situation.confirmedFacts.slice(-5).map((item) => item.statement),
    currentGap: situation.blockedBy.at(-1) || situation.openQuestions.at(-1) || '',
    attemptedRoutes,
    nextAction: decision.selectedAction.summary,
    rationale: decision.publicRationale,
    resources: situation.activeMembers.map((member) => `${member.name} (${member.title})`),
    expectedEvidence: decision.expectedEvidence,
    needsUser: decision.selectedAction.kind === 'await_user',
    planRevision: adaptivePlanGraph?.revision || 1,
    planChange: latestRevision?.revision > 1 ? latestRevision.reason : '',
    affectedNodes: latestRevision?.revision > 1 ? latestRevision.affectedNodeIds || [] : [],
    preservedCompletedNodes: latestRevision?.revision > 1 ? latestRevision.preservedCompletedNodeIds || [] : [],
    budgetAction: budgetAssessment?.action || 'continue',
    budgetReason: budgetAssessment?.reason || '',
  };
}

export function reconcileAutonomousControl(run, options = {}) {
  if (!run || typeof run !== 'object') return run;
  const now = Number(options.now) || Date.now();
  const previousGoal = run.goalState;
  let baseGoal = restoreGoalState(previousGoal, {
    taskId: run.id,
    projectId: run.projectId,
    conversationId: run.conversationId,
    goal: run.goal || run.request,
    acceptanceCriteria: run.acceptanceCriteria,
    createdAt: run.createdAt,
  });
  const appliedSteering = new Set(baseGoal.appliedSteeringEventIds ?? []);
  for (const event of run.context?.events ?? []) {
    const steeringId = text(event.id, 180) || recordId('steering-event', event.ts, event.type, event.summary);
    if (event.source !== 'user' || appliedSteering.has(steeringId)) continue;
    const action = text(event.data?.action, 80);
    if (action === 'queue_separately' || action === 'reply_then_continue' || event.type === 'question') {
      appliedSteering.add(steeringId);
      continue;
    }
    const relation = event.type === 'correction' ? 'correction' : event.type === 'control' ? 'control' : 'constraint';
    baseGoal = applyGoalSteering(baseGoal, { relation, instruction: event.summary, at: event.ts });
    appliedSteering.add(steeringId);
  }
  baseGoal.appliedSteeringEventIds = [...appliedSteering].slice(-60);
  const goalCandidate = {
    ...baseGoal,
    projectId: baseGoal.projectId || run.projectId || `project-${run.id}`,
    conversationId: baseGoal.conversationId || run.conversationId || `legacy:${run.id}`,
    successCriteria: list(run.acceptanceCriteria?.length ? run.acceptanceCriteria : baseGoal.successCriteria, 16),
    constraints: list([...(baseGoal.constraints ?? []), ...(run.contract?.constraints?.required ?? [])], 20),
    status: goalStatus(run),
  };
  const goalChanged = !previousGoal || !equal(withoutUpdatedAt(previousGoal), withoutUpdatedAt(goalCandidate));
  const goal = { ...goalCandidate, updatedAt: goalChanged ? now : Number(previousGoal.updatedAt) || now };
  const situationCandidate = deriveSituationModel({ ...run, projectId: goal.projectId }, goal);
  const situationChanged = !run.situationModel || !equal(withoutUpdatedAt(run.situationModel), withoutUpdatedAt(situationCandidate));
  const situation = { ...situationCandidate, updatedAt: situationChanged ? now : Number(run.situationModel.updatedAt) || now };
  const adaptivePlanCandidate = restoreAdaptivePlanGraph(run.adaptivePlanGraph, { run, goalId: goal.goalId, projectId: goal.projectId, now });
  const adaptivePlanChanged = !run.adaptivePlanGraph || !equal(withoutUpdatedAt(run.adaptivePlanGraph), withoutUpdatedAt(adaptivePlanCandidate));
  const adaptivePlanGraph = { ...adaptivePlanCandidate, updatedAt: adaptivePlanChanged ? now : Number(run.adaptivePlanGraph?.updatedAt) || now };
  const routeRepeated = situation.routeHistory.some((route) => route.failures >= 2 && route.successes === 0);
  const contextWindowTokens = Number(run.recoveryContext?.budget?.contextWindowTokens) || 0;
  const estimatedTokens = Number(run.recoveryContext?.budget?.estimatedTokens || run.usage?.estimatedTokens) || 0;
  const budgetAssessment = assessAdaptiveBudget({
    usage: run.usage,
    elapsedMs: run.startedAt ? Math.max(0, now - Number(run.startedAt)) : 0,
    contextRatio: contextWindowTokens > 0 ? estimatedTokens / contextWindowTokens : 0,
    noProgressRounds: run.recoveryContext?.budget?.noProgressRounds,
    repeatedRouteDetected: routeRepeated,
    needsApproval: run.pendingApproval?.status === 'pending',
  });
  const fallbackAction = recommendAction(run, situation, adaptivePlanGraph, budgetAssessment);
  const previousControl = run.autonomousControl;
  const previousDecision = previousControl?.currentDecision;
  const authoritySelection = selectAutonomousDecision(
    { ...run, goalState: goal, situationModel: situation, adaptivePlanGraph },
    fallbackAction,
    run.autonomousDecisionProposal,
    { consumedProposalId: previousControl?.decisionAuthority?.proposalId },
  );
  const action = authoritySelection.action;
  const decisionBasis = {
    goalId: goal.goalId,
    action,
    authority: authoritySelection.authority,
    factIds: situation.confirmedFacts.map((item) => item.id),
    blockers: situation.blockedBy,
    failures: situation.failures.map((item) => item.id),
    status: run.status,
    planRevision: adaptivePlanGraph.revision,
    budgetAction: budgetAssessment.action,
  };
  const decisionChanged = !previousDecision || !equal(previousControl?.decisionBasis, decisionBasis);
  const cycle = decisionChanged ? Math.max(0, Number(previousDecision?.cycle) || 0) + 1 : Number(previousDecision.cycle) || 1;
  const decision = decisionChanged ? createDecisionRecord({
    goalId: goal.goalId,
    cycle,
    selectedAction: action,
    observedFacts: situation.confirmedFacts.slice(-8).map((item) => item.statement),
    publicRationale: authoritySelection.proposal?.publicRationale || (routeRepeated
      ? 'The same failed route has reached the repeat limit, so continuing it would waste resources.'
      : situation.blockedBy.length
        ? 'The recommendation follows the current blocker and preserves completed evidence.'
        : 'The recommendation follows the current goal, verified facts, and satisfied dependencies.'),
    expectedEvidence: authoritySelection.proposal?.expectedEvidence?.length ? authoritySelection.proposal.expectedEvidence : goal.successCriteria,
    approvalRequirement: Boolean(run.pendingApproval?.status === 'pending'),
    result: run.status,
    nextDecision: 'Re-evaluate after new evidence, a failure, review feedback, or user steering.',
    at: now,
  }) : clone(previousDecision);
  const decisionHistory = decisionChanged
    ? [...(previousControl?.decisionHistory ?? []), decision].slice(-MAX_DECISIONS)
    : clone(previousControl?.decisionHistory ?? [decision]);
  const publicSummary = buildPublicDecisionSummary(goal, situation, decision, adaptivePlanGraph, budgetAssessment);
  const controlCandidate = {
    controlVersion: CONTROL_VERSION,
    mode: 'adaptive',
    protocol: 'observe-interpret-propose-validate-act-verify-reflect',
    loopPhase: decision.phase,
    planRevision: adaptivePlanGraph.revision,
    currentDecision: decision,
    decisionHistory,
    decisionBasis,
    decisionAuthority: authoritySelection.authority,
    routeHistory: situation.routeHistory,
    repeatedRouteDetected: routeRepeated,
    shouldAwaitUser: action.kind === 'await_user',
    budgetAssessment,
    publicSummary,
    updatedAt: now,
  };
  const controlChanged = !previousControl || !equal(withoutUpdatedAt(previousControl), withoutUpdatedAt(controlCandidate));
  const control = { ...controlCandidate, updatedAt: controlChanged ? now : Number(previousControl.updatedAt) || now };
  const projectIdChanged = run.projectId !== goal.projectId;
  if (!goalChanged && !situationChanged && !adaptivePlanChanged && !controlChanged && !projectIdChanged) return run;
  return { ...run, projectId: goal.projectId, goalState: goal, situationModel: situation, adaptivePlanGraph, autonomousControl: control };
}

export const AUTONOMOUS_CONTROL_VERSION = CONTROL_VERSION;
export const AUTONOMOUS_GOAL_VERSION = GOAL_VERSION;
export const AUTONOMOUS_SITUATION_VERSION = SITUATION_VERSION;
export const AUTONOMOUS_DECISION_VERSION = DECISION_VERSION;
