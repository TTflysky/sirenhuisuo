import type { Employee, Team, ChatMessage, TeamTask, TaskLane, DiscussionParticipantPlan, TaskRunStep, TaskPlanStep } from '../types';
import { runAgentLoop, resolveApiBase, extractUserInsights, getEmployeeModel, type ChatTurn, type ContextUsage } from '../data/hermesClient';
import { executeTool } from './tools';
import { getRegisteredTools } from './toolCatalog';
import { diagnoseModel } from '../diagnostics/modelDiagnostics';
import { BEGINNER_RESPONSE_GUIDE } from '../data/assistantPresentation';
import { blockExecution, createExecutionController, observeExecutionResult, type ExecutionControllerSnapshot } from './executionController.mjs';
import type { TaskPlan } from './taskPlan.mjs';
import type { ConnectorProtocolResult } from './connectorProtocol.mjs';
import type { ReviewSubmissionEvidence, ToolExecutionEvidence } from './executionEvidence.mjs';

// ===== 讨论回调 =====
export interface DiscussionHandlers {
  onMessage: (emp: Employee, content: string, mentions: string[], tokens?: number, discussionRound?: number, inReplyToMessageId?: string, stepId?: string, contextUsage?: ContextUsage) => void;
  onToolCall: (emp: Employee, toolName: string, toolArgs: string, result: string, stepId?: string, success?: boolean, protocolEvidence?: ConnectorProtocolResult, structuredEvidence?: ToolExecutionEvidence) => void;
  onTaskAdvance: (taskId: string, lane: TaskLane) => void;
  onStatus: (text: string) => void;
  onDone: () => void;
  onStepStart?: (stepId: string, emp: Employee) => void;
  onStepAdded?: (step: TaskPlanStep) => void;
  onReviewDecision?: (stepId: string, approved: boolean, reason?: string, responsibleEmployeeId?: string, responsibleStepId?: string, review?: ReviewSubmissionEvidence) => void;
  onRunFailed?: (error: string) => void;
  onRunCheckpointed?: (reason: string) => void;
  onSteeringReply?: (emp: Employee, content: string, tokens?: number, contextUsage?: ContextUsage, stepId?: string) => void;
  onExecutionState?: (state: ExecutionControllerSnapshot, emp?: Employee, stepId?: string) => void;
  onTextDelta?: (emp: Employee, accumulated: string, stepId?: string) => void;
  onAutonomousDecision?: (emp: Employee, stepId: string, toolName: string, toolArgs: string) => Promise<void> | void;
}

export interface TeamDiscussionOptions {
  task?: TeamTask;
  userText?: string;
  attachments?: import('../data/hermesClient').Attachment[];
  extraSystemContext?: string;
  participantPlan?: DiscussionParticipantPlan[];
  triggerMessageId?: string;
  discussionId?: string;
  conversationId?: string;
  maxRounds?: number;
  forcedMemberIds?: string[];
  runId?: string;
  /** 本次任务专属磁盘目录；暂停、恢复和审查必须继续使用同一个目录。 */
  workspaceId?: string;
  runSteps?: TaskRunStep[];
  formalPlan?: TaskPlan;
  initialExecutionState?: ExecutionControllerSnapshot;
}

// 角色在讨论中的职责描述（系统提示词扩展）
const ROLE_DUTY: Record<string, string> = {
  pm: '你是团队协调者（PM）。根据任务合同组织步骤、依赖和验收，只在交付类型确实需要文件时写文档。',
  planner: '你是规划者和架构师。读取已有真实证据，形成当前责任所需的方案、决策或文件，不套用固定流程。',
  coder: '你是实现工程师。需要代码交付时写完整可运行文件并验证；其他任务按合同选择正确工具和证据。',
  checker: '你是审查者。检查真实产出、运行或连接结果，使用结构化审查结论，不用口头通过替代验收。',
  custom: '你是团队成员。根据身份牌能力和任务合同自主选择工具，保留可验收的真实结果。',
};

function memberByRole(team: Team, employees: Employee[], role: string): Employee | undefined {
  return team.memberIds
    .map((id) => employees.find((e) => e.id === id))
    .find((e): e is Employee => !!e && e.role === role);
}

