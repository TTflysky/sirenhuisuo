import { employeeCapabilityProfile, inferCapabilityIds } from './capabilityGraph.mjs';

export const CODING_PROJECT_VERSION = 1;

const ROLE_SPECS = Object.freeze({
  product: { capability: 'coordination', title: 'Product brief', output: 'scope, user flows, and acceptance criteria' },
  architecture: { capability: 'architecture', title: 'Architecture plan', output: 'technical design and dependency decisions' },
  ux: { capability: 'ui_ux', title: 'UX/UI design', output: 'interaction and visual implementation guidance' },
  frontend: { capability: 'frontend', title: 'Frontend implementation', output: 'implemented client code and component evidence' },
  backend: { capability: 'backend', title: 'Backend implementation', output: 'implemented service, API, or data-layer evidence' },
  test: { capability: 'review', title: 'Test and verification', output: 'test cases, execution result, and defect list' },
  review: { capability: 'review', title: 'Code review and acceptance', output: 'review decision tied to the responsible steps' },
  delivery: { capability: 'coordination', title: 'Delivery handoff', output: 'verified artifact list, diffs, and rollback point' },
});

function text(value, max = 4000) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function codingRequest(value) {
  return /code|coding|software|repository|git|frontend|backend|api|react|vue|electron|html|css|typescript|javascript|python|\u4ee3\u7801|\u7f16\u7a0b|\u5f00\u53d1|\u5b9e\u73b0|\u6784\u5efa|\u4fee\u590d|\u6d4b\u8bd5|\u5ba2\u6237\u7aef|\u7f51\u7ad9|\u7cfb\u7edf/iu.test(value);
}

function needsUi(value, capabilities) {
  return capabilities.includes('ui_ux') || capabilities.includes('frontend')
    || /ui|ux|client|desktop|web|page|interface|\u754c\u9762|\u5ba2\u6237\u7aef|\u7f51\u9875|\u7f51\u7ad9/iu.test(value);
}

function needsBackend(value, capabilities) {
  return capabilities.includes('backend')
    || /backend|server|database|api|service|auth|integration|\u540e\u7aef|\u670d\u52a1\u7aef|\u6570\u636e\u5e93|\u63a5\u53e3|\u63a5\u5165/iu.test(value);
}

function candidateOwners(members, allowedIds, capability) {
  const candidates = members.filter((member) => !allowedIds.size || allowedIds.has(member.id));
  return candidates
    .map((member) => ({ member, profile: employeeCapabilityProfile(member) }))
    .filter(({ profile }) => profile.includes(capability))
    .sort((left, right) => Number(left.member.isWorking === true) - Number(right.member.isWorking === true)
      || String(left.member.name || '').localeCompare(String(right.member.name || ''), 'zh-CN'));
}

function chooseOwner(members, allowedIds, capability) {
  return candidateOwners(members, allowedIds, capability)[0]?.member;
}

function node(id, role, dependencies, owner, input) {
  const spec = ROLE_SPECS[role];
  const review = role === 'review';
  return {
    id,
    role,
    title: spec.title,
    ownerEmployeeId: owner?.id,
    ownerName: owner?.name,
    requiredCapability: spec.capability,
    dependsOn: dependencies,
    kind: review ? 'review' : 'work',
    retryPolicy: { maxRetries: review ? 1 : 2, backoffMs: 1000, maxBackoffMs: 30000 },
    acceptanceCriteria: review
      ? ['review every changed file and test result', 'identify responsible step for each rejection', 'do not accept without diff and verification evidence']
      : [`produce ${spec.output}`, 'record affected files and evidence', 'keep the work within the approved project goal'],
    assignment: `${spec.title}: ${input.goal}. Produce ${spec.output}.`,
    deliverableType: role === 'product' || role === 'architecture' || role === 'ux' || role === 'review' ? 'decision' : role === 'delivery' ? 'mixed' : 'file',
    reviewPoint: review,
  };
}

/**
 * Compiles an approved software ProjectBrief into an explicit, replayable DAG.
 * It deliberately reports staffing gaps instead of silently assigning a random employee.
 */
export function compileCodingProject(input = {}) {
  const goal = text(input.goal || input.request || input.projectBrief?.goal, 6000);
  if (!goal || !codingRequest(goal)) throw new Error('Coding project compilation requires a software implementation goal');
  const members = Array.isArray(input.members) ? input.members.filter((member) => member?.id) : [];
  const allowedIds = new Set(unique(input.memberIds || input.projectBrief?.stages?.flatMap((stage) => stage.memberIds) || []));
  const requiredCapabilities = unique([...inferCapabilityIds(goal, input.requiredCapabilities), 'coordination', 'architecture', 'coding', 'review']);
  const ui = needsUi(goal, requiredCapabilities);
  const backend = needsBackend(goal, requiredCapabilities);
  const stages = [];
  const add = (id, role, dependsOn = []) => stages.push(node(id, role, dependsOn, chooseOwner(members, allowedIds, ROLE_SPECS[role].capability), { goal }));

  add('product-brief', 'product');
  add('architecture', 'architecture', ['product-brief']);
  if (ui) add('ux-ui', 'ux', ['product-brief']);
  if (ui) add('frontend', 'frontend', unique(['architecture', ui ? 'ux-ui' : undefined]));
  if (backend) add('backend', 'backend', ['architecture']);
  const implementation = stages.filter((stage) => ['frontend', 'backend'].includes(stage.role)).map((stage) => stage.id);
  add('verification', 'test', implementation.length ? implementation : ['architecture']);
  add('review', 'review', unique([...implementation, 'verification']));
  add('delivery', 'delivery', ['review']);

  const staffingGaps = stages.filter((stage) => !stage.ownerEmployeeId).map((stage) => ({
    stageId: stage.id, role: stage.role, capability: stage.requiredCapability,
  }));
  return {
    codingProjectVersion: CODING_PROJECT_VERSION,
    projectBriefVersion: Number(input.projectBrief?.version) || undefined,
    goal,
    requiredCapabilities,
    stages,
    staffingGaps,
    status: staffingGaps.length ? 'needs_staffing' : 'ready',
    compiledAt: Date.now(),
  };
}

export function codingProjectToTaskSteps(project) {
  return (project?.stages || []).map((stage) => ({
    id: stage.id,
    title: stage.title,
    assignment: stage.assignment,
    employeeId: stage.ownerEmployeeId,
    dependsOnStepIds: stage.dependsOn,
    kind: stage.kind,
    deliverableType: stage.deliverableType,
    maxRetries: stage.retryPolicy?.maxRetries,
    codingRole: stage.role,
    reviewPoint: stage.reviewPoint === true,
    acceptanceCriteria: stage.acceptanceCriteria,
  }));
}

/** Captures why a running project added a person and what must be rechecked. */
export function addCodingProjectMember(project, input = {}) {
  if (!project?.codingProjectVersion) throw new Error('Coding project is required');
  const employeeId = text(input.employeeId, 160);
  const reason = text(input.reason, 800);
  if (!employeeId || !reason) throw new Error('employeeId and reason are required');
  const affectedStageIds = unique(input.affectedStageIds).filter((id) => project.stages.some((stage) => stage.id === id));
  if (!affectedStageIds.length) throw new Error('at least one existing affectedStageId is required');
  const next = structuredClone(project);
  next.teamChanges = [...(next.teamChanges || []), {
    id: `staffing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    employeeId,
    reason,
    affectedStageIds,
    newAcceptanceCriteria: unique(input.newAcceptanceCriteria),
    createdAt: Date.now(),
  }].slice(-100);
  next.revision = Number(next.revision || 0) + 1;
  return next;
}
