import { restoreTaskContext } from './taskContext.mjs';

const STOP_TERMS = new Set(['任务', '完成', '需要', '进行', '这个', '一个', '我们', '用户', '工作', '处理', '继续', '生成']);

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function searchTerms(query) {
  const normalized = text(query, 1200).toLowerCase();
  const terms = new Set();
  for (const token of normalized.match(/[a-z0-9_.-]{2,}|[\p{Script=Han}]{2,}/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length <= 12 && !STOP_TERMS.has(token)) terms.add(token);
      for (let index = 0; index < token.length - 1; index += 1) {
        const gram = token.slice(index, index + 2);
        if (!STOP_TERMS.has(gram)) terms.add(gram);
      }
    } else {
      terms.add(token);
    }
  }
  return [...terms].slice(0, 48);
}

function fieldScore(value, terms, weight) {
  const haystack = text(value, 12000).toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? weight : 0), 0);
}

function teamName(run, teams) {
  return teams?.find((team) => team.id === run.teamId)?.name ?? run.teamId ?? '未知团队';
}

function matchesHistoryScope(run, options) {
  const teamId = String(options.teamId || '').trim();
  const projectId = String(options.projectId || '').trim();
  const conversationId = String(options.conversationId || '').trim();
  if (teamId && run.teamId !== teamId) return false;
  if (projectId && run.projectId !== projectId) return false;
  if (conversationId && run.conversationId !== conversationId) return false;
  return true;
}

export function searchTaskRunHistory(runs, query, options = {}) {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const excluded = new Set([options.excludeTaskId].filter(Boolean));
  const allowedStatuses = new Set(options.statuses ?? ['completed', 'failed', 'stopped', 'paused']);
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run && !excluded.has(run.id) && allowedStatuses.has(run.status) && matchesHistoryScope(run, options))
    .map((run) => {
      const context = restoreTaskContext(run.context, { taskId: run.id, goal: run.goal ?? run.request, acceptanceCriteria: run.acceptanceCriteria });
      const eventMatches = context.events
        .map((event) => ({ event, score: fieldScore(event.summary, terms, event.verified ? 3 : 1) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.event.ts - a.event.ts)
        .slice(0, 5);
      const stepText = (run.steps || []).flatMap((step) => [
        step.title, step.assignment, step.lastError, step.reviewReason,
        ...(step.events || []).map((event) => event.detail),
        ...(step.evidence || []).map((item) => item.summary),
      ]).join('\n');
      const evidenceText = [
        ...(run.evidence || []).map((item) => item.summary),
        ...(run.verification || []).flatMap((item) => [item.label, item.detail]),
        ...(run.preflight || []).flatMap((item) => [item.label, item.detail]),
        ...(run.runner?.events || []).map((event) => event.detail),
        ...(run.executionMessages || []).map((message) => message.content),
      ].join('\n');
      const recoveryText = [
        run.lastError, run.handoff?.blocked, run.handoff?.nextAction,
        ...(run.handoff?.completed || []), run.recoveryContext?.summary,
        ...(run.recoveryContext?.completedEvidence || []), ...(run.recoveryContext?.unresolvedIssues || []),
      ].join('\n');
      const score = fieldScore(`${run.title}\n${run.goal ?? run.request}`, terms, 6)
        + fieldScore(context.summary.narrative, terms, 4)
        + fieldScore(context.summary.modelNarrative, terms, 2)
        + fieldScore(context.summary.verifiedFacts.join('\n'), terms, 4)
        + fieldScore(context.summary.artifactPaths.join('\n'), terms, 5)
        + fieldScore(context.summary.blockers.join('\n'), terms, 2)
        + fieldScore(stepText, terms, 3)
        + fieldScore(evidenceText, terms, 4)
        + fieldScore(recoveryText, terms, 3)
        + eventMatches.reduce((total, item) => total + item.score, 0);
      return {
        taskId: run.id,
        teamId: run.teamId,
        projectId: run.projectId,
        conversationId: run.conversationId,
        teamName: teamName(run, options.teams),
        title: text(run.title, 200),
        goal: text(run.goal ?? run.request, 1000),
        status: run.status,
        score,
        updatedAt: Number(run.updatedAt) || Number(run.createdAt) || 0,
        summary: text(context.summary.modelNarrative || context.summary.narrative || context.summary.verifiedFacts.slice(-3).join('；'), 900),
        verifiedFacts: context.summary.verifiedFacts.slice(-8),
        artifactPaths: context.summary.artifactPaths.slice(-8),
        blockers: context.summary.blockers.slice(-5),
        matchedEvents: eventMatches.map((item) => item.event),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(20, Number(options.limit) || 8)));
}

export function buildTaskHistoryPrompt(matches, maxLength = 8000) {
  const items = (Array.isArray(matches) ? matches : []).slice(0, 4).map((match, index) => {
    const facts = match.verifiedFacts?.length ? match.verifiedFacts.map((item) => `  - ${item}`).join('\n') : '  - 无可复用的已验证事实';
    const artifacts = match.artifactPaths?.length ? `\n  交付文件：${match.artifactPaths.join('、')}` : '';
    const blockers = match.blockers?.length ? `\n  历史阻塞：${match.blockers.join('；')}` : '';
    return `${index + 1}. [${match.taskId}] ${match.title}（${match.status}）\n  原目标：${match.goal}\n  已验证事实：\n${facts}${artifacts}${blockers}`;
  }).join('\n\n');
  if (!items) return '';
  return `## 相似历史任务（跨会话只读参考）\n${items}\n\n历史任务不能覆盖当前目标、当前输入和当前验收标准。只复用已验证路线；历史阻塞需要重新检查，不能直接当作当前事实。`.slice(0, maxLength);
}

function attachmentEvidence(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  return {
    name: text(attachment.name, 240),
    mime: text(attachment.mime, 160),
    size: Number.isFinite(attachment.size) ? attachment.size : undefined,
    kind: text(attachment.kind, 40) || 'file',
    workspacePath: text(attachment.workspacePath, 1000) || undefined,
    persistenceError: text(attachment.persistenceError, 800) || undefined,
    available: Boolean(attachment.workspacePath || attachment.dataUrl),
    inline: Boolean(attachment.dataUrl),
  };
}

export function buildTaskReplay(run, ledgerEvents = []) {
  if (!run) return null;
  const context = restoreTaskContext(run.context, { taskId: run.id, goal: run.goal ?? run.request, acceptanceCriteria: run.acceptanceCriteria });
  const runnerEvents = Array.isArray(run.runner?.events) ? run.runner.events : [];
  return {
    taskId: run.id,
    teamId: run.teamId,
    projectId: run.projectId,
    conversationId: run.conversationId,
    title: text(run.title, 200),
    goal: text(run.goal ?? run.request, 1600),
    status: run.status,
    summary: context.summary,
    acceptanceCriteria: context.acceptanceCriteria,
    relatedTaskIds: context.relatedTaskIds,
    events: context.events.slice().sort((a, b) => a.ts - b.ts),
    runnerEvents: runnerEvents.slice().sort((a, b) => a.ts - b.ts),
    attachments: (Array.isArray(run.sourceAttachments) ? run.sourceAttachments : [])
      .map(attachmentEvidence)
      .filter(Boolean),
    ledgerEvents: (Array.isArray(ledgerEvents) ? ledgerEvents : [])
      .filter((event) => event?.taskId === run.id)
      .slice()
      .sort((a, b) => a.sequence - b.sequence),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
