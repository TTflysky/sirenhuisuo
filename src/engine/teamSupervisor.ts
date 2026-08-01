import type { Dispatch } from 'react';
import { APP_PRODUCT_NAME } from '../brand';
import { BEGINNER_RESPONSE_GUIDE } from '../data/assistantPresentation';
import * as client from '../data/hermesClient';
import { buildLayeredMemoryContext } from '../data/layeredMemory';
import { listSkills } from '../data/skills';
import { legacyConversationId, messageBelongsToConversation } from '../data/chatSessions';
import { classifyTaskInput } from './taskContextRouter.mjs';
import { resolveMentionedEmployees } from './teamMembership';
import type { AppStateAction } from '../store/appStateReducer';
import type { AppState, Employee, Team } from '../types';

interface TeamSupervisorOptions {
  getState: () => AppState;
  dispatch: Dispatch<AppStateAction>;
  busy: Set<string>;
  queued: Map<string, string>;
  employeeModelSummary: (employee: Employee) => string;
}

export function createTeamSupervisorResponder(options: TeamSupervisorOptions) {
  const respond = async (team: Team, content: string, conversationId: string): Promise<{ reply: string; messageId: string } | undefined> => {
    const busyKey = `${team.id}:${conversationId}`;
    if (options.busy.has(busyKey)) {
      options.queued.set(busyKey, content);
      return undefined;
    }
    options.busy.add(busyKey);
    const sanitizeReply = (reply: string) => reply.replace(/^(?:收到|好的|明白)[，,。！!：:\s]*/u, '').trim() || reply.trim();
    const appendMessage = (reply: string, tokens?: number) => {
      const state = options.getState();
      const visibleReply = sanitizeReply(reply);
      const messageId = `msg-supervisor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const mentions = resolveMentionedEmployees(visibleReply, state.employees)
        .filter((employee) => team.memberIds.includes(employee.id))
        .map((employee) => employee.id);
      options.dispatch({
        type: 'APPEND_CHAT', teamId: team.id, conversationId,
        msgs: [{ id: messageId, authorId: 'assistant', roleId: 'custom', content: visibleReply, mentions, timestamp: Date.now(), kind: 'text', tokens, conversationId }],
      });
      return { reply: visibleReply, messageId };
    };
    try {
      const state = options.getState();
      const assistantModel = client.getAssistantModel();
      const configuredPrompt = localStorage.getItem('hermes_office_assistant_system_prompt')?.trim();
      const layeredMemoryContext = await buildLayeredMemoryContext({ query: content, teamId: team.id, limit: 16 });
      const userContext = [client.buildUserContext(), layeredMemoryContext].filter(Boolean).join('\n\n');
      const availableSkills = await listSkills().catch(() => []);
      const skillRoster = availableSkills.slice(0, 80).map((skill) => `${skill.name}${skill.description ? `：${skill.description.slice(0, 80)}` : ''}`).join('\n');
      const teamRoster = team.memberIds.map((id) => state.employees.find((employee) => employee.id === id))
        .filter((employee): employee is Employee => !!employee)
        .map((employee) => `- 姓名：${employee.name}\n  身份/职责：${employee.title} / ${employee.role}\n  在线：${employee.isOnline ? '是' : '否'}\n  专长与工作偏好：${(employee.prompt ?? '未填写').slice(0, 600)}\n  人设/补充信息：${(employee.soul ?? '未填写').slice(0, 900)}\n  模型：${options.employeeModelSummary(employee)}`)
        .join('\n');
      const project = state.projects.find((item) => item.teamId === team.id);
      const currentRun = state.taskRuns
        .filter((run) => run.teamId === team.id && (run.conversationId === conversationId || (!run.conversationId && conversationId === legacyConversationId(`team:${team.id}`))))
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0];
      const activeStep = currentRun?.steps.find((step) => step.status === 'running')
        ?? currentRun?.steps.find((step) => step.status === 'paused' || step.status === 'failed')
        ?? currentRun?.steps.find((step) => step.status === 'queued');
      const inputRelation = currentRun ? classifyTaskInput(content, currentRun) : undefined;
      const projectState = [
        `项目：${project?.title ?? team.name}`,
        `项目状态：${project?.status ?? '未立项'}`,
        `任务状态：${currentRun?.status ?? '尚未创建任务'}`,
        `当前阶段：${activeStep ? `${activeStep.title} / ${activeStep.status}` : '暂无活动阶段'}`,
        `当前负责人：${activeStep ? state.employees.find((employee) => employee.id === activeStep.employeeId)?.name ?? activeStep.employeeId : '章北海助理'}`,
        `已完成：${currentRun?.steps.filter((step) => step.status === 'completed').map((step) => step.title).join('、') || '暂无'}`,
        `等待条件：${currentRun?.pendingApproval?.title ?? currentRun?.recoveryContext?.waitingFor ?? currentRun?.lastError ?? '无'}`,
        `本轮与任务关系：${inputRelation ? `${inputRelation.kind} / ${inputRelation.action}` : '普通对话或首次需求'}`,
      ].join('\n');
      const systemPrompt = `${configuredPrompt ? `## 助理配置\n${configuredPrompt}\n\n` : ''}${userContext ? `${userContext}\n` : ''}你是${APP_PRODUCT_NAME}的章北海助理，也是这个团队里的常驻主助理。\n\n## 对话职责\n- 老板没有明确 @ 某位员工时，你必须第一时间介入：先结合当前项目状态判断这是询问、纠正、补充约束、暂停、继续还是新任务，再直接回答和说明对现有计划的影响。\n- 老板明确 @ 某位员工时，该员工拥有回复权；不要抢答或代替其工作。\n- 用户插话改变目标或约束时，必须说明是否暂停当前步骤、调整哪个阶段、是否更换负责人，以及接下来谁继续；同一目标不得新建平行项目。\n- 每个阶段完成后，用“解决什么、为什么这样做、已经做到、还没有做、下一步由谁执行”做一次简洁交接。工具、文件读取和命令过程属于折叠的执行记录，不要在正文重复倾倒。\n- 多人任务的分工、依赖、交付和验收由任务系统处理。你只在真实状态基础上汇报，不编造成员回复、文件、连接或后台进度。\n- 普通沟通直接回答。不要复述老板原话，不要输出“收到需求”“需求复述”“已完成分工”等模板化文案。\n\n## 当前项目真实状态\n${projectState}\n\n## 当前团队（唯一可调度范围）\n团队名称：${team.name}\n${teamRoster || '暂无成员'}\n\n## 可用 Skill\n${skillRoster || '暂无可用 Skill'}\n\n你可以解释、分析、协调和汇报，但不能伪造成员已完成的成果。你自己不是团队成员，不能@自己。`;
      const turns: client.ChatTurn[] = [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: BEGINNER_RESPONSE_GUIDE },
        ...team.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${team.id}`)).slice(-12).map((message) => ({
          role: message.roleId === 'human' ? 'user' as const : 'assistant' as const,
          content: `${state.employees.find((employee) => employee.id === message.authorId)?.name ?? '团队成员'}: ${message.content}`,
        })),
        { role: 'user', content: `老板@你说：${content}` },
      ];
      if (!client.resolveApiBase(assistantModel)) return appendMessage('⚠️ 章北海助理没有可用模型配置，无法进行真实对话或调度。请在设置中激活全局模型，或为助理选择模型后重试。');
      const result = await client.chatCompletion(turns, 'assistant-team', `章北海/${team.name}`, undefined, assistantModel);
      const reply = result.content?.trim().replace(/@Hermes(?:\s+助理)?|@章北海(?:\s+助理)?|@驴狗蛋(?:\s+助手)?/gu, '章北海助理');
      if (!reply) return undefined;
      const assistantResult = appendMessage(reply, result.usage.totalTokens);
      client.extractUserInsights(`老板：${content}\n章北海回复：${reply}`, `团队主助理-${team.name}`).catch(() => {});
      return assistantResult;
    } catch (error) {
      console.warn('[supervisor] reply failed:', error);
      const reason = error instanceof Error ? error.message : String(error);
      return appendMessage(`⚠️ 章北海助理本次模型调用失败：${reason.slice(0, 180)}。任务没有被伪装为已执行；请检查模型连接后重试。`);
    } finally {
      options.busy.delete(busyKey);
      const queued = options.queued.get(busyKey);
      options.queued.delete(busyKey);
      if (queued && queued !== content) setTimeout(() => { void respond(team, queued, conversationId); }, 0);
    }
  };
  return respond;
}
