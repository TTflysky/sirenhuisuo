import type { AppState, ChatMessage, DiscussionTriggerInput, Employee, TaskRun, Team } from '../types';
import type { AppStateAction } from './appStateReducer';
import { legacyConversationId, messageBelongsToConversation, ensureActiveChatSession } from '../data/chatSessions';
import { runTeamDiscussion, runTeamMentionReply } from '../engine/teamDiscussion';
import { classifyTaskInput, findTaskContinuationTarget } from '../engine/taskContextRouter.mjs';
import { getDirectExecutionControl, isConversationOnlyMessage, shouldHoldTaskForFeedback } from '../engine/agentGuardrails.mjs';
import { classifyLocalOfficeQuery, formatLocalOfficeAnswer } from '../engine/officeDirectory';
import { isTeamMemberAdditionRequest, resolveMentionedEmployees } from '../engine/teamMembership';
import { employeeModelSummary, isTeamControlRequest } from '../engine/teamControl';
import { classifyTeamMention } from '../engine/teamMentionRouting.mjs';
import { getRegisteredTools } from '../engine/toolCatalog';
import { buildTaskPlan, matchTeamMembers } from '../engine/taskMatcher';
import { evaluateDiscussionTrigger } from '../engine/discussionTrigger';
import * as client from '../data/hermesClient';

type DiscussionOpts = Parameters<typeof runTeamDiscussion>[2];

interface TeamMessageCommandDependencies {
  getState: () => AppState;
  dispatch: (action: AppStateAction) => void;
  enqueueTeamAssistantReply: (...args: any[]) => Promise<any>;
  startTaskRun: (...args: any[]) => Promise<void>;
  addTeamMembers: (teamId: string, memberIds: string[]) => Employee[];
  pauseTaskRun: (runId: string) => void;
  resumeTaskRun: (runId: string) => Promise<void>;
  stopTaskRun: (runId: string) => void;
}

