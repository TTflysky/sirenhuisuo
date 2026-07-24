import type { Employee, Team, ChatMessage, TeamTask, TaskLane, DiscussionParticipantPlan, TaskRunStep, TaskPlanStep } from '../types';
import { runAgentLoop, resolveApiBase, extractUserInsights, getEmployeeModel, type ChatTurn } from '../data/hermesClient';
import { TOOLS, executeTool } from './tools';
import { diagnoseModel } from '../diagnostics/modelDiagnostics';

// ===== 讨论回调 =====
export interface DiscussionHandlers {
  onMessage: (emp: Employee, content: string, mentions: string[], tokens?: number, discussionRound?: number, inReplyToMessageId?: string, stepId?: string) => void;
  onToolCall: (emp: Employee, toolName: string, toolArgs: string, result: string, stepId?: string) => void;
  onTaskAdvance: (taskId: string, lane: TaskLane) => void;
  onStatus: (text: string) => void;
  onDone: () => void;
  onStepStart?: (stepId: string, emp: Employee) => void;
  onStepAdded?: (step: TaskPlanStep) => void;
  onReviewDecision?: (stepId: string, approved: boolean, reason?: string, responsibleEmployeeId?: string) => void;
  onRunFailed?: (error: string) => void;
}

export interface TeamDiscussionOptions {
  task?: TeamTask;
  userText?: string;
  attachments?: import('../data/hermesClient').Attachment[];
  extraSystemContext?: string;
  participantPlan?: DiscussionParticipantPlan[];
  triggerMessageId?: string;
  discussionId?: string;
  maxRounds?: number;
  forcedMemberIds?: string[];
  runId?: string;
  runSteps?: TaskRunStep[];
}

