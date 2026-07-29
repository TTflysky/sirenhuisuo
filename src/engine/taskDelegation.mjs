import { capabilityCoverage, capabilityLabel, inferCapabilityIds, selectCapabilityTeam } from './capabilityGraph.mjs';

const DELEGATION_VERSION = 1;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const DELEGATION_TRANSITIONS = {
  queued: new Set(['queued', 'running', 'cancelled']),
  running: new Set(['running', 'completed', 'failed', 'cancelled']),
  completed: new Set(['completed']),
  failed: new Set(['failed', 'queued', 'cancelled']),
  cancelled: new Set(['cancelled']),
};

function text(value, max = 1600) { return String(value ?? '').trim().slice(0, max); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function list(value, max = 12) { return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, max) : []; }
function id(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function selectionReason(member, assignment) {
  const required = inferCapabilityIds(assignment);
  const covered = capabilityCoverage(member, required).covered;
  return covered.length
    ? `能力覆盖：${covered.map(capabilityLabel).join('、')}`
    : '当前团队中可用的协调责任人';
}

export function selectDelegate(members, assignment, options = {}) {
  const candidates = (Array.isArray(members) ? members : []).filter((member) => member && member.id);
  const requested = text(options.employeeId, 160);
  if (requested) return candidates.find((member) => member.id === requested) ?? null;
  const query = `${text(assignment)} ${text(options.title)}`.toLowerCase();
  const requiredCapabilities = inferCapabilityIds(query, options.requiredCapabilities);
  const selection = selectCapabilityTeam(candidates, {
    request: query,
    requiredCapabilities,
    requiresTeam: true,
  });
  const selectedId = selection.selected
    .map((selected, index) => ({
      ...selected,
      index,
      primaryScore: /审查|审核|验收|检查|质检|校对/u.test(query) && selected.capabilities.includes('review') ? 20 : 0,
      coverageScore: capabilityCoverage(candidates.find((member) => member.id === selected.employeeId), requiredCapabilities).covered.length * 10,
    }))
    .sort((left, right) => right.primaryScore - left.primaryScore || right.coverageScore - left.coverageScore || left.index - right.index)[0]?.employeeId;
  return candidates.find((member) => member.id === selectedId) ?? null;
}

export function createDelegation(run, input = {}) {
  if (!run?.id) throw new Error('委派必须属于一个真实任务');
  const assignment = text(input.assignment, 3000);
  if (!assignment) throw new Error('委派说明不能为空');
  const parentStepId = text(input.parentStepId, 160);
  const parent = parentStepId ? (run.steps || []).find((step) => step.id === parentStepId) : undefined;
  if (parentStepId && !parent) throw new Error(`找不到上级步骤：${parentStepId}`);
  const employee = selectDelegate(run.memberSnapshot, assignment, input);
  if (!employee) throw new Error(input.employeeId ? '指定员工不在当前任务成员快照中' : '当前团队没有可接收子任务的成员');
  const now = Date.now();
  const delegationId = id('delegation');
  const delegatedStepId = `subtask-${delegationId}`;
  const title = text(input.title, 240) || `${employee.name} · 子任务`;
  const acceptanceCriteria = list(input.acceptanceCriteria, 8);
  const dependsOn = parent ? [parent.id] : list(input.dependsOnStepIds, 20);
  const knownStepIds = new Set((run.steps || []).map((step) => step.id));
  const unknownDependencies = dependsOn.filter((dependency) => !knownStepIds.has(dependency));
  if (unknownDependencies.length) throw new Error(`委派依赖不存在：${unknownDependencies.join('、')}`);
  const delegation = {
    delegationVersion: DELEGATION_VERSION,
    id: delegationId,
    parentTaskId: run.id,
    parentStepId: parent?.id,
    delegatedStepId,
    employeeId: employee.id,
    employeeName: employee.name,
    title,
    assignment,
    acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : ['完成委派说明', '留下可验证的结果'],
    dependsOnStepIds: dependsOn,
    status: 'queued',
    selectionReason: selectionReason(employee, assignment),
    availability: employee.isOnline === false ? 'offline' : employee.isWorking ? 'busy' : 'available',
    createdAt: now,
    updatedAt: now,
  };
  const step = {
    id: delegatedStepId,
    employeeId: employee.id,
    order: (run.steps?.length || 0) + 1,
    kind: 'work',
    title,
    assignment: `${assignment}\n\n本任务由动态委派创建。验收标准：${delegation.acceptanceCriteria.join('；')}`,
    dependsOnStepIds: dependsOn,
    status: 'queued',
    attempts: 0,
    evidence: [],
    events: [{ ts: now, type: 'status', detail: `动态委派给 ${employee.name}` }],
    delegationId,
  };
  return { delegation, step };
}

export function appendDelegation(run, input = {}) {
  const next = clone(run);
  const { delegation, step } = createDelegation(next, input);
  next.delegations = [...(next.delegations || []), delegation].slice(-100);
  next.steps = [...(next.steps || []), step];
  next.updatedAt = Date.now();
  return { run: next, delegation, step };
}

export function transitionDelegation(run, delegationId, status, input = {}) {
  const next = clone(run);
  const index = (next.delegations || []).findIndex((item) => item.id === delegationId);
  if (index < 0) throw new Error(`找不到委派：${delegationId}`);
  const current = next.delegations[index];
  if (!DELEGATION_TRANSITIONS[current.status]?.has(status)) throw new Error(`非法委派状态迁移：${current.status} -> ${status}`);
  if (TERMINAL.has(current.status) && current.status !== status) throw new Error(`委派已处于终态：${current.status}`);
  const updated = {
    ...current,
    status,
    updatedAt: Date.now(),
    ...(input.output !== undefined ? { output: clone(input.output) } : {}),
    ...(input.error ? { error: text(input.error, 1200) } : {}),
    ...(input.evidence ? { evidence: clone(input.evidence).slice(-30) } : {}),
  };
  if (status === 'completed' || status === 'failed' || status === 'cancelled') updated.completedAt = Date.now();
  next.delegations[index] = updated;
  const step = next.steps?.find((item) => item.delegationId === delegationId);
  if (step) {
    step.status = status === 'completed' ? 'completed' : status === 'running' ? 'running' : status === 'queued' ? 'queued' : 'failed';
    if (input.error) step.lastError = text(input.error, 1200);
  }
  next.updatedAt = Date.now();
  return { run: next, delegation: updated };
}

export function createDelegationRevision(run, delegationId, review = {}) {
  const source = (run?.delegations || []).find((item) => item.id === delegationId);
  if (!source) throw new Error(`找不到委派：${delegationId}`);
  const revisionNo = (run.delegations || []).filter((item) => item.revisionOfDelegationId === delegationId).length + 1;
  const result = appendDelegation(run, {
    parentStepId: review.reviewStepId,
    employeeId: review.responsibleEmployeeId || source.employeeId,
    title: `${source.employeeName} · 子任务修订 ${revisionNo}`,
    assignment: `审查退回原因：${text(review.reason, 1200)}。只修改委派“${source.title}”的责任范围，复用已验证的结果，不得重做无关步骤。`,
    acceptanceCriteria: source.acceptanceCriteria,
  });
  result.delegation.revisionOfDelegationId = delegationId;
  const persisted = result.run.delegations.find((item) => item.id === result.delegation.id);
  if (persisted) persisted.revisionOfDelegationId = delegationId;
  return result;
}

export function delegationSummary(run) {
  const records = Array.isArray(run?.delegations) ? run.delegations : [];
  const counts = Object.fromEntries(['queued', 'running', 'completed', 'failed', 'cancelled'].map((status) => [status, 0]));
  for (const item of records) if (counts[item.status] !== undefined) counts[item.status] += 1;
  return { total: records.length, counts, active: records.filter((item) => ['queued', 'running'].includes(item.status)).map(clone) };
}

export const TASK_DELEGATION_VERSION = DELEGATION_VERSION;