export function createTeamMessageCommands({
  getState,
  dispatch,
  enqueueTeamAssistantReply,
  startTaskRun,
  addTeamMembers,
  pauseTaskRun,
  resumeTaskRun,
  stopTaskRun,
}: TeamMessageCommandDependencies) {
  const buildTeamTaskRequest = (team: Team, content: string, conversationId: string): string => {
    const current = content.trim();
    const needsPriorContext = current.length < 120
      || /拉团队|组建团队|拉群|开始执行|继续执行|按刚才|按照上面|这个任务|该项目/u.test(current);
    if (!needsPriorContext) return current;
    const prior = team.chatMessages
      .filter((message) => messageBelongsToConversation(message, conversationId, `team:${team.id}`))
      .filter((message) => message.roleId === 'human')
      .slice(-6)
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join('\n');
    return prior ? `${prior}\n\n老板最新要求：${current}` : current;
  };

  const runDirectEmployeeReply = async (
    team: Team,
    employeeId: string,
    content: string,
    sourceMessageId: string,
    conversationId: string,
    attachments?: import('../data/hermesClient').Attachment[],
    inReplyToMessageId?: string,
  ) => {
    const current = getState();
    const employee = current.employees.find((item) => item.id === employeeId && team.memberIds.includes(item.id));
    if (!employee) return;
    const discussionId = `mention-${sourceMessageId}-${employee.id}`;
    dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { isWorking: true, currentTask: '正在回复团队点名' } });
    try {
      const unfilteredTeam = getState().teams.find((item) => item.id === team.id) ?? team;
      const liveTeam = { ...unfilteredTeam, chatMessages: unfilteredTeam.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${team.id}`)) };
      const result = await runTeamMentionReply(liveTeam, getState().employees, {
        employeeId: employee.id,
        userText: content,
        triggerMessageId: sourceMessageId,
        discussionId,
        attachments,
        extraSystemContext: `当前是团队「${liveTeam.name}」中的点名回复。只回答老板本次问题，不把普通追问升级成正式任务。`,
      });
      dispatch({
        type: 'APPEND_CHAT',
        teamId: team.id,
        msgs: [{
          id: `msg-mention-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          authorId: result.employee.id,
          authorName: result.employee.name,
          roleId: result.employee.role,
          content: result.text,
          mentions: result.mentions,
          timestamp: Date.now(),
          kind: 'text',
          tokens: result.tokens,
          contextUsage: result.contextUsage,
          discussionId,
          triggeredBy: 'message',
          inReplyToMessageId: inReplyToMessageId ?? sourceMessageId,
          conversationId,
        }],
        conversationId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      dispatch({
        type: 'APPEND_CHAT',
        teamId: team.id,
        msgs: [{
          id: `msg-mention-error-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          authorId: employee.id,
          authorName: employee.name,
          roleId: employee.role,
          content: `⚠️ ${employee.name} 回复失败：${reason.slice(0, 240)}`,
          mentions: [], timestamp: Date.now(), kind: 'text',
          discussionId, triggeredBy: 'message',
          inReplyToMessageId: inReplyToMessageId ?? sourceMessageId,
          conversationId,
        }],
        conversationId,
      });
    } finally {
      dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { isWorking: false, currentTask: undefined } });
    }
  };

  const enqueueAutoDiscussion = (teamId: string, messageId: string, content: string, mentions: string[], attachments?: import('../data/hermesClient').Attachment[], skillRefs: import('../types').SkillReference[] = [], conversationId = ensureActiveChatSession(`team:${teamId}`)) => {
    const current = getState();
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    const runBelongsToConversation = (run: TaskRun) => run.conversationId === conversationId
      || (!run.conversationId && conversationId === legacyConversationId(`team:${teamId}`));
    void (async () => {
      const directMentions = mentions.filter((id) => team.memberIds.includes(id));
      const supervisorMentioned = mentions.includes('assistant');
      const relatedRuns = current.taskRuns.filter((run) => run.teamId === teamId && runBelongsToConversation(run));
      const latestRelatedRun = [...relatedRuns].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0];
      const routedFollowUp = latestRelatedRun ? classifyTaskInput(content, latestRelatedRun) : undefined;
      const resumeTarget = findTaskContinuationTarget(content, relatedRuns);
      const directControl = getDirectExecutionControl(content) ?? (resumeTarget ? 'resume' : null);
      if (directControl) {
        const activeRuns = current.taskRuns.filter((run) => run.teamId === teamId && runBelongsToConversation(run) && (run.status === 'queued' || run.status === 'running'));
        if (directControl === 'resume') {
          if (resumeTarget) await resumeTaskRun(resumeTarget.id);
        } else {
          activeRuns.forEach((run) => directControl === 'stop' ? stopTaskRun(run.id) : pauseTaskRun(run.id));
        }
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId,
          msgs: [{
            id: `msg-direct-control-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
            content: directControl === 'resume'
              ? resumeTarget ? '继续命令已写入原项目。系统会先恢复暂停的子任务，再从未完成阶段接着执行；不会重新做已经通过的规划。' : '当前没有等待恢复的团队任务。'
              : directControl === 'stop'
                ? '团队任务已停止，已完成内容保留；旧任务不会自行恢复。'
                : '团队任务已暂停。你仍可以继续对话，只有明确说“继续”才会恢复。',
            mentions: [], timestamp: Date.now(), kind: 'text',
          }],
        });
        return;
      }
      const localOfficeQuery = classifyLocalOfficeQuery(content);
      if (localOfficeQuery) {
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId,
          msgs: [{
            id: `msg-office-fact-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
            content: formatLocalOfficeAnswer(localOfficeQuery, current.employees, current.teams),
            mentions: [], timestamp: Date.now(), kind: 'text',
          }],
        });
        return;
      }
      if (isTeamMemberAdditionRequest(content)) {
        const mentionedEmployees = resolveMentionedEmployees(content, current.employees);
        const newMembers = mentionedEmployees.filter((employee) => !team.memberIds.includes(employee.id));
        if (newMembers.length) {
          addTeamMembers(team.id, newMembers.map((employee) => employee.id));
        } else {
          const alreadyMembers = mentionedEmployees.filter((employee) => team.memberIds.includes(employee.id));
          dispatch({
            type: 'APPEND_CHAT', teamId, conversationId,
            msgs: [{
              id: `msg-member-add-help-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
              content: alreadyMembers.length
                ? `${alreadyMembers.map((employee) => employee.name).join('、')} 已经在「${team.name}」中，不需要重复添加。`
                : '我知道你要补充团队成员，但没有识别到明确的员工姓名。请直接说“把员工姓名加入团队”，或点成员栏顶部的添加按钮选择。',
              mentions: alreadyMembers.map((employee) => employee.id), timestamp: Date.now(), kind: 'text',
            }],
          });
        }
        return;
      }
      if (isTeamControlRequest(content)) {
        const pauseRequested = /(?:暂停|停止|先停|停下|别做|不要继续).{0,12}(?:工作|任务|手上|当前|执行)|(?:工作|任务).{0,8}(?:暂停|停止)/u.test(content);
        const reportRequested = /(?:模型|配置|状态|报数|报个数|数数|在线情况)/u.test(content);
        const targets = (directMentions.length ? directMentions : team.memberIds)
          .map((id) => current.employees.find((employee) => employee.id === id))
          .filter((employee): employee is Employee => !!employee);

        if (pauseRequested) {
          current.taskRuns
            .filter((run) => run.teamId === teamId && runBelongsToConversation(run) && (run.status === 'queued' || run.status === 'running'))
            .forEach((run) => pauseTaskRun(run.id));
          targets.forEach((employee) => dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { isWorking: false } }));
        }

        const now = Date.now();
        const messages: ChatMessage[] = [];
        if (pauseRequested) {
          messages.push({
            id: `msg-control-${now}`, authorId: 'assistant', roleId: 'custom',
            content: '当前团队任务已暂停。此指令不会创建新任务，也不会调用 Skill 或文件工具。',
            mentions: targets.map((employee) => employee.id), timestamp: now, kind: 'text',
          });
        }
        if (reportRequested) {
          targets.forEach((employee, index) => messages.push({
            id: `msg-model-report-${now}-${employee.id}`, authorId: employee.id, roleId: employee.role,
            content: `${/报数|报个数|数数/u.test(content) ? `${index + 1}。` : ''}模型汇报：${employeeModelSummary(employee)}。当前状态：${employee.isOnline ? (pauseRequested ? '已暂停' : employee.isWorking ? '工作中' : '空闲') : '掉线'}。`,
            mentions: [], timestamp: now + index + 1, kind: 'text',
          }));
        }
        if (messages.length) dispatch({ type: 'APPEND_CHAT', teamId, msgs: messages, conversationId });
        return;
      }
      // A direct employee mention is not automatically a new task. Keep
      // ordinary follow-ups in the employee's own conversation, even when a
      // previous TaskRun for this team has already finished.
      if (directMentions.length > 0 && !supervisorMentioned) {
        const route = classifyTeamMention(content);
        if (route === 'reply') {
          for (const employeeId of directMentions) {
            await runDirectEmployeeReply(team, employeeId, content, messageId, conversationId, attachments);
          }
          return;
        }
        if (route === 'task') {
          void startTaskRun(teamId, buildTeamTaskRequest(team, content, conversationId), directMentions, messageId, attachments, skillRefs, undefined, conversationId);
          return;
        }
      }
      if (directMentions.length === 0 && latestRelatedRun && routedFollowUp && routedFollowUp.action !== 'queue_separately') {
        const isQuestionOrConversation = routedFollowUp.kind === 'question'
          || (routedFollowUp.kind === 'constraint' && isConversationOnlyMessage(content));
        const canSteerLiveRun = latestRelatedRun.status === 'queued' || latestRelatedRun.status === 'running';
        if (canSteerLiveRun && (client.loadSettings().followUpMode ?? 'steer') === 'steer' && window.electronAPI?.taskExecutionSteer) {
          const steered = await window.electronAPI.taskExecutionSteer({ taskId: latestRelatedRun.id, message: content });
          if (steered.ok) {
            await enqueueTeamAssistantReply(team, content, conversationId);
            return;
          }
        }
        if (isQuestionOrConversation) {
          await enqueueTeamAssistantReply(team, content, conversationId);
          return;
        }
        if (routedFollowUp.shouldMergeWithGoal) {
          if (canSteerLiveRun) pauseTaskRun(latestRelatedRun.id);
          await enqueueTeamAssistantReply(team, `${content}\n\n请先明确告诉老板：这条要求已合并到原项目，不会创建第二个项目；说明你准备调整哪个阶段，然后交给任务系统继续。`, conversationId);
          const continuationMemberIds = [...new Set(
            latestRelatedRun.steps
              .filter((step) => step.status !== 'completed' || routedFollowUp.kind === 'correction')
              .map((step) => step.employeeId)
              .filter((id) => team.memberIds.includes(id)),
          )];
          const fallbackMemberIds = continuationMemberIds.length
            ? continuationMemberIds
            : latestRelatedRun.memberSnapshot.map((member) => member.id).filter((id) => team.memberIds.includes(id));
          if (fallbackMemberIds.length) {
            const taskRequest = buildTeamTaskRequest(team, content, conversationId);
            void startTaskRun(teamId, taskRequest, fallbackMemberIds, messageId, attachments, skillRefs, undefined, conversationId, undefined, latestRelatedRun);
          }
          return;
        }
      }
      if (shouldHoldTaskForFeedback(content)) {
        current.taskRuns
          .filter((run) => run.teamId === teamId && runBelongsToConversation(run) && (run.status === 'queued' || run.status === 'running'))
          .forEach((run) => pauseTaskRun(run.id));
        await enqueueTeamAssistantReply(team, content, conversationId);
        return;
      }
      if (isConversationOnlyMessage(content)) {
        await enqueueTeamAssistantReply(team, content, conversationId);
        return;
      }
      const activeRun = [...current.taskRuns].reverse().find((run) => run.teamId === teamId && runBelongsToConversation(run) && (run.status === 'queued' || run.status === 'running'));
      if (activeRun && (client.loadSettings().followUpMode ?? 'steer') === 'steer' && window.electronAPI?.taskExecutionSteer) {
        const steered = await window.electronAPI.taskExecutionSteer({ taskId: activeRun.id, message: content });
        if (steered.ok) {
          await enqueueTeamAssistantReply(team, content, conversationId);
          return;
        }
      }
      const taskRequest = buildTeamTaskRequest(team, content, conversationId);
      const taskDecision = await client.compileTaskDecision([
        ...team.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${team.id}`)).slice(-8).map((message) => ({
          role: message.roleId === 'human' ? 'user' as const : 'assistant' as const,
          content: message.content,
        })),
        { role: 'user', content },
      ], getRegisteredTools(), client.getAssistantModel());
      const mayDelegate = taskDecision.decision.mode === 'execute';
      const selectionRequest = [taskRequest, ...(taskDecision.decision.requiredCapabilities ?? [])].filter(Boolean).join('\n所需能力：');
      const requestedMemberIds = mayDelegate ? matchTeamMembers(team, current.employees, selectionRequest, directMentions) : [];
      const planned = requestedMemberIds.length > 0 ? buildTaskPlan(team, current.employees, taskRequest, requestedMemberIds) : [];
      if (planned.length > 0) {
        const planText = planned.map((step) => {
          const employee = current.employees.find((item) => item.id === step.employeeId);
          const dependencies = step.dependsOnStepIds.length ? `（等待第 ${step.dependsOnStepIds.map((id) => planned.find((item) => item.id === id)?.order ?? '?').join('、')} 步）` : '';
          return `${step.order}. @${employee?.name ?? step.employeeId}：${step.title}${dependencies}`;
        }).join('\n');
        const deliverables = taskDecision.decision.deliverables?.map((item) => item.label).filter(Boolean).join('、')
          || taskDecision.decision.acceptanceCriteria?.[0]
          || '按任务合同交付可验证结果';
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId,
          msgs: [{
            id: `msg-dispatch-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            authorId: 'assistant', roleId: 'custom',
            content: `任务简报\n目标：${taskDecision.decision.goal}\n分工：\n${planText}\n交付：${deliverables}\n当前缺口：暂无，执行中如需账号、授权或业务选择会明确提出。`,
            mentions: requestedMemberIds, timestamp: Date.now(), kind: 'text',
          }],
        });
      }
      if (!mayDelegate) {
        await enqueueTeamAssistantReply(team, content, conversationId);
        return;
      }
      if (!requestedMemberIds.length) {
        await enqueueTeamAssistantReply(team, '当前目标需要执行，但团队内没有匹配的在线成员。请说明缺少的角色或补充成员后，我会重新编排。', conversationId);
        return;
      }
      void startTaskRun(teamId, taskRequest, requestedMemberIds, messageId, attachments, skillRefs, taskDecision.decision, conversationId);
    })();
  };

  const triggerDiscussion = (teamId: string, opts?: DiscussionOpts) => {
    const current = getState();
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    const settings = client.loadSettings();
    const conversationId = opts?.conversationId ?? ensureActiveChatSession(`team:${teamId}`);
    const triggerText = opts?.userText?.trim() || '请团队协作讨论当前事项';
    const input: DiscussionTriggerInput = {
      teamId, messageId: opts?.triggerMessageId ?? `manual-${Date.now()}`, userText: triggerText,
      mentions: [], hasAttachments: !!opts?.attachments?.length, recentMessages: team.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${teamId}`)).slice(-12),
      activeTaskCount: (team.tasks ?? []).filter((task) => task.lane !== 'DONE').length,
      manual: true, now: Date.now(),
    };
    const decision = evaluateDiscussionTrigger(input, settings, team.memberIds);
    if (!decision.shouldStart) return;
    void startTaskRun(teamId, triggerText, opts?.forcedMemberIds ?? decision.forcedMemberIds, opts?.triggerMessageId, opts?.attachments, [], undefined, conversationId);
  };


  return { enqueueAutoDiscussion, triggerDiscussion };
}