function buildContext(msgs: ChatMessage[], employees: Employee[]): ChatTurn[] {
  return msgs.slice(-12).map((m) => ({
    role: (m.roleId === 'human' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `${(employees.find((e) => e.id === m.authorId)?.name ?? m.roleId)}: ${m.content.slice(-3500)}`,
  }));
}

// 有 API 时用 agentLoop（可调工具），无 API 回落下本地剧本
async function memberSpeak(
  emp: Employee,
  team: Team,
  employees: Employee[],
  contextMessages: ChatMessage[],
  extraInstruction: string,
  onToolCall: (toolName: string, toolArgs: string, result: string, success?: boolean, protocolEvidence?: ConnectorProtocolResult, structuredEvidence?: ToolExecutionEvidence) => void,
  attachments?: import('../data/hermesClient').Attachment[],
  skillContext = '',
  workspaceId?: string,
  shouldStop?: () => boolean,
  requireFileOutput = false,
  requireReviewDecision = false,
  consumeSteeringMessages?: () => string[],
  getModelRequestSignal?: () => AbortSignal,
  onSteeringReply?: (content: string, tokens?: number, contextUsage?: ContextUsage) => void,
  initialExecutionState?: ExecutionControllerSnapshot,
  onExecutionState?: (state: ExecutionControllerSnapshot) => void,
  executionRouteScope?: string,
  onTextDelta?: (accumulated: string) => void,
  onAutonomousDecision?: (toolName: string, toolArgs: string) => Promise<void> | void,
): Promise<{ text: string; tokens?: number; contextUsage?: ContextUsage; failed?: boolean; checkpointed?: boolean; producedFile?: boolean; reviewDecision?: ReviewSubmissionEvidence; executionState?: ExecutionControllerSnapshot }> {
  const effectiveModel = getEmployeeModel(emp);
  if (!resolveApiBase(effectiveModel)) {
    return { text: `⚠️ ${emp.name} 未配置可用模型，当前步骤没有执行。请在设置中为该成员或全局激活模型填写 API 地址和密钥后点击继续执行。`, failed: true };
  }

  const duty = ROLE_DUTY[emp.role] ?? ROLE_DUTY.custom;
  const persona = emp.prompt?.trim() || `你是「${emp.name}」，${emp.title}。`;
  const workspaceTruth = workspaceId
    ? '\n\n当前任务工作区已经建立，统一工具会把 write_file、read_file、list_files 和 run_command 绑定到该工作区。尚未产生文件不等于没有入口；必须实际调用工具，并在失败时报告真实错误。'
    : '\n\n当前没有建立正式任务工作区；不要伪称已经写入或运行文件。';
  const system = `${persona}\n\n${duty}\n\n你正在团队群聊中协作。先判断任务是否需要专业 Skill：只有当 Skill 能明显提高质量或提供必要流程时，才调用 search_skills；比较候选后只读取最匹配的 Skill。没有合适 Skill 时直接使用通用能力和其他工具，不要为了留下调用记录而强行调用。若工具失败，说明失败原因并选择重试、替代工具或继续执行。${workspaceTruth}${requireFileOutput ? '\n\n本步骤的交付类型是文件：在最终回复前必须调用 write_file 保存可交接的真实文件。没有成功写入并验证文件就不算完成。' : '\n\n本步骤不强制生成文件；按任务合同提供回答、连接、操作或决策证据，不要为了过门禁写无意义文件。'}${requireReviewDecision ? '\n\n本步骤是正式审查：必须先用 list_files/read_file 或运行工具检查真实交付物，再调用 submit_review 提交 PASS 或 REJECT。聊天中的口头结论不进入任务状态；REJECT 时尽量填写责任步骤或责任员工。' : ''}\n\n完成后简短总结实际结果和验收证据，便于队友接续。\n\n${BEGINNER_RESPONSE_GUIDE}`;

  // 多模态：把图片附件拼到用户指令上
  const imageParts = (attachments ?? [])
    .filter((a) => a.kind === 'image' && a.dataUrl)
    .map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl! } }));
  const userTurn: ChatTurn = imageParts.length > 0
    ? { role: 'user', content: [{ type: 'text', text: `[指令] ${extraInstruction}` }, ...imageParts] }
    : { role: 'user', content: `[指令] ${extraInstruction}` };

  let handoffContext = '';
  let producedFile = false;
  let reviewDecision: ReviewSubmissionEvidence | undefined;
  let latestExecutionState = initialExecutionState;
  let lastStreamUpdateAt = 0;
  try {
    if (/读取并继承|审查|修订/u.test(extraInstruction)) {
      const listArgs = JSON.stringify({ filter: '' });
      await onAutonomousDecision?.('list_files', listArgs);
      onToolCall('list_files', listArgs, '');
      const listed = await executeTool({ id: `handoff-list-${Date.now()}-${emp.id}`, name: 'list_files', args: { filter: '' }, scope: `team:${team.id}`, workspaceId });
      onToolCall('list_files', listArgs, listed.output, listed.success);
      const filenames = [...listed.output.matchAll(/^- ([^/\n]+?) \(/gmu)].map((match) => match[1]).slice(-3);
      const fileContents: string[] = [];
      for (const filename of filenames) {
        const readArgs = JSON.stringify({ path: filename });
        await onAutonomousDecision?.('read_file', readArgs);
        onToolCall('read_file', readArgs, '');
        const read = await executeTool({ id: `handoff-read-${Date.now()}-${emp.id}-${filename}`, name: 'read_file', args: { path: filename }, scope: `team:${team.id}`, workspaceId });
        onToolCall('read_file', readArgs, read.output, read.success);
        if (read.success) fileContents.push(read.output);
      }
      handoffContext = `前序成员的团队工作区清单：\n${listed.output}\n\n已读取的最新产出：\n${fileContents.join('\n\n') || '暂无可读文件，必须要求前序步骤形成真实产出。'}`;
    }
    const effectiveContext = [emp.soul, skillContext, handoffContext].filter(Boolean).join('\n\n').slice(0, 40000);
    const r = await runAgentLoop({
      turns: [
        { role: 'system', content: system },
        ...buildContext(contextMessages, employees),
        userTurn,
      ],
      tools: getRegisteredTools(),
      scene: 'team',
      label: `${team.name}/${emp.name}`,
      modelConfig: effectiveModel,
      extraSystemContext: effectiveContext,
      scope: `team:${team.id}` as any,
      workspaceId,
      async onToolCall(name, args) {
        await onAutonomousDecision?.(name, args);
        onToolCall(name, args, '');
      },
      onToolResult(name, args, result, success, protocolEvidence, structuredEvidence) {
        if (structuredEvidence?.artifacts?.some((artifact) => artifact.verified)) producedFile = true;
        if (structuredEvidence?.review) reviewDecision = structuredEvidence.review;
        onToolCall(name, args, result, success, protocolEvidence, structuredEvidence);
      },
      onModelRetry(_attempt, _maxAttempts, error) {
        onToolCall('model_summary', '', error, false);
      },
      onTextDelta(_delta, accumulated) {
        const now = Date.now();
        if (now - lastStreamUpdateAt < 200) return;
        lastStreamUpdateAt = now;
        onTextDelta?.(accumulated);
      },
      shouldStop,
      consumeSteeringMessages,
      getModelRequestSignal,
      initialExecutionState,
      onExecutionState(state) {
        latestExecutionState = state;
        onExecutionState?.(state);
      },
      executionRouteScope,
      onSteeringReply(content, usage, contextUsage) {
        onSteeringReply?.(content, usage.totalTokens || undefined, contextUsage);
      },
    });
    if (requireFileOutput && !producedFile) {
      latestExecutionState = observeExecutionResult(r.executionState, {
        toolName: 'acceptance_check', routeKey: `${executionRouteScope ?? emp.id}:required-file`, success: false,
        result: '验收未通过：没有生成可交接文件', contributesEvidence: false,
      });
      latestExecutionState = blockExecution(latestExecutionState, '当前交付步骤没有生成要求的真实文件，验收未通过。', 'business');
      onExecutionState?.(latestExecutionState);
      return { text: `⚠️ ${emp.name} 没有生成可交接文件，本步骤未完成。系统会保留上下文并要求补交实际产出。`, tokens: r.usage.totalTokens, contextUsage: r.contextUsage, failed: true, executionState: latestExecutionState };
    }
    const controllerBlocked = r.executionState.status === 'awaiting_user' || r.executionState.status === 'blocked' || r.executionState.status === 'stopped';
    const controllerCheckpointed = r.executionState.status === 'checkpointed';
    return { text: r.content, tokens: r.usage.totalTokens, contextUsage: r.contextUsage, producedFile, reviewDecision, failed: controllerBlocked, checkpointed: controllerCheckpointed, executionState: r.executionState };
  } catch (e: any) {
    const raw = e?.message ?? '模型错误';
    const reason = e?.name === 'AbortError' || /aborted|signal is aborted/iu.test(raw)
      ? '模型请求超过 30 秒未返回，已自动中止；可点击继续执行重试，任务上下文会保留'
      : raw;
    const contextChars = contextMessages.slice(-12).reduce((total, message) => total + Math.min(message.content.length, 3500), 0) + Math.min(skillContext.length + handoffContext.length + (emp.soul?.length ?? 0), 40000);
    const diagnosis = await diagnoseModel(effectiveModel, { contextChars });
    if (latestExecutionState?.status === 'running') {
      latestExecutionState = blockExecution(latestExecutionState, '模型请求已经完成自动重试，但仍没有返回可供后续步骤使用的结果。', 'timeout');
      onExecutionState?.(latestExecutionState);
    }
    return { text: `⚠️ ${emp.name} 无法响应：${reason}\n\n${diagnosis}`, failed: true, executionState: latestExecutionState };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function parseMentionIds(content: string, team: Team, employees: Employee[]): string[] {
  const names = new Set(team.memberIds.map((id) => employees.find((employee) => employee.id === id)?.name).filter(Boolean));
  return [...content.matchAll(/@([^@\s，。！？!?：:；;、]+)/g)].map((match) => {
    const employee = employees.find((item) => names.has(item.name) && item.name === match[1]);
    return employee?.id;
  }).filter((id): id is string => !!id);
}

export interface TeamMentionReplyOptions {
  employeeId: string;
  userText: string;
  triggerMessageId?: string;
  discussionId?: string;
  attachments?: import('../data/hermesClient').Attachment[];
  workspaceId?: string;
  extraSystemContext?: string;
  onToolCall?: (toolName: string, toolArgs: string, result: string, success?: boolean, protocolEvidence?: ConnectorProtocolResult, structuredEvidence?: ToolExecutionEvidence) => void;
}

export interface TeamMentionReplyResult {
  employee: Employee;
  text: string;
  mentions: string[];
  tokens?: number;
  contextUsage?: ContextUsage;
  toolCalls: number;
}

/**
 * Answer a direct @ mention without creating a task run. This is intentionally
 * separate from the formal step runner: status questions and follow-ups must
 * still work after a previous task has completed, and they must not be forced
 * to create a file or enter the task acceptance pipeline.
 */
export async function runTeamMentionReply(
  team: Team,
  employees: Employee[],
  opts: TeamMentionReplyOptions,
): Promise<TeamMentionReplyResult> {
  const employee = employees.find((item) => item.id === opts.employeeId && team.memberIds.includes(item.id));
  if (!employee) throw new Error('被@的员工不在当前团队中');
  const contextMessages = [...team.chatMessages];
  if (opts.triggerMessageId && !contextMessages.some((message) => message.id === opts.triggerMessageId)) {
    contextMessages.push({
      id: opts.triggerMessageId,
      authorId: 'human',
      roleId: 'human',
      content: opts.userText,
      mentions: [employee.id],
      timestamp: Date.now(),
      kind: 'text',
    });
  }
  let toolCalls = 0;
  const result = await memberSpeak(
    employee,
    team,
    employees,
    contextMessages,
    `这是一次普通的团队点名对话，不是新建正式任务。老板直接@了你，请结合上面的团队上下文直接回答当前问题。不要擅自创建任务、安排其他成员或生成文件；只有老板明确要求你执行具体工作时才说明下一步。回复简洁、具体，不要以“收到/好的/明白”开头。\n\n老板消息：\n「${opts.userText}」`,
    (toolName, toolArgs, resultText, success, protocolEvidence, structuredEvidence) => {
      toolCalls += 1;
      opts.onToolCall?.(toolName, toolArgs, resultText, success, protocolEvidence, structuredEvidence);
    },
    opts.attachments,
    opts.extraSystemContext ?? '',
    opts.workspaceId,
  );
  return {
    employee,
    text: result.text.trim() || `我暂时没有可用的回复，请稍后再@我。`,
    mentions: parseMentionIds(result.text, team, employees),
    tokens: result.tokens,
    contextUsage: result.contextUsage,
    toolCalls,
  };
}

export async function runTeamDiscussion(
  team: Team,
  employees: Employee[],
  opts: TeamDiscussionOptions,
  handlers: DiscussionHandlers,
  control?: { shouldStop?: () => boolean; consumeSteeringMessages?: () => string[]; getModelRequestSignal?: () => AbortSignal }
): Promise<void> {
  const task = opts.task;
  const plannedMembers = opts.participantPlan?.map((plan) => employees.find((employee) => employee.id === plan.memberId)).filter((employee): employee is Employee => !!employee);
  const participants = plannedMembers?.length ? plannedMembers : (['pm', 'planner', 'coder', 'checker'] as const).map((role) => memberByRole(team, employees, role)).filter((employee): employee is Employee => !!employee);
  const useAI = participants.some((employee) => !!resolveApiBase(getEmployeeModel(employee)));
  const contextMessages: ChatMessage[] = [...team.chatMessages];
  const pending = [...new Set([
    ...(opts.forcedMemberIds ?? []),
    ...(opts.participantPlan ?? []).map((plan) => plan.memberId),
  ])];
  const maxRounds = opts.maxRounds ?? 8;

  const laneOf: Record<string, TaskLane | null> = {
    pm: null, planner: 'PLANNING', coder: 'CODING', checker: 'REVIEW',
  };

  let round = 0;
  let revisionCount = 0;
  let runFailed = false;
  const maxRevisions = 2;
  let sharedExecutionState = opts.initialExecutionState ?? createExecutionController({
    goal: opts.userText ?? task?.description ?? task?.title ?? '完成团队任务',
    acceptanceCriteria: ['完成用户要求', '形成真实可观察结果', '通过最终验收'],
    requiresEvidence: true,
  });
  handlers.onExecutionState?.(sharedExecutionState);
  if (!useAI) {
    handlers.onRunFailed?.('团队成员没有可用模型配置，任务未执行。请在设置中激活全局模型或为成员选择模型后点击继续执行。');
    handlers.onStatus('');
    handlers.onDone();
    return;
  }
  const fallbackSteps: TaskPlanStep[] = (pending.length > 0 ? pending : participants.map((employee) => employee.id)).map((employeeId, index) => ({
    id: `legacy-step-${Date.now()}-${index}-${employeeId}`, employeeId, order: index + 1, kind: 'work',
    title: employees.find((item) => item.id === employeeId)?.name ?? '团队成员',
    assignment: '直接完成老板交代的任务并提交真实结果。', dependsOnStepIds: [],
  }));
  const queue: TaskPlanStep[] = (opts.runSteps?.length ? opts.runSteps : fallbackSteps).map((step) => ({
    id: step.id, employeeId: step.employeeId, order: step.order, kind: step.kind, title: step.title,
    assignment: step.assignment, dependsOnStepIds: step.dependsOnStepIds, revisionOfStepId: step.revisionOfStepId,
  }));
  // Keep the legacy rendering shape, but enforce dependencies before a member runs.
  const queuedStepIds = new Set(queue.map((step) => step.id));
  const completedStepIds = new Set(
    queue.flatMap((step) => step.dependsOnStepIds).filter((stepId) => !queuedStepIds.has(stepId)),
  );
  const completedWorkSteps: TaskPlanStep[] = [];
  let latestGuidance = '';
  const executionLimit = Math.max(maxRounds, queue.length) + maxRevisions * 2;
  while (queue.length > 0 && round < executionLimit) {
    if (control?.shouldStop?.()) break;
    const stepGuidance = control?.consumeSteeringMessages?.() ?? [];
    if (stepGuidance.length) latestGuidance = stepGuidance.join('\n');
    const readyIndex = queue.findIndex((candidate) => candidate.dependsOnStepIds.every((dependency) => completedStepIds.has(dependency)));
    if (readyIndex < 0) {
      runFailed = true;
      handlers.onRunFailed?.('任务步骤存在未完成的前置依赖，已停止继续执行，避免跳过上一步结果。');
      break;
    }
    const [step] = queue.splice(readyIndex, 1);
    const emp = employees.find((employee) => employee.id === step.employeeId) ?? participants.find((employee) => employee.id === step.employeeId);
    if (!emp) continue;
    const role = emp.role;

    handlers.onStepStart?.(step.id, emp);
    handlers.onStatus(`${emp.name} 正在思考…`);
    let content = '';
    let tokens: number | undefined;
    let contextUsage: ContextUsage | undefined;
    let reviewDecision: ReviewSubmissionEvidence | undefined;

    if (useAI) {
      const reviewResponsibilityIndex = step.kind === 'review'
        ? `\n\n可退回的责任步骤：\n${completedWorkSteps.map((item) => `- 步骤 ${item.id}；员工 ${item.employeeId}；${item.title}`).join('\n') || '- 暂无已完成工作步骤'}\nsubmit_review 退回时优先原样填写 responsibleStepId 和 responsibleEmployeeId。`
        : '';
      const assignment = `${step.assignment}${reviewResponsibilityIndex}\n\n执行规则：先判断是否需要专业 Skill；需要时自主搜索、比较并读取最合适的 Skill，不需要时直接推进。按交付类型选择真实工具或可核对回答，禁止只口头描述尚未执行的安排。`;
      const r = await memberSpeak(emp, team, employees, contextMessages,
        task
          ? `团队接到新任务「${task.title}」${task.description ? `：${task.description}` : ''}。如有必要，可调工具产出文件或用 web_search 查资料。`
          : `${assignment}\n老板的原始要求：\n「${opts.userText ?? ''}」${latestGuidance ? `\n\n老板运行中追加的最新指令（优先执行）：\n「${latestGuidance}」` : ''}`,
        (toolName, toolArgs, result, success, protocolEvidence, structuredEvidence) => {
          const argsStr = toolArgs ? (toolArgs.length > 80 ? toolArgs.slice(0, 80) + '…' : toolArgs) : '';
          handlers.onToolCall(emp, toolName, argsStr, result || '🔄 执行中…', step.id, success, protocolEvidence, structuredEvidence);
        },
        // 所有被调度成员都能读取同一批用户图片，避免交接后丢失视觉上下文。
        opts.attachments,
        opts.extraSystemContext,
        opts.workspaceId,
        control?.shouldStop,
        step.deliverableType === 'file' || step.deliverableType === 'mixed',
        step.kind === 'review',
        control?.consumeSteeringMessages,
        control?.getModelRequestSignal,
        (reply, replyTokens, replyContextUsage) => handlers.onSteeringReply?.(emp, reply, replyTokens, replyContextUsage, step.id),
        sharedExecutionState,
        (state) => {
          sharedExecutionState = state;
          handlers.onExecutionState?.(state, emp, step.id);
        },
        `${opts.runId ?? opts.discussionId ?? team.id}:${step.id}`,
        (accumulated) => handlers.onTextDelta?.(emp, accumulated, step.id),
        (toolName, toolArgs) => handlers.onAutonomousDecision?.(emp, step.id, toolName, toolArgs),
      );
      if (r.executionState) sharedExecutionState = r.executionState;
      content = r.text;
      tokens = r.tokens;
      contextUsage = r.contextUsage;
      reviewDecision = r.reviewDecision;
      if (r.failed) {
        const failureMentions = parseMentionIds(content, team, employees);
        round += 1;
        contextMessages.push({ id: `context-${Date.now()}-${round}`, authorId: emp.id, roleId: emp.role, content, mentions: failureMentions, timestamp: Date.now(), discussionRound: round });
        handlers.onMessage(emp, content, failureMentions, tokens, round, opts.triggerMessageId, step.id, contextUsage);
        handlers.onRunFailed?.(`${emp.name} 当前步骤未返回结果，任务已暂停：${content.slice(0, 600)}`);
        runFailed = true;
        break;
      }
      if (r.checkpointed) {
        const checkpointMentions = parseMentionIds(content, team, employees);
        round += 1;
        contextMessages.push({ id: `context-${Date.now()}-${round}`, authorId: emp.id, roleId: emp.role, content, mentions: checkpointMentions, timestamp: Date.now(), discussionRound: round });
        handlers.onMessage(emp, content, checkpointMentions, tokens, round, opts.triggerMessageId, step.id, contextUsage);
        handlers.onRunCheckpointed?.(`${emp.name} 当前执行周期已保存容量检查点：${content.slice(0, 600)}`);
        break;
      }
    }

    const mentions = parseMentionIds(content, team, employees);
    round += 1;
    contextMessages.push({
      id: `context-${Date.now()}-${round}`,
      authorId: emp.id,
      roleId: emp.role,
      content,
      mentions,
      timestamp: Date.now(),
      discussionRound: round,
    });
    handlers.onMessage(emp, content, mentions, tokens, round, opts.triggerMessageId, step.id, contextUsage);

    if (step.kind !== 'review') completedWorkSteps.push(step);
    if (step.kind === 'review') {
      const passed = reviewDecision?.decision === 'pass';
      const reason = reviewDecision?.reason ?? '审查者没有调用 submit_review 提交结构化结论，不能视为验收通过';
      const responsibleEmployee = reviewDecision?.responsibleEmployeeId
        ? employees.find((item) => item.id === reviewDecision?.responsibleEmployeeId)
        : undefined;
      const targetStep = (reviewDecision?.responsibleStepId
        ? completedWorkSteps.find((item) => item.id === reviewDecision?.responsibleStepId)
        : undefined)
        ?? [...completedWorkSteps].reverse().find((item) => item.employeeId === responsibleEmployee?.id)
        ?? [...completedWorkSteps].reverse().find((item) => item.kind !== 'review' && item.employeeId !== emp.id);
      const targetEmployeeId = responsibleEmployee?.id ?? targetStep?.employeeId;
      handlers.onReviewDecision?.(step.id, passed, reason, targetEmployeeId, targetStep?.id, reviewDecision);
      if (!passed) {
        if (!targetEmployeeId || revisionCount >= maxRevisions) {
          runFailed = true;
          handlers.onRunFailed?.(revisionCount >= maxRevisions ? `审查连续退回 ${maxRevisions} 次，任务已暂停等待人工处理。` : '审查未通过，但无法定位责任步骤。');
          break;
        }
        revisionCount += 1;
        const targetEmployee = employees.find((item) => item.id === targetEmployeeId)!;
        const revisionStep: TaskPlanStep = {
          id: `revision-${Date.now()}-${revisionCount}-${targetEmployeeId}`, employeeId: targetEmployeeId,
          order: round + 1, kind: 'revision', title: `${targetEmployee.name} · 第 ${revisionCount} 次修订`,
          assignment: `审查未通过。问题：${reason}。读取你之前的产出和审查意见，只修改责任范围内的问题并重新提交，不要重做无关步骤。`,
          dependsOnStepIds: [step.id], revisionOfStepId: targetStep?.id,
        };
        const reviewAgain: TaskPlanStep = {
          ...step, id: `review-${Date.now()}-${revisionCount}-${emp.id}`, order: round + 2,
          title: `${emp.name} · 修订后复审`, dependsOnStepIds: [revisionStep.id],
        };
        handlers.onStepAdded?.(revisionStep);
        handlers.onStepAdded?.(reviewAgain);
        queue.unshift(revisionStep, reviewAgain);
      }
    }

    completedStepIds.add(step.id);

    if (task) {
      const lane = laneOf[role];
      if (lane) handlers.onTaskAdvance(task.id, lane);
    }
    await sleep(useAI ? 300 : 500);
  }

  // 任务收尾
  if (task && !runFailed && !control?.shouldStop?.()) {
    const pm = memberByRole(team, employees, 'pm');
    if (pm) {
      handlers.onStatus(`${pm.name} 验收中…`);
      let closing = '';
      let pmTokens: number | undefined;
      let pmContextUsage: ContextUsage | undefined;
      if (useAI) {
        const r = await memberSpeak(pm, team, employees, contextMessages,
          `任务「${task.title}」已完成开发与审查，请做验收总结。如果代码或文档已产出，可直接 read_file 检查。`,
          (toolName, toolArgs) => handlers.onToolCall(pm, toolName, toolArgs, '🔄 执行中…'),
          undefined,
          '',
          opts.workspaceId,
        );
        closing = r.text;
        pmTokens = r.tokens;
        pmContextUsage = r.contextUsage;
      } else {
        await sleep(600);
        closing = '验收通过，任务交付 🎉 大家辛苦。';
      }
      handlers.onMessage(pm, closing, parseMentionIds(closing, team, employees), pmTokens, Math.min(maxRounds, round + 1), opts.triggerMessageId, undefined, pmContextUsage);
      handlers.onTaskAdvance(task.id, 'DONE');
    }
  }

  // 从讨论中提炼用户洞察（如果讨论由用户发起且有有效内容）
  if (opts.userText && opts.userText.trim().length > 5 && resolveApiBase()) {
    const discussionText = team.chatMessages.slice(-20).map(m => {
      const emp = employees.find(e => e.id === m.authorId);
      return `${emp?.name ?? m.roleId}: ${m.content.slice(0, 150)}`;
    }).join('\n');
    if (discussionText.length > 200) {
      extractUserInsights(
        `用户说：${opts.userText}\n\n团队讨论：\n${discussionText}`,
        `团队讨论-${team.name}`
      ).catch(() => {});
    }
  }

  handlers.onStatus('');
  handlers.onDone();
}
