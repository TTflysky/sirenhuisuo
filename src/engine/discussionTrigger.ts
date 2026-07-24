import type {
  DiscussionParticipantPlan,
  DiscussionTriggerDecision,
  DiscussionTriggerInput,
  Employee,
  TeamTask,
} from '../types';

const CRITICAL = /立即|紧急|阻塞|线上故障|无法发布|P0|截止现在|立刻/iu;
const HIGH = /尽快|今天|截止|需要处理|请排查|回滚|修复/iu;
const COLLABORATION = /团队|讨论|评审|方案|实现|排查|协作|一起|帮忙/iu;
const TASK_WORDS = /实现|设计|写代码|验收|发布|文档|开发|修复|处理/iu;
const LOW = /^(收到|好的|好|谢谢|感谢|确认收到|ok|收到啦)[。！!，, ]*$/iu;

export function evaluateDiscussionTrigger(
  input: DiscussionTriggerInput,
  settings: { autoDiscussMode?: 'off' | 'smart' | 'always'; autoDiscuss?: boolean; autoDiscussMinScore?: number; autoDiscussCooldownMs?: number },
  memberIds: string[],
  lastTrigger?: { dedupeKey: string; triggeredAt: number },
): DiscussionTriggerDecision {
  const text = input.userText.trim();
  const urgency = CRITICAL.test(text) ? 'critical' : HIGH.test(text) ? 'high' : LOW.test(text) || (!text && input.hasAttachments) ? 'low' : (COLLABORATION.test(text) || TASK_WORDS.test(text) ? 'normal' : 'normal');
  const reasonCodes: string[] = [];
  let score = urgency === 'critical' ? 4 : urgency === 'high' ? 3 : urgency === 'normal' ? 1 : 0;
  if (urgency === 'critical') reasonCodes.push('critical-urgency');
  else if (urgency === 'high') reasonCodes.push('high-urgency');
  if (COLLABORATION.test(text)) { score += 3; reasonCodes.push('collaboration-intent'); }
  if (TASK_WORDS.test(text)) { score += 2; reasonCodes.push('task-content'); }
  if (input.activeTaskCount > 0) { score += 1; reasonCodes.push('active-task'); }
  if (input.hasAttachments || text.length > 240) { score += 1; reasonCodes.push('attachment-or-context'); }
  const forcedMemberIds = input.mentions.filter((id) => memberIds.includes(id));
  if (forcedMemberIds.length > 0) { score += Math.min(4, forcedMemberIds.length * 2); reasonCodes.push('explicit-mention'); }
  if (LOW.test(text)) { score -= 3; reasonCodes.push('confirmation-only'); }
  if (!memberIds.length) reasonCodes.push('no-members');
  if (!text && !input.hasAttachments) reasonCodes.push('empty-message');
  const fingerprint = `${input.teamId}:${text.replace(/\s+/g, ' ').toLowerCase().slice(0, 180)}:${input.recentMessages.slice(-3).map((m) => m.content.replace(/\s+/g, ' ').toLowerCase().slice(0, 60)).join('|')}`;
  const dedupeKey = `${input.teamId}:${fingerprint}`;
  const cooldownMs = urgency === 'critical' || urgency === 'high' ? 2000 : settings.autoDiscussCooldownMs ?? 8000;
  const mode = settings.autoDiscussMode ?? (settings.autoDiscuss ? 'smart' : 'off');
  const threshold = settings.autoDiscussMinScore ?? 3;
  const duplicate = lastTrigger?.dedupeKey === dedupeKey;
  const inCooldown = !!lastTrigger && input.now - lastTrigger.triggeredAt < cooldownMs;
  // Explicit mentions are direct requests and must work even when automatic
  // background discussions are disabled.
  const allowed = input.manual || mode === 'always' || mode === 'smart' || forcedMemberIds.length > 0;
  const shouldStart = allowed && memberIds.length > 0 && (!!text || input.hasAttachments) && !duplicate && !inCooldown && (input.manual || mode === 'always' || score >= threshold || urgency === 'critical' || forcedMemberIds.length > 0);
  if (duplicate) reasonCodes.push('duplicate');
  if (inCooldown) reasonCodes.push('cooldown');
  return { shouldStart, score, urgency, needsCollaboration: forcedMemberIds.length > 0 || COLLABORATION.test(text) || TASK_WORDS.test(text) || score >= 3, reasonCodes, forcedMemberIds, dedupeKey, cooldownUntil: input.now + cooldownMs };
}

export function buildParticipantPlan(teamMemberIds: string[], employees: Employee[], text: string, tasks: TeamTask[], forcedMemberIds: string[]): DiscussionParticipantPlan[] {
  const lane = tasks.find((task) => task.lane !== 'DONE')?.lane;
  const laneRoles: Record<string, string[]> = { PLANNING: ['pm', 'planner'], CODING: ['coder', 'planner'], REVIEW: ['checker', 'coder'] };
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  const plans = teamMemberIds.map((memberId) => {
    const employee = employees.find((item) => item.id === memberId);
    if (!employee) return null;
    if (forcedMemberIds.includes(memberId)) return { memberId, priority: 'forced' as const, relevanceScore: 100, reason: 'mentioned' as const, maxResponses: 1 };
    const haystack = `${employee.name} ${employee.title} ${employee.role} ${employee.prompt ?? ''} ${employee.soul ?? ''}`.toLowerCase();
    const keywordScore = words.filter((word) => haystack.includes(word)).length * 3;
    const laneScore = lane && laneRoles[lane]?.includes(employee.role) ? 4 : 0;
    const relevanceScore = keywordScore + laneScore + (employee.isOnline ? 1 : 0);
    if (relevanceScore < 3) return null;
    return { memberId, priority: relevanceScore >= 4 ? 'high' as const : 'normal' as const, relevanceScore, reason: laneScore > keywordScore ? 'task-lane' as const : 'keyword-match' as const, maxResponses: 1 };
  }).filter((item): item is NonNullable<typeof item> => !!item).map((item): DiscussionParticipantPlan => item).sort((a, b) => b.relevanceScore - a.relevanceScore);
  const forced = plans.filter((plan) => plan.priority === 'forced');
  const selected = [...forced, ...plans.filter((plan) => plan.priority !== 'forced').slice(0, Math.max(0, 6 - forced.length))];
  if (selected.length === 0) {
    const fallback = employees.find((employee) => teamMemberIds.includes(employee.id) && employee.isOnline) ?? employees.find((employee) => teamMemberIds.includes(employee.id));
    if (fallback) selected.push({ memberId: fallback.id, priority: 'normal', relevanceScore: 1, reason: 'fallback', maxResponses: 1 });
  }
  return selected;
}