// 角色在讨论中的职责描述（系统提示词扩展）
const ROLE_DUTY: Record<string, string> = {
  pm: `你是团队协调者（PM）。你的工具：write_file(输出文档)、read_file(读已有文件)、list_files(查看产出物)、web_search(搜索资料)。
使用方式：需要产出文件时调 write_file，需要查资料时调 web_search。
典型流程：接到任务 → web_search 查资料 → write_file 输出需求文档/PRD → @相关成员。
发言简洁，像真实同事对话。每次工具调用后会立刻得到结果供你参考。`,
  planner: `你是规划者（Planner/架构师）。你的工具：read_file(读PM的需求文档)、web_search(查技术方案)、write_file(输出架构方案)。
使用方式：先 read_file 看有没有已有文档，再 write_file 输出技术方案（.md文件）、架构图说明或接口定义。
发言务实，给出清晰的实现步骤，让编码者能直接照着写。`,
  coder: `你是编码者（Coder/实现工程师）。你的工具：write_file(写代码文件)、read_file(读方案文档)、list_files(查看项目目录)、web_search(查API文档)。
使用方式：read_file 读方案 → write_file 输出代码文件（.html/.js/.tsx等）→ 告知审查者验收。
代码文件是真正可运行的，写完整、可执行。`,
  checker: `你是审查者（Checker/QA）。你的工具：read_file(读代码审查)、list_files(查看文件)、web_search(查安全标准)。
使用方式：read_file 读代码 → 审查正确性/安全/性能 → 给出验收结论。严谨、具体。`,
  custom: '你是团队的一员。可用工具包括 write_file/read_file/list_files/web_search。根据自己的身份牌职责参与协作。',
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
  onToolCall: (toolName: string, toolArgs: string, result: string) => void,
  attachments?: import('../data/hermesClient').Attachment[],
  skillContext = '',
  shouldStop?: () => boolean,
  requireFileOutput = false
): Promise<{ text: string; tokens?: number; failed?: boolean; producedFile?: boolean }> {
  const effectiveModel = getEmployeeModel(emp);
  if (!resolveApiBase(effectiveModel)) {
    return { text: `⚠️ ${emp.name} 未配置可用模型，当前步骤没有执行。请在设置中为该成员或全局激活模型填写 API 地址和密钥后点击继续执行。`, failed: true };
  }

  const duty = ROLE_DUTY[emp.role] ?? ROLE_DUTY.custom;
  const persona = emp.prompt?.trim() || `你是「${emp.name}」，${emp.title}。`;
  const system = `${persona}\n\n${duty}\n\n你正在团队群聊中协作。先判断任务是否需要专业 Skill：只有当 Skill 能明显提高质量或提供必要流程时，才调用 search_skills；比较候选后只读取最匹配的 Skill。没有合适 Skill 时直接使用通用能力和其他工具，不要为了留下调用记录而强行调用。若工具失败，说明失败原因并选择重试、替代工具或继续执行。${requireFileOutput ? '\n\n本步骤是交付步骤：在最终回复前必须调用 write_file 保存可交接的真实文件。没有成功写入文件就不算完成，禁止用“收到”“跟进”“已完成”代替产出。' : ''}\n\n完成后简短总结实际结果，注明已写入或读取的文件名，便于队友接续。`;

  // 多模态：把图片附件拼到用户指令上
  const imageParts = (attachments ?? [])
    .filter((a) => a.kind === 'image' && a.dataUrl)
    .map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl! } }));
  const userTurn: ChatTurn = imageParts.length > 0
    ? { role: 'user', content: [{ type: 'text', text: `[指令] ${extraInstruction}` }, ...imageParts] }
    : { role: 'user', content: `[指令] ${extraInstruction}` };

  let handoffContext = '';
  let producedFile = false;
  try {
    if (/读取并继承|审查|修订/u.test(extraInstruction)) {
      const listArgs = JSON.stringify({ filter: '' });
      onToolCall('list_files', listArgs, '');
      const listed = await executeTool({ id: `handoff-list-${Date.now()}-${emp.id}`, name: 'list_files', args: { filter: '' }, scope: `team:${team.id}` });
      onToolCall('list_files', listArgs, listed.output);
      const filenames = [...listed.output.matchAll(/^- ([^/\n]+?) \(/gmu)].map((match) => match[1]).slice(-3);
      const fileContents: string[] = [];
      for (const filename of filenames) {
        const readArgs = JSON.stringify({ path: filename });
        onToolCall('read_file', readArgs, '');
        const read = await executeTool({ id: `handoff-read-${Date.now()}-${emp.id}-${filename}`, name: 'read_file', args: { path: filename }, scope: `team:${team.id}` });
        onToolCall('read_file', readArgs, read.output);
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
      tools: TOOLS,
      scene: 'team',
      label: `${team.name}/${emp.name}`,
      modelConfig: effectiveModel,
      extraSystemContext: effectiveContext,
      scope: `team:${team.id}` as any,
      onToolCall(name, args) {
        onToolCall(name, args, '');
      },
      onToolResult(name, args, result) {
        if (name === 'write_file' && !/^⚠️/u.test(result)) producedFile = true;
        onToolCall(name, args, result);
      },
      shouldStop,
    });
    if (requireFileOutput && !producedFile) {
      return { text: `⚠️ ${emp.name} 没有生成可交接文件，本步骤未完成。请点击继续执行，系统会保留上下文并要求补交实际产出。`, tokens: r.usage.totalTokens, failed: true };
    }
    return { text: r.content, tokens: r.usage.totalTokens, producedFile };
  } catch (e: any) {
    const raw = e?.message ?? '模型错误';
    const reason = e?.name === 'AbortError' || /aborted|signal is aborted/iu.test(raw)
      ? '模型请求超过 30 秒未返回，已自动中止；可点击继续执行重试，任务上下文会保留'
      : raw;
    const contextChars = contextMessages.slice(-12).reduce((total, message) => total + Math.min(message.content.length, 3500), 0) + Math.min(skillContext.length + handoffContext.length + (emp.soul?.length ?? 0), 40000);
    const diagnosis = await diagnoseModel(effectiveModel, { contextChars });
    return { text: `⚠️ ${emp.name} 无法响应：${reason}\n\n${diagnosis}`, failed: true };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseMentionIds(content: string, team: Team, employees: Employee[]): string[] {
  const names = new Set(team.memberIds.map((id) => employees.find((employee) => employee.id === id)?.name).filter(Boolean));
  return [...content.matchAll(/@([^@\s，。！？!?：:；;、]+)/g)].map((match) => {
    const employee = employees.find((item) => names.has(item.name) && item.name === match[1]);
    return employee?.id;
  }).filter((id): id is string => !!id);
}

export async function runTeamDiscussion(
  team: Team,
  employees: Employee[],
  opts: TeamDiscussionOptions,
  handlers: DiscussionHandlers,
  control?: { shouldStop?: () => boolean }
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
  const completedWorkSteps: TaskPlanStep[] = [];
  const executionLimit = Math.max(maxRounds, queue.length) + maxRevisions * 2;
  while (queue.length > 0 && round < executionLimit) {
    if (control?.shouldStop?.()) break;
    const step = queue.shift()!;
    const emp = employees.find((employee) => employee.id === step.employeeId) ?? participants.find((employee) => employee.id === step.employeeId);
    if (!emp) continue;
    const role = emp.role;

    handlers.onStepStart?.(step.id, emp);
    handlers.onStatus(`${emp.name} 正在思考…`);
    let content = '';
    let tokens: number | undefined;

    if (useAI) {
      const assignment = `${step.assignment}\n\n执行规则：先判断是否需要专业 Skill；需要时自主搜索、比较并读取最合适的 Skill，不需要时直接推进。使用文件、搜索或命令工具完成实际工作，禁止只口头描述安排。`;
      const r = await memberSpeak(emp, team, employees, contextMessages,
        task
          ? `团队接到新任务「${task.title}」${task.description ? `：${task.description}` : ''}。如有必要，可调工具产出文件或用 web_search 查资料。`
          : `${assignment}\n老板的原始要求：\n「${opts.userText ?? ''}」`,
        (toolName, toolArgs, result) => {
          const argsStr = toolArgs ? (toolArgs.length > 80 ? toolArgs.slice(0, 80) + '…' : toolArgs) : '';
          handlers.onToolCall(emp, toolName, argsStr, result || '🔄 执行中…', step.id);
        },
        // 所有被调度成员都能读取同一批用户图片，避免交接后丢失视觉上下文。
        opts.attachments,
        opts.extraSystemContext,
        control?.shouldStop,
        step.kind !== 'review'
      );
      content = r.text;
      tokens = r.tokens;
      if (r.failed) {
        const failureMentions = parseMentionIds(content, team, employees);
        round += 1;
        contextMessages.push({ id: `context-${Date.now()}-${round}`, authorId: emp.id, roleId: emp.role, content, mentions: failureMentions, timestamp: Date.now(), discussionRound: round });
        handlers.onMessage(emp, content, failureMentions, tokens, round, opts.triggerMessageId, step.id);
        handlers.onRunFailed?.(`${emp.name} 当前步骤未返回结果，任务已暂停：${content.slice(0, 600)}`);
        runFailed = true;
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
    handlers.onMessage(emp, content, mentions, tokens, round, opts.triggerMessageId, step.id);

    if (step.kind !== 'review') completedWorkSteps.push(step);
    if (step.kind === 'review') {
      const rejected = /REVIEW_RESULT\s*:\s*REJECT|验收不通过|退回修改/iu.test(content);
      const passed = !rejected && /REVIEW_RESULT\s*:\s*PASS|验收通过/iu.test(content);
      const reason = content.match(/REASON\s*:\s*([^\n]+)/iu)?.[1]?.trim() ?? (passed ? '验收通过' : '审查未给出明确通过结论');
      const responsibleName = content.match(/RESPONSIBLE\s*:\s*([^\n]+)/iu)?.[1]?.trim();
      const responsibleEmployee = responsibleName ? employees.find((item) => responsibleName.includes(item.name)) : undefined;
      const targetStep = [...completedWorkSteps].reverse().find((item) => item.employeeId === responsibleEmployee?.id)
        ?? [...completedWorkSteps].reverse().find((item) => item.kind !== 'review' && item.employeeId !== emp.id);
      const targetEmployeeId = responsibleEmployee?.id ?? targetStep?.employeeId;
      handlers.onReviewDecision?.(step.id, passed, reason, targetEmployeeId);
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
      if (useAI) {
        const r = await memberSpeak(pm, team, employees, contextMessages,
          `任务「${task.title}」已完成开发与审查，请做验收总结。如果代码或文档已产出，可直接 read_file 检查。`,
          (toolName, toolArgs) => handlers.onToolCall(pm, toolName, toolArgs, '🔄 执行中…')
        );
        closing = r.text;
        pmTokens = r.tokens;
      } else {
        await sleep(600);
        closing = '验收通过，任务交付 🎉 大家辛苦。';
      }
      handlers.onMessage(pm, closing, parseMentionIds(closing, team, employees), pmTokens, Math.min(maxRounds, round + 1), opts.triggerMessageId);
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
