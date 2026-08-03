const ROLE_DUTY = {
  pm: '你是团队协调者。把目标拆解成可执行、可验收的结果，并按任务合同选择回答、文件、连接、操作或决策证据。',
  planner: '你是规划者和架构师。先读取已有真实证据，再形成与当前交付类型一致的可验收结果。',
  coder: '你是实现工程师。读取上游方案，写入完整可运行代码，并在需要时用命令验证。',
  checker: '你是审查者。必须读取或运行真实产出，然后调用 submit_review 提交 PASS 或 REJECT。',
  custom: '你是团队成员。使用真实工具完成当前责任步骤，并留下可验收结果。',
};

function text(value, limit = 12000) { return String(value ?? '').trim().slice(0, limit); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function toolKey(name, args) { return `${name}:${JSON.stringify(stable(args || {}))}`.toLowerCase(); }
function isWorkspaceMutationTool(name, args) {
  return name === 'write_file'
    || name === 'coding_apply_patch'
    || (name === 'run_command' && args?.verification !== true);
}
function isWorkspaceSnapshotTool(name, args) {
  return ['read_file', 'list_files', 'verify_web_artifact', 'coding_repository_index', 'coding_search', 'coding_dependencies', 'coding_impact', 'coding_select_tests', 'coding_delivery'].includes(name)
    || (name === 'run_command' && args?.verification === true);
}
function toolCacheKey(name, args, mutationEpoch = 0) {
  const base = toolKey(name, args);
  return isWorkspaceSnapshotTool(name, args) ? `${base}@workspace-${Math.max(0, Number(mutationEpoch) || 0)}` : base;
}
function isPreparationTool(name) { return ['inspect_connectors', 'list_files', 'read_file', 'read_skill', 'read_web_page', 'search_skills', 'web_search', 'search_tools', 'describe_tool'].includes(name); }
function isVerifiedArtifact(artifact) {
  return artifact?.verified === true
    && artifact?.persistence === 'disk'
    && Boolean(text(artifact?.diskPath, 1200))
    && Boolean(text(artifact?.path || artifact?.filename, 800));
}

const DELIVERABLE_TYPES = new Set(['answer', 'file', 'connection', 'operation', 'decision', 'mixed']);
function inferStepDeliverableType(step, run) {
  if (step?.kind === 'review') return 'decision';
  const declared = text(step?.deliverableType || step?.metadata?.deliverableType, 40).toLowerCase();
  if (DELIVERABLE_TYPES.has(declared)) return declared;
  const source = `${text(step?.title, 400)} ${text(step?.assignment, 3000)}`;
  if (/(?:文件|文档|代码|网页|页面|html|excel|word|ppt|pdf|脚本|安装包)/iu.test(source)) return 'file';
  if (/(?:连接|接入|连通|知识库|mcp|ima|connector)/iu.test(source)) return 'connection';
  if (/(?:安装|部署|发布|发送|上传|下载|执行|运行)/iu.test(source)) return 'operation';
  if (/(?:方案|设计|分析|建议|判断|评审|审查|调研|规划)/iu.test(source)) return 'decision';
  const contractType = text(run?.contract?.deliverableType || run?.taskDecision?.deliverableType, 40).toLowerCase();
  return DELIVERABLE_TYPES.has(contractType) ? contractType : 'answer';
}

function supportsDynamicDelegation(run) {
  return !run?.codingProject?.codingProjectVersion;
}

function toolAvailableForStep(name, run, step) {
  if (name === 'delegate_subtask' && !supportsDynamicDelegation(run)) return false;
  if (name === 'submit_review' && step?.kind !== 'review') return false;
  return true;
}

function structuredReviewCompletesStep(step, deliverableType, review) {
  if (!review || !['pass', 'reject'].includes(review.decision)) return false;
  return step?.kind === 'review' && (deliverableType === 'decision' || inferStepDeliverableType(step, {}) === 'decision');
}

function substantiveDecisionCompletesStep(step, deliverableType, content) {
  if (step?.kind === 'review' || deliverableType !== 'decision') return false;
  const normalized = text(content, 20000).replace(/\s+/gu, ' ');
  if (normalized.length < 80) return false;
  if (/^(?:收到|明白|好的|已记录|我会|将会|稍后|正在处理|继续处理中)[，。！!\s]/u.test(normalized) && normalized.length < 240) return false;
  return true;
}

function requiresLongModelRequest(step, deliverableType) {
  return deliverableType === 'file'
    || ['frontend', 'backend'].includes(text(step?.codingRole, 40).toLowerCase());
}

function shouldExtendModelRoundBudget(step, deliverableType, callLog) {
  return requiresLongModelRequest(step, deliverableType)
    && (Array.isArray(callLog) ? callLog : []).some((entry) => entry?.success === true && !isPreparationTool(entry?.name));
}

function verifiedFileStepCompletesStep(step, deliverableType, callLog, evidence) {
  if (step?.kind === 'review' || deliverableType !== 'file') return false;
  const hasVerifiedFile = (Array.isArray(evidence) ? evidence : []).some((item) => item?.kind === 'file' && item?.verified === true);
  const hasSuccessfulVerification = (Array.isArray(callLog) ? callLog : []).some((entry) => (
    entry?.success === true && (
      entry?.name === 'verify_web_artifact'
      || (entry?.name === 'run_command' && /"verification"\s*:\s*true/iu.test(String(entry?.args || '')))
    )
  ));
  return hasVerifiedFile && hasSuccessfulVerification;
}

function compensationNeedsApproval(step, job) {
  if (step?.approvalRequired === true || job?.executionPolicy?.compensationApprovalMode === 'ask') return true;
  return /删除|移除|发送|发布|部署|付款|支付|外部系统|delete|remove|send|publish|deploy|payment/iu.test(String(step?.assignment || ''));
}

function summarizeChildTask(child) {
  const completedSteps = (child?.steps || []).filter((step) => step.status === 'completed').map((step) => ({
    id: text(step.id, 160),
    title: text(step.title, 240),
    summary: text(step.output?.summary || step.events?.filter((event) => event.type === 'result').at(-1)?.detail, 1200),
  }));
  const artifacts = (child?.artifacts || []).filter((artifact) => artifact.verified === true).slice(-20).map((artifact) => ({
    name: text(artifact.name || artifact.path, 500),
    path: text(artifact.path || artifact.diskPath, 1600),
    category: text(artifact.category, 80),
    verification: text(artifact.verification, 160),
  }));
  const summary = completedSteps.map((step) => step.summary).filter(Boolean).join('\n')
    || text(child?.executionMessages?.filter((message) => message.kind === 'text').at(-1)?.content, 1200)
    || '子任务已完成，但没有可提取的文本摘要。';
  return {
    childTaskId: text(child?.id, 180),
    title: text(child?.title, 240),
    goal: text(child?.goal || child?.request, 2000),
    status: text(child?.status, 40),
    deliverableType: text(child?.contract?.deliverableType || child?.taskDecision?.deliverableType, 40) || undefined,
    summary: text(summary, 1600),
    completedSteps,
    artifacts,
    completedAt: Number(child?.updatedAt) || Date.now(),
  };
}

function buildChildTaskContext(run) {
  const results = Object.values(run?.childTaskResults || {}).filter((result) => result?.status === 'completed').slice(-12);
  if (!results.length) return '';
  return `\n\n## 已验收的子任务交接\n${results.map((result) => [
    `- 子任务：${result.title || result.childTaskId}`,
    `  目标：${result.goal || '未记录'}`,
    `  结果：${result.summary || '未记录'}`,
    result.artifacts?.length ? `  已验证文件：${result.artifacts.map((artifact) => artifact.path || artifact.name).join('；')}` : '',
  ].filter(Boolean).join('\n')).join('\n')}`;
}

function buildInheritedTaskContext(run) {
  const inherited = run?.inheritedContext;
  if (!inherited || typeof inherited !== 'object') return '';
  const lifecycle = inherited.parentLifecycleRecovery || {};
  const artifacts = (inherited.verifiedArtifacts || []).slice(-12)
    .map((artifact) => artifact.path || artifact.diskPath || artifact.name).filter(Boolean);
  return [
    '\n\n## 父任务可恢复交接',
    `父任务目标：${text(inherited.parentGoal, 2000) || '未记录'}`,
    inherited.acceptanceCriteria?.length ? `验收标准：${inherited.acceptanceCriteria.join('；')}` : '',
    lifecycle.activity ? `父任务最后动作：${text(lifecycle.activity, 500)}` : '',
    lifecycle.context?.summary ? `父任务上下文摘要：${text(lifecycle.context.summary, 1600)}` : '',
    lifecycle.context?.unresolvedIssues?.length ? `未决问题：${lifecycle.context.unresolvedIssues.slice(-12).join('；')}` : '',
    lifecycle.steering?.length ? `用户最新补充：${lifecycle.steering.slice(-8).map((item) => item.message).join('；')}` : '',
    artifacts.length ? `已验证产出：${artifacts.join('；')}` : '',
    '只继承以上已验证事实；不要把父任务的未完成声明当成子任务已经完成。',
  ].filter(Boolean).join('\n');
}

function resolveEndpoint(model) {
  const base = String(model?.apiHost || '').trim().replace(/\/+$/u, '');
  if (!base) throw new Error('未配置 API 地址');
  if (/\/chat\/completions$/iu.test(base)) return base;
  if (/\/(?:v1|v2|v3|v4|compatible-mode\/v1|api\/paas\/v4)$/iu.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function modelName(model) { return String(model?.model || '').trim() || 'gpt-4o-mini'; }
function publicMember(member) {
  return { id: member.id, name: member.name, title: member.title, role: member.role, model: modelName(member.modelConfig) };
}

module.exports = {
  ROLE_DUTY,
  toolKey,
  toolCacheKey,
  isWorkspaceMutationTool,
  isWorkspaceSnapshotTool,
  isPreparationTool,
  isVerifiedArtifact,
  inferStepDeliverableType,
  supportsDynamicDelegation,
  toolAvailableForStep,
  structuredReviewCompletesStep,
  substantiveDecisionCompletesStep,
  requiresLongModelRequest,
  shouldExtendModelRoundBudget,
  verifiedFileStepCompletesStep,
  compensationNeedsApproval,
  summarizeChildTask,
  buildChildTaskContext,
  buildInheritedTaskContext,
  resolveEndpoint,
  modelName,
  publicMember,
};
