import type { ModelConfig, SkillReference } from '../types';
import type { OutputScope } from './outputs';
import type { ConnectorProtocolResult } from '../engine/connectorProtocol.mjs';
import type { ToolExecutionEvidence } from '../engine/executionEvidence.mjs';
import { redactToolArguments } from '../engine/securityBoundary';
import { presentModelFailure } from '../engine/modelFailurePresentation.mjs';
import { createAssistantToolHistoryMessage } from '../engine/modelReasoningCompatibility.mjs';
import {
  canonicalToolCallKey,
  buildFreshWebQuery,
  buildResearchFallback,
  compactToolArgumentsForHistory,
  ensureResearchSourceLinks,
  getToolCallLimit,
  isActionableCapabilityCorrection,
  isExplicitStopSteering,
  isPreparationOnlyTool,
  isResearchOnlyRequest,
  isResearchDeliveryDeflection,
  toolResourceKey,
} from '../engine/agentGuardrails.mjs';
import { createWebArtifactAcceptanceCycle, observeWebArtifactAcceptanceCycle, webArtifactAcceptanceGate } from '../engine/webArtifactAcceptance.mjs';
import {
  AUTONOMOUS_EXECUTION_GUIDE,
  BEGINNER_RESPONSE_GUIDE,
  CAPABILITY_ROUTING_GUIDE,
  EXECUTION_SELF_REVIEW_GUIDE,
  SKILL_RECOVERY_GUIDE,
  WEB_ARTIFACT_ACCEPTANCE_GUIDE,
  buildContinuationGuide,
  getToolStage,
  guardInstallationSummary,
  humanizeExecutionError,
} from './assistantPresentation';
import {
  applyExecutionSteering,
  blockExecution,
  canExecuteRoute,
  createExecutionController,
  evaluateExecutionConclusion,
  executionControllerGuidance,
  markExecutionBudgetReached,
  observeExecutionResult,
  recordExecutionUsage,
  restoreExecutionController,
  type ExecutionControllerSnapshot,
} from '../engine/executionController.mjs';
import { buildTaskContract, type TaskDecision } from '../engine/taskDecisionKernel.mjs';
import { assessTaskCompletion } from '../engine/taskFidelity.mjs';
import {
  assessExplicitResourceCompletion,
  buildExplicitResourceGuidance,
  createExplicitResourceContract,
  validateExplicitResourceToolCall,
} from '../engine/explicitResourceContract.mjs';
import { isSkillInstallOnlyRequest, resolveSkillInstallInput, resolveSkillInstallRequest } from '../engine/skillInstallRouting.mjs';
import { buildTaskLearningContext, recordTaskLearning } from '../engine/taskLearningMemory';
import {
  applySteering as applyTurnSteering,
  buildTurnGuidance,
  compactRuntimeEvidence,
  createTurnRuntime,
  decideRecovery as decideTurnRecovery,
  finalizeTurn as finalizeRuntimeTurn,
  normalizeToolCall as normalizeTurnToolCall,
  observeModelDecision as observeTurnModelDecision,
  observeToolResult as observeTurnToolResult,
  type TurnRuntimeState,
} from '../engine/turnRuntime.mjs';
import {
  createTurnLifecycle,
  recordLifecycleContext,
  recordLifecycleDecision,
  recordLifecycleProgress,
  recordLifecycleSteering,
  recordLifecycleToolFinished,
  recordLifecycleToolStarted,
  synchronizeTurnLifecycle,
  type TurnLifecycleState,
} from '../engine/turnLifecycle.mjs';
import type { Attachment, ChatResult, ChatTurn, ContentPart, ContextUsage, ImagePart, TokenUsage } from './hermesClient';
import type { ToolResult } from '../engine/tools';
import {
  buildPinnedSkillInstruction,
  getUserActionForFailure,
  isAllowedPinnedSkillSource,
  isPinnedSkillRuleDocument,
  pinnedSkillSourcePath,
} from './agentLoopPolicy';

type CompileTaskDecisionFunction = typeof import('./hermesClient').compileTaskDecision;

export interface AgentLoopOpts {
  turns: ChatTurn[];
  tools: any[];
  scene: string;
  label: string;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, args: string, result: string, success?: boolean, protocolEvidence?: ConnectorProtocolResult, structuredEvidence?: ToolExecutionEvidence) => void;
  modelConfig?: ModelConfig;  // 可选员工独立模型配置
  extraSystemContext?: string; // 额外的系统上下文（如 soul.md）
  scope?: OutputScope;        // 产出物作用域
  /** 任务专属磁盘工作区；展示仍按 scope 聚合。 */
  workspaceId?: string;
  /** Explicitly selected skills participate in route enforcement, not only prompt injection. */
  skillRefs?: SkillReference[];
  /** A deterministic binding for follow-up language such as "install it". */
  referenceContext?: string;
  /** Real source URL carried by the bound reference, never inferred by the model. */
  referenceSourceUrl?: string;
  attachments?: Attachment[];  // 用户上传/粘贴的图片附件（多模态视觉）
  shouldStop?: () => boolean;  // 自主执行中断信号（如用户点「停止」）
  waitIfPaused?: () => Promise<void>; // 在模型调用和工具调用之间等待用户继续
  consumeSteeringMessages?: () => string[]; // 运行中追加的老板指令
  getModelRequestSignal?: () => AbortSignal; // 新指令可以中断正在等待的模型响应
  onSteeringReply?: (content: string, usage: TokenUsage, contextUsage?: ContextUsage) => void;
  onModelRetry?: (attempt: number, maxAttempts: number, error: string, nextDelayMs: number) => void;
  /** Public model output stream. Partial text is never completion evidence. */
  onTextDelta?: (delta: string, accumulated: string) => void;
  /** 恢复中的统一执行状态；未提供时从当前用户目标创建。 */
  initialExecutionState?: ExecutionControllerSnapshot;
  /** 每次观察、恢复决策或验收状态变化时通知调用方。 */
  onExecutionState?: (state: ExecutionControllerSnapshot) => void;
  /** 跨聊天与后台 Worker 共享的公开行动生命周期，不包含隐藏思维链。 */
  onTurnLifecycle?: (state: TurnLifecycleState) => void;
  /** Called after intent compilation and before any executable route starts. */
  onTaskPrepared?: (decision: TaskDecision) => Promise<void> | void;
  /** UI control-plane routes may compile once before choosing the executor. */
  taskDecisionCompilation?: Awaited<ReturnType<CompileTaskDecisionFunction>>;
  /** 团队多步骤共享控制器时用于隔离各步骤的同名工具路线。 */
  executionRouteScope?: string;
}

interface AgentLoopDependencies {
  chatCompletion: (...args: any[]) => Promise<any>;
  isUsefulToolOutcome: (...args: any[]) => boolean;
  isConnectorTask: (...args: any[]) => boolean;
  isConnectorSetupRequest: (...args: any[]) => boolean;
  compileTaskDecision: CompileTaskDecisionFunction;
}

export function createRunAgentLoop(deps: AgentLoopDependencies) {
  const {
    chatCompletion,
    isUsefulToolOutcome,
    isConnectorTask,
    isConnectorSetupRequest,
    compileTaskDecision,
  } = deps;

  return async function runAgentLoop(opts: AgentLoopOpts): Promise<{ content: string; usage: TokenUsage; contextUsage?: ContextUsage; model: string; executionState: ExecutionControllerSnapshot; taskDecision: TaskDecision; turnRuntime: TurnRuntimeState; turnFinalization: Record<string, unknown>; turnLifecycle: TurnLifecycleState }> {
  const {
    turns, tools, scene, label, onToolCall, onToolResult, modelConfig, extraSystemContext,
    scope, attachments, shouldStop, waitIfPaused, consumeSteeringMessages,
    getModelRequestSignal, onSteeringReply, onModelRetry, onTextDelta, initialExecutionState, onExecutionState, onTurnLifecycle, onTaskPrepared, taskDecisionCompilation,
  } = opts;
  let currentTurns = [...turns];
  let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let latestContextUsage: ContextUsage | undefined;
  let finalModel = '';
  const userTexts = turns.filter((turn) => turn.role === 'user').map((turn) => typeof turn.content === 'string'
    ? turn.content
    : (turn.content ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text).join('\n'));
  const latestUserText = userTexts.at(-1) ?? '';
  const compiled = taskDecisionCompilation ?? await compileTaskDecision(turns, tools, modelConfig, getModelRequestSignal?.());
  const taskDecision = compiled.decision;
  totalUsage.promptTokens += compiled.usage.promptTokens;
  totalUsage.completionTokens += compiled.usage.completionTokens;
  totalUsage.totalTokens += compiled.usage.totalTokens;
  latestContextUsage = compiled.contextUsage;
  finalModel = compiled.model ?? '';
  const originalUserText = taskDecision.goal;
  const installOnlyTask = isSkillInstallOnlyRequest(originalUserText);
  const explicitSkillInstallRequest = resolveSkillInstallRequest(originalUserText);
  const resumedFromCapabilityCorrection = taskDecision.mode === 'execute'
    && originalUserText !== latestUserText
    && isActionableCapabilityCorrection(latestUserText);
  const isInstallationTask = /安装|装好|装上|安装包|部署/u.test(originalUserText);
  const connectorTask = isConnectorTask(originalUserText) || taskDecision.primaryRoute === 'inspect_connectors';
  const connectorSetupTask = isConnectorSetupRequest(originalUserText) || taskDecision.primaryRoute === 'inspect_connectors';
  const isSkillInstallation = isInstallationTask && !connectorTask
    && (/skill|技能|插件/iu.test(originalUserText) || Boolean(opts.referenceSourceUrl));
  const conversationOnly = taskDecision.mode !== 'execute';
  const pinnedSkillInstall = !conversationOnly && installOnlyTask && isSkillInstallation
    ? resolveSkillInstallInput({ sourceUrl: explicitSkillInstallRequest?.sourceUrl || opts.referenceSourceUrl }, originalUserText)
    : undefined;
  const pinnedSkillSource = !pinnedSkillInstall?.error ? pinnedSkillInstall?.sourceUrl || '' : '';
  const skillDiscoveryNeedsSelection = !explicitSkillInstallRequest?.sourceUrl
    && /(?:找|搜索|搜寻|检索|推荐|find|search)/iu.test(originalUserText)
    && /(?:skill|技能|插件)/iu.test(originalUserText);
  const researchOnlyTask = isResearchOnlyRequest(originalUserText)
    || (taskDecision.primaryRoute === 'web_search'
      && !/(?:安装|部署|开发|修改|修复|创建|生成|保存|下载|上传|提交|打包|配置|接入|连接)/u.test(originalUserText));
  const requiresExecutionEvidence = !conversationOnly && taskDecision.requiresEvidence;
  const taskExperience = conversationOnly ? '' : buildTaskLearningContext(originalUserText);
  const taskContract = buildTaskContract(taskDecision, taskExperience);
  const pinnedSkillInstruction = buildPinnedSkillInstruction(pinnedSkillSource);
  const explicitResourceContract = createExplicitResourceContract(
    `${originalUserText}\n${latestUserText}`,
    opts.referenceSourceUrl ? [opts.referenceSourceUrl] : [],
  );
  const explicitResourceInstruction = buildExplicitResourceGuidance(explicitResourceContract);
  let turnRuntime = createTurnRuntime({
    scope: scope ?? scene,
    goal: originalUserText,
    contract: taskDecision,
  });
  let turnLifecycle = createTurnLifecycle({
    turnId: turnRuntime.turnId,
    scope: scope ?? scene,
    goal: originalUserText,
    deliverableType: turnRuntime.deliverableType,
    contextWindowTokens: modelConfig?.contextWindowTokens,
    maxModelRounds: connectorSetupTask ? 24 : 36,
  });
  const publishTurnLifecycle = () => onTurnLifecycle?.(turnLifecycle);
  if (!conversationOnly) await onTaskPrepared?.(taskDecision);
  publishTurnLifecycle();
  currentTurns = conversationOnly
    ? [{ role: 'system', content: `${taskContract}\n\n当前消息不需要工具执行。直接结合最近上下文回应，不得自动恢复、重放或继续上一项任务。只有用户明确提出新的执行目标或明确要求继续时，才能重新开始执行。` }, ...currentTurns]
    : [{
      role: 'system',
      content: `${taskContract}\n\n${buildTurnGuidance(turnRuntime)}\n\n${AUTONOMOUS_EXECUTION_GUIDE}\n\n${CAPABILITY_ROUTING_GUIDE}\n\n${WEB_ARTIFACT_ACCEPTANCE_GUIDE}\n\n${SKILL_RECOVERY_GUIDE}${pinnedSkillInstruction}${explicitResourceInstruction ? `\n\n${explicitResourceInstruction}` : ''}${resumedFromCapabilityCorrection
        ? `\n\n用户最新消息是在纠正上一轮没有行动的问题。当前仍未完成的目标是：\n${originalUserText.slice(0, 2000)}\n必须立即按纠正后的能力路线执行，不要再次道歉、解释能力或要求用户重复目标。`
        : ''}`,
    }, ...currentTurns];

  // 多模态：把最后一条 user 消息转为 [text, image_url] 数组
  if (attachments && attachments.length > 0) {
    const lastUserIdx = currentTurns.map((t) => t.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      const t = currentTurns[lastUserIdx];
      const textPart: ContentPart = { type: 'text', text: typeof t.content === 'string' ? t.content : '' };
      const imageParts: ImagePart[] = attachments
        .filter((a) => a.kind === 'image' && a.dataUrl)
        .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl! } }));
      if (imageParts.length > 0) {
        currentTurns = currentTurns.map((turn, i) =>
          i === lastUserIdx ? { ...turn, content: [textPart, ...imageParts] } : turn
        );
      }
    }
  }
  const checkpointBaseTurns = [...currentTurns];
  const steeringCheckpointTurns: ChatTurn[] = [];

  let finalContent: string | null = null;
  const iterationsPerPhase = connectorSetupTask ? 6 : 8;
  const maxIter = connectorSetupTask ? 24 : 36;
  const maxToolCallsPerPhase = connectorSetupTask ? 8 : 12;
  const maxAutonomousToolPhases = connectorSetupTask ? 2 : 4;
  const maxTotalToolAttempts = connectorSetupTask ? 18 : 48;
  const maxPreparationOnlyStreak = connectorSetupTask ? 5 : 8;
  const callLog: Array<{ name: string; args: string; result: string; success: boolean }> = [];
  const assessCurrentTaskCompletion = (content: string) => {
    const base = assessTaskCompletion(originalUserText, content, callLog);
    const explicit = assessExplicitResourceCompletion(explicitResourceContract, callLog);
    return {
      ...base,
      passed: base.passed && explicit.passed,
      issues: [...base.issues, ...explicit.issues],
    };
  };
  const toolResultCache = new Map<string, { output: string; success: boolean }>();
  const toolCallCounts = new Map<string, number>();
  const resourceReadCounts = new Map<string, number>();
  const failedSkillReads = new Set<string>();
  let pinnedSkillRuleRead = false;
  const successfulCalls = new Set<string>();
  let stopped = false;
  let finalReviewRequested = false;
  let phaseStartSuccessCount = 0;
  let phaseStartLogIndex = 0;
  let stalledPhases = 0;
  let executionBudgetReached = false;
  let toolCallsThisPhase = 0;
  let totalToolAttempts = 0;
  let preparationOnlyStreak = 0;
  let duplicateOrBlockedStreak = 0;
  let completedToolPhases = 0;
  let phaseToolBudgetReached = false;
  let requiredResearchSucceeded = false;
  let requiredResearchOutput = '';
  let researchSummaryFailures = 0;
  let completedInstallOnlyTask = false, completedSkillDiscovery = false, completedWebArtifactTask = false;
  let webArtifactAcceptanceCycle = createWebArtifactAcceptanceCycle();
  const maxResearchSummaryAttempts = 2;
  let executionState = initialExecutionState
    ? restoreExecutionController(initialExecutionState, { goal: originalUserText, acceptanceCriteria: taskDecision.acceptanceCriteria, requiresEvidence: requiresExecutionEvidence, maxAttempts: maxTotalToolAttempts })
    : createExecutionController({
      goal: originalUserText,
      acceptanceCriteria: taskDecision.acceptanceCriteria,
      requiresEvidence: requiresExecutionEvidence,
      maxAttempts: maxTotalToolAttempts,
      maxToolCalls: maxTotalToolAttempts,
      maxModelCalls: maxIter + 8,
      maxRetries: connectorSetupTask ? 8 : 12,
      maxElapsedMs: connectorSetupTask ? 20 * 60 * 1000 : 45 * 60 * 1000,
      maxTokens: connectorSetupTask ? 240_000 : 480_000,
    });
  const publishExecutionState = (next: ExecutionControllerSnapshot) => {
    executionState = next;
    onExecutionState?.(executionState);
  };
  const executionRouteKey = (name: string, argumentsText: string) => `${opts.executionRouteScope ?? scene}:${canonicalToolCallKey(name, argumentsText)}`;
  const observeToolOutcome = (name: string, argumentsText: string, output: string, success: boolean, evidenceKind = 'progress', contributesEvidence = success) => {
    publishExecutionState(observeExecutionResult(executionState, {
      toolName: name,
      routeKey: executionRouteKey(name, argumentsText),
      success,
      result: output,
      contributesEvidence,
      evidenceKind,
    }));
  };
  onExecutionState?.(executionState);

  const respondToSteering = async (initialMessages: string[]): Promise<{ stopped: boolean }> => {
    const pendingMessages = [...initialMessages];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const instruction = pendingMessages.join('\n').trim();
      if (!instruction) return { stopped: false };
      turnRuntime = applyTurnSteering(turnRuntime, instruction);
      turnLifecycle = recordLifecycleSteering(turnLifecycle, pendingMessages);
      publishTurnLifecycle();
      publishExecutionState(applyExecutionSteering(executionState, instruction));
      const userTurn: ChatTurn = {
        role: 'user',
        content: `## 用户刚刚插话（优先于当前计划）\n${instruction}`,
      };
      try {
        const response = await chatCompletion([
          ...currentTurns,
          userTurn,
          {
            role: 'system',
            content: '立刻只回应用户刚刚插入的话。结合已经完成的动作、真实证据和当前阻塞，用通俗中文说明现在的情况、是否会调整原计划以及下一步。不要调用工具，不要复读旧计划，不要声称尚未验证的结果。用户没有明确要求继续时，不得擅自恢复已暂停或已停止的任务。',
          },
        ], scene, `${label} · 处理中回应`, undefined, modelConfig, extraSystemContext, undefined, getModelRequestSignal?.());
        totalUsage.promptTokens += response.usage.promptTokens;
        totalUsage.completionTokens += response.usage.completionTokens;
        totalUsage.totalTokens += response.usage.totalTokens;
        publishExecutionState(recordExecutionUsage(executionState, { modelCalls: 1, tokens: response.usage.totalTokens }));
        latestContextUsage = response.contextUsage;
        if (!finalModel) finalModel = response.model;

        const newerMessages = consumeSteeringMessages?.() ?? [];
        if (newerMessages.length > 0) {
          pendingMessages.push(...newerMessages);
          continue;
        }

        const content = response.content?.trim()
          || '我收到你的新要求了。我会先按最新信息重新判断，不再机械重复刚才的操作。';
        const assistantTurn: ChatTurn = { role: 'assistant', content };
        currentTurns.push(userTurn, assistantTurn);
        steeringCheckpointTurns.push(userTurn, assistantTurn);
        finalReviewRequested = false;
        onSteeringReply?.(content, response.usage, response.contextUsage);
        return { stopped: isExplicitStopSteering(pendingMessages) };
      } catch (error: any) {
        const newerMessages = consumeSteeringMessages?.() ?? [];
        if (error?.name === 'ExternalAbortError' && newerMessages.length > 0) {
          pendingMessages.push(...newerMessages);
          continue;
        }
        if (shouldStop?.()) return { stopped: true };
        const content = '我已经收到你的新要求。当前步骤不会再继续扩展；等模型恢复后，我会从这条最新要求重新判断。';
        currentTurns.push(userTurn, { role: 'assistant', content });
        steeringCheckpointTurns.push(userTurn, { role: 'assistant', content });
        onSteeringReply?.(content, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        return { stopped: isExplicitStopSteering(pendingMessages) };
      }
    }
    return { stopped: isExplicitStopSteering(pendingMessages) };
  };

  for (let iter = 0; iter < maxIter; iter++) {
    // 暂停中的插话会临时唤醒等待者。唤醒后必须先消费最新消息，
    // 不能先让旧计划多跑一次模型或工具调用。
    await waitIfPaused?.();
    if (shouldStop?.()) { stopped = true; break; }
    const atTurnStartGuidance = consumeSteeringMessages?.() ?? [];
    if (atTurnStartGuidance.length > 0) {
      const steering = await respondToSteering(atTurnStartGuidance);
      if (steering.stopped) { stopped = true; break; }
      continue;
    }
    if (phaseToolBudgetReached) {
      if (executionBudgetReached) break;
      const phaseCalls = callLog.slice(phaseStartLogIndex);
      const madeProgress = successfulCalls.size > phaseStartSuccessCount;
      stalledPhases = madeProgress ? 0 : stalledPhases + 1;
      const summaryRows = phaseCalls.slice(-14).map((call, index) => {
        const state = call.success ? '完成' : `未完成（${humanizeExecutionError(call.result)}）`;
        return `${index + 1}. ${getToolStage(call.name)}：${state}`;
      });
      const runtimeSnapshot = compactRuntimeEvidence(turnRuntime);
      const summary = `${summaryRows.length > 0 ? summaryRows.join('\n') : '这一阶段没有产生有效操作。'}\n\n结构化观察：${JSON.stringify(runtimeSnapshot)}`;
      turnLifecycle = recordLifecycleContext(turnLifecycle, {
        compacted: true,
        stage: completedToolPhases + 2,
        summary,
        unresolvedIssues: turnRuntime.unresolvedIssues,
      });
      publishTurnLifecycle();
      if (stalledPhases >= 3 || completedToolPhases >= maxAutonomousToolPhases - 1) {
        executionBudgetReached = true;
        break;
      }
      completedToolPhases += 1;
      currentTurns = [
        ...checkpointBaseTurns,
        ...steeringCheckpointTurns,
        { role: 'system', content: `${buildContinuationGuide(summary, stalledPhases)}\n\n已自动完成第 ${completedToolPhases} 个执行阶段的上下文压缩。不要向用户索要“继续”，请直接从未完成目标进入下一阶段，并优先验证能否换工具、换路径或补齐验收。` },
      ];
      phaseStartSuccessCount = successfulCalls.size;
      phaseStartLogIndex = callLog.length;
      finalReviewRequested = false;
      toolCallsThisPhase = 0;
      phaseToolBudgetReached = false;
      continue;
    }
    if (iter > 0 && iter % iterationsPerPhase === 0) {
      const phaseCalls = callLog.slice(phaseStartLogIndex);
      const madeProgress = successfulCalls.size > phaseStartSuccessCount;
      stalledPhases = madeProgress ? 0 : stalledPhases + 1;
      const summaryRows = phaseCalls.slice(-14).map((call, index) => {
        const state = call.success ? '完成' : `未完成（${humanizeExecutionError(call.result)}）`;
        return `${index + 1}. ${getToolStage(call.name)}：${state}`;
      });
      const runtimeSnapshot = compactRuntimeEvidence(turnRuntime);
      const summary = `${summaryRows.length > 0 ? summaryRows.join('\n') : '这一阶段没有产生有效操作。'}\n\n结构化观察：${JSON.stringify(runtimeSnapshot)}`;
      turnLifecycle = recordLifecycleContext(turnLifecycle, {
        compacted: true,
        stage: Math.floor(iter / iterationsPerPhase) + 2,
        summary,
        unresolvedIssues: turnRuntime.unresolvedIssues,
      });
      publishTurnLifecycle();
      if (stalledPhases >= 3) {
        executionBudgetReached = true;
        break;
      }
      currentTurns = [
        ...checkpointBaseTurns,
        ...steeringCheckpointTurns,
        { role: 'system', content: buildContinuationGuide(summary, stalledPhases) },
      ];
      phaseStartSuccessCount = successfulCalls.size;
      phaseStartLogIndex = callLog.length;
      finalReviewRequested = false;
    }
    let r: ChatResult;
    try {
      const toolsForCall = conversationOnly ? undefined : tools;
      turnLifecycle = recordLifecycleProgress(turnLifecycle, {
        type: 'model_request_started',
        phase: 'observe',
        activity: `正在请求 ${modelConfig?.model || '当前模型'} 判断下一步`,
        modelRounds: 1,
      });
      publishTurnLifecycle();
      r = await chatCompletion(
        currentTurns,
        scene,
        label,
        toolsForCall,
        modelConfig,
        extraSystemContext,
        undefined,
        getModelRequestSignal?.(),
        { onTextDelta },
      );
      const observedDecision = observeTurnModelDecision(turnRuntime, {
        content: r.content,
        toolCalls: r.toolCalls,
      });
      turnRuntime = observedDecision.runtime;
      turnLifecycle = recordLifecycleDecision(turnLifecycle, observedDecision.decision);
      turnLifecycle = recordLifecycleProgress(turnLifecycle, {
        type: 'model_response_received',
        phase: observedDecision.decision.action,
        activity: r.toolCalls?.length ? '模型已返回工具动作，正在执行' : '模型已返回内容，正在核对验收条件',
        estimatedTokens: r.contextUsage?.promptTokens ?? r.usage.promptTokens,
        contextWindowTokens: r.contextUsage?.contextWindowTokens ?? modelConfig?.contextWindowTokens,
      });
      publishTurnLifecycle();
    } catch (error: any) {
      const interruptedMessages = consumeSteeringMessages?.() ?? [];
      if (error?.name === 'ExternalAbortError' && interruptedMessages.length > 0) {
        const steering = await respondToSteering(interruptedMessages);
        if (steering.stopped) { stopped = true; break; }
        continue;
      }
      if (shouldStop?.()) { stopped = true; break; }
      researchSummaryFailures += 1;
      const errorText = error?.message ?? String(error);
      const observedModelFailure = observeTurnToolResult(turnRuntime, {
        toolCallId: `model-request-${researchSummaryFailures}`,
        name: 'model_request',
        args: { model: modelConfig?.model ?? 'active-model', scene },
        success: false,
        useful: false,
        output: errorText,
        kind: 'model',
      });
      turnRuntime = observedModelFailure.runtime;
      const modelRecovery = decideTurnRecovery(turnRuntime, observedModelFailure.error ?? errorText);
      turnRuntime = modelRecovery.runtime;
      turnLifecycle = recordLifecycleProgress(turnLifecycle, {
        type: 'model_request_failed',
        phase: modelRecovery.decision.action === 'waiting_user' ? 'waiting_user' : 'observe',
        activity: modelRecovery.decision.action === 'retry' ? '模型请求未成功，正在按分类恢复' : '模型请求未成功，正在保存恢复现场',
        detail: { errorType: modelRecovery.decision.errorType, action: modelRecovery.decision.action },
      });
      publishTurnLifecycle();
      publishExecutionState(observeExecutionResult(executionState, {
        toolName: 'model_request',
        routeKey: executionRouteKey('model_request', JSON.stringify({ model: modelConfig?.model ?? 'active-model', scene })),
        success: false,
        result: errorText,
        contributesEvidence: false,
        retryLimit: maxResearchSummaryAttempts - 1,
      }));
      if (modelRecovery.decision.action === 'retry' && executionState.decision.kind === 'retry' && researchSummaryFailures < maxResearchSummaryAttempts) {
        const retryDelayMs = 10000;
        onModelRetry?.(researchSummaryFailures, maxResearchSummaryAttempts, errorText, retryDelayMs);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        await waitIfPaused?.();
        if (shouldStop?.()) { stopped = true; break; }
        continue;
      }
      onModelRetry?.(researchSummaryFailures, maxResearchSummaryAttempts, errorText, 0);
      if (modelRecovery.decision.action === 'waiting_user') {
        finalContent = modelRecovery.decision.userMessage;
        publishExecutionState(blockExecution(executionState, modelRecovery.decision.message, executionState.decision.failureClass));
        break;
      }
      if (researchOnlyTask && requiredResearchSucceeded) {
        finalContent = buildResearchFallback(originalUserText, requiredResearchOutput, errorText);
        observeToolOutcome('client_research_fallback', JSON.stringify({ query: buildFreshWebQuery(originalUserText) }), finalContent, true, 'research');
        publishExecutionState(evaluateExecutionConclusion(executionState, { content: finalContent, reviewed: true }));
        break;
      }
      finalContent = `还没有完成。\n\n${presentModelFailure(modelRecovery.decision.errorType)}`;
      publishExecutionState(blockExecution(executionState, '模型请求已完成分类恢复，但仍未返回有效结果。', executionState.decision.failureClass));
      break;
    }
    if (researchSummaryFailures > 0) {
      observeToolOutcome('model_request', JSON.stringify({ model: modelConfig?.model ?? 'active-model', scene }), '模型已恢复并返回有效结果', true, 'model', false);
      researchSummaryFailures = 0;
    }
    totalUsage.promptTokens += r.usage.promptTokens;
    totalUsage.completionTokens += r.usage.completionTokens;
    totalUsage.totalTokens += r.usage.totalTokens;
    publishExecutionState(recordExecutionUsage(executionState, { modelCalls: 1, tokens: r.usage.totalTokens }));
    if (executionState.status === 'blocked' && executionState.budgetStopReason) {
      executionBudgetReached = true;
      break;
    }
    latestContextUsage = r.contextUsage;
    if (!finalModel) finalModel = r.model;

    // HTTP 请求无法在生成中途改写，但返回后必须先吸收最新指令，
    // 不能继续执行已经过时的工具调用或下一步骤。
    const afterCallGuidance = consumeSteeringMessages?.() ?? [];
    if (afterCallGuidance.length) {
      const steering = await respondToSteering(afterCallGuidance);
      if (steering.stopped) { stopped = true; break; }
      continue;
    }

    if (r.toolCalls && r.toolCalls.length > 0) {
      // 模型返回了工具调用：执行，结果加入对话继续
      const { executeAgentTool } = await import('../engine/toolExecutorBridge');
      let iterationHadFailure = false;
      let steeringHandled = false;
      for (const tc of r.toolCalls) {
        await waitIfPaused?.();
        if (shouldStop?.()) { stopped = true; break; }
        const beforeToolGuidance = consumeSteeringMessages?.() ?? [];
        if (beforeToolGuidance.length > 0) {
          const steering = await respondToSteering(beforeToolGuidance);
          if (steering.stopped) stopped = true;
          steeringHandled = true;
          break;
        }
        if (toolCallsThisPhase >= maxToolCallsPerPhase || totalToolAttempts >= maxTotalToolAttempts) {
          phaseToolBudgetReached = true;
          executionBudgetReached = totalToolAttempts >= maxTotalToolAttempts;
          break;
        }
        totalToolAttempts += 1;
        toolCallsThisPhase += 1;
        const normalizedCall = normalizeTurnToolCall(tc.name, tc.arguments);
        let effectiveArguments = normalizedCall.ok ? normalizedCall.argumentsText! : tc.arguments;
        let effectiveCallOk = normalizedCall.ok;
        let effectiveCallError = normalizedCall.error;
        if (tc.name === 'install_skill') {
          const suppliedArgs = normalizedCall.ok && normalizedCall.args && typeof normalizedCall.args === 'object'
            ? normalizedCall.args
            : {};
          // The model can audit the requested package, but it cannot substitute
          // a different package at the final write step.
          const modelArgs = pinnedSkillSource
            ? { ...suppliedArgs, sourceUrl: pinnedSkillSource }
            : suppliedArgs;
          const resolvedInstall = resolveSkillInstallInput(modelArgs, originalUserText);
          if (!resolvedInstall.error) {
            effectiveArguments = JSON.stringify({ ...modelArgs, ...resolvedInstall });
            effectiveCallOk = true;
            effectiveCallError = undefined;
          } else {
            effectiveCallError = resolvedInstall.error;
          }
        }
        const lifecycleArgs = (() => { try { return JSON.parse(effectiveArguments); } catch { return {}; } })();
        turnLifecycle = recordLifecycleToolStarted(turnLifecycle, {
          callId: tc.id,
          name: tc.name,
          args: lifecycleArgs,
          activity: `正在调用 ${getToolStage(tc.name)}`,
        });
        publishTurnLifecycle();
        const cacheKey = canonicalToolCallKey(tc.name, effectiveArguments);
        const routeGate = canExecuteRoute(executionState, { toolName: tc.name, routeKey: executionRouteKey(tc.name, effectiveArguments) });
        const controllerRetry = executionState.decision.kind === 'retry' && executionState.decision.routeId === routeGate.routeId;
        const resourceKey = toolResourceKey(tc.name, effectiveArguments);
        const resourceReadCount = resourceKey ? (resourceReadCounts.get(resourceKey) ?? 0) : 0;
        const toolCallCount = (toolCallCounts.get(tc.name) ?? 0) + 1;
        toolCallCounts.set(tc.name, toolCallCount);
        const cached = controllerRetry ? undefined : toolResultCache.get(cacheKey);
        const repeatedFailedSkillRead = tc.name === 'read_skill' && failedSkillReads.has(cacheKey);
        const resourceLimit = tc.name === 'read_skill' || tc.name === 'read_web_page'
          ? 1
          : tc.name === 'read_file' ? (connectorSetupTask ? 4 : 12) : Number.POSITIVE_INFINITY;
        const toolLimitReached = toolCallCount > getToolCallLimit(tc.name, connectorSetupTask);
        const resourceLimitReached = Boolean(resourceKey) && resourceReadCount >= resourceLimit;
        const explicitResourceGate = validateExplicitResourceToolCall(explicitResourceContract, tc.name, effectiveArguments, callLog);
        const webArtifactGate = webArtifactAcceptanceGate(webArtifactAcceptanceCycle, tc.name);
        const blockedReason = !effectiveCallOk
          ? effectiveCallError ?? '工具参数无效，模型需要修正后再调用。'
          : !explicitResourceGate.allowed
          ? explicitResourceGate.reason
          : webArtifactGate
          ? webArtifactGate
          : pinnedSkillSource && (tc.name === 'search_skills' || tc.name === 'web_search')
          ? '用户已给出明确的 Skill 来源。本次只允许阅读该来源及同仓库配套文件、完成风险判断并安装；禁止搜索候选或替代来源。'
          : pinnedSkillSource && tc.name === 'read_web_page' && !isAllowedPinnedSkillSource(lifecycleArgs.url, pinnedSkillSource)
          ? '当前网页不属于用户指定的 Skill 来源或其同一 GitHub 仓库。不得改读市场页、聚合页或替代来源。'
          : pinnedSkillSource && tc.name === 'run_command' && /(?:npx\s+skills|skills\s+add)/iu.test(String(lifecycleArgs.command ?? lifecycleArgs.cmd ?? ''))
          ? '指定来源安装必须使用原生 install_skill，以便保存完整目录并做原子校验；禁止改走 npx/skills CLI。'
          : pinnedSkillSource && tc.name === 'install_skill' && !/\.zip$/iu.test(pinnedSkillSourcePath(pinnedSkillSource)) && !pinnedSkillRuleRead
          ? '安装前必须先读取用户指定来源中的 SKILL.md，并按其规则判断必要配套文件和风险；不要把市场介绍页或安装说明当成 Skill 正文。'
          : tc.name === 'install_skill' && skillDiscoveryNeedsSelection
          ? '当前任务只要求检索 Skill 候选，用户尚未选择要安装的技能。请展示已找到的候选及来源，等待用户明确选择后再安装；禁止擅自安装或改用其他来源。'
          : !routeGate.allowed
          ? routeGate.reason ?? '执行控制器已阻止重复或无效路线，必须换一种方法。'
          : repeatedFailedSkillRead
          ? '这个 Skill 已经读取失败，已阻止重复尝试。必须改用不同来源、替代工具或明确交接真实缺项。'
          : cached !== undefined
          ? '完全相同的工具调用已经执行过。重复调用不会产生新证据，必须重新判断目标并换路线。'
          : toolLimitReached
          ? `“${getToolStage(tc.name)}”已经达到本任务的合理尝试次数。必须停止这条路线，改用其他工具或根据现有证据向用户说明阻塞。`
          : resourceLimitReached
          ? `同一资源已经读取 ${resourceReadCount} 次，继续读取不会产生新证据。必须开始实际操作、改用其他来源或说明缺少的外部条件。`
          : '';

        let executed = false;
        const result: ToolResult = blockedReason
          ? { toolCallId: tc.id, name: tc.name, success: false, output: blockedReason }
          : await (async () => {
            executed = true;
            onToolCall?.(tc.name, redactToolArguments(effectiveArguments));
            return executeAgentTool({ id: tc.id, name: tc.name, args: (() => { try { return JSON.parse(effectiveArguments); } catch { return {}; } })(), scope, workspaceId: opts.workspaceId });
          })();
        const resultSuccess = executed && isUsefulToolOutcome(tc.name, result.success, result.output, originalUserText);
        webArtifactAcceptanceCycle = observeWebArtifactAcceptanceCycle(webArtifactAcceptanceCycle, {
          name: tc.name,
          args: effectiveArguments,
          output: result.output,
          success: resultSuccess,
          executed,
        });
        const newEvidence = resultSuccess && cached === undefined;
        if (tc.name === 'web_search' && resultSuccess) {
          requiredResearchSucceeded = true;
          requiredResearchOutput = result.output;
        }
        observeToolOutcome(tc.name, effectiveArguments, result.output, resultSuccess, tc.name === 'write_file' ? 'file' : tc.name === 'test_connector' ? 'connection' : 'progress');
        if (resourceKey && executed) resourceReadCounts.set(resourceKey, resourceReadCount + 1);
        if (resultSuccess && tc.name === 'read_web_page' && isPinnedSkillRuleDocument(lifecycleArgs.url, pinnedSkillSource)) {
          pinnedSkillRuleRead = true;
        }
        if (tc.name === 'read_skill' && !resultSuccess) failedSkillReads.add(cacheKey);
        if (newEvidence && !isPreparationOnlyTool(tc.name)) successfulCalls.add(cacheKey);
        if (!newEvidence) iterationHadFailure = true;
        if (executed && cached === undefined) toolResultCache.set(cacheKey, { output: result.output.slice(0, 6000), success: resultSuccess });
        if (executed) onToolResult?.(tc.name, redactToolArguments(effectiveArguments), result.output, resultSuccess, result.protocolEvidence, result.structuredEvidence);
        callLog.push({ name: tc.name, args: effectiveArguments, result: result.output.slice(0, 1200), success: resultSuccess });
        const observedResult = observeTurnToolResult(turnRuntime, {
          toolCallId: tc.id,
          name: tc.name,
          args: (() => { try { return JSON.parse(effectiveArguments); } catch { return effectiveArguments; } })(),
          success: resultSuccess,
          useful: newEvidence,
          output: result.output,
          kind: tc.name === 'write_file' ? 'file' : tc.name === 'test_connector' ? 'connection' : 'tool',
        });
        turnRuntime = observedResult.runtime;
        turnLifecycle = recordLifecycleToolFinished(turnLifecycle, {
          callId: tc.id,
          name: tc.name,
          success: resultSuccess,
          output: result.output,
          errorType: observedResult.error?.type,
          resultRef: observedResult.evidence.resultRef,
          evidenceIds: [observedResult.evidence.evidenceId],
        });
        publishTurnLifecycle();
        if (resultSuccess && tc.name === 'search_skills' && skillDiscoveryNeedsSelection) {
          const acceptance = assessCurrentTaskCompletion(result.output);
          publishExecutionState(evaluateExecutionConclusion(executionState, {
            content: result.output,
            reviewed: true,
            acceptancePassed: acceptance.passed,
            acceptanceIssues: acceptance.issues,
          }));
          finalContent = `已找到以下 Skill 候选，尚未安装。\n\n${result.output}\n\n请直接回复候选名称或发送该技能的详情链接；确认后我只会安装你选中的那一个。`;
          completedSkillDiscovery = true;
          break;
        }
        if (resultSuccess && tc.name === 'install_skill' && installOnlyTask) {
          const acceptance = assessCurrentTaskCompletion(result.output);
          publishExecutionState(evaluateExecutionConclusion(executionState, {
            content: result.output,
            reviewed: true,
            acceptancePassed: acceptance.passed,
            acceptanceIssues: acceptance.issues,
          }));
          if (executionState.status === 'completed') {
            finalContent = `已经安装好了。\n\n${result.output}`;
            completedInstallOnlyTask = true;
            break;
          }
        }
        if (resultSuccess && tc.name === 'verify_web_artifact') {
          const acceptance = assessCurrentTaskCompletion(result.output);
          publishExecutionState(evaluateExecutionConclusion(executionState, { content: result.output, reviewed: true, acceptancePassed: acceptance.passed, acceptanceIssues: acceptance.issues }));
          if (executionState.status === 'completed') {
            const verifiedPath = String(lifecycleArgs.path || '网页产出物');
            finalContent = `已经完成并通过真实网页验收。\n\n文件：${verifiedPath}\n\n桌面与窄屏视口均已实际打开检查，运行错误、横向溢出、元素裁切以及边框和外阴影安全区均通过。`;
            completedWebArtifactTask = true; break;
          }
        }
        if (!resultSuccess && observedResult.error) {
          const recovery = decideTurnRecovery(turnRuntime, observedResult.error);
          turnRuntime = recovery.runtime;
          currentTurns.push({ role: 'system', content: `${buildTurnGuidance(turnRuntime)}\n\n本次失败分类：${recovery.decision.errorType}；恢复动作：${recovery.decision.action}。不要原样重复同一工具参数。` });
          if (recovery.decision.action === 'waiting_user') {
            finalContent = recovery.decision.userMessage;
            executionBudgetReached = true;
            phaseToolBudgetReached = true;
          }
        }

        if (isPreparationOnlyTool(tc.name) && newEvidence) preparationOnlyStreak += 1;
        else if (newEvidence) preparationOnlyStreak = 0;
        if (!executed || cached !== undefined || resourceLimitReached || toolLimitReached) duplicateOrBlockedStreak += 1;
        else if (newEvidence) duplicateOrBlockedStreak = 0;

        if (resultSuccess && tc.name === 'write_file') {
          try {
            const writtenArgs = JSON.parse(effectiveArguments || '{}') as { path?: string };
            const writtenResource = toolResourceKey('read_file', JSON.stringify({ path: writtenArgs.path ?? '' }));
            if (writtenResource) resourceReadCounts.delete(writtenResource);
          } catch {}
        }

        if (preparationOnlyStreak === maxPreparationOnlyStreak) {
          currentTurns.push({
            role: 'system',
            content: `已经连续 ${preparationOnlyStreak} 次只做搜索、检查或读取，没有形成安装、配置、写入、验证等实际结果。现在必须停止继续收集同类资料，重新核对用户最终目标，并在下一步选择：执行一个可验证动作、换一条实现路线，或根据真实证据说明唯一缺少的用户条件。`,
          });
        }
        if (preparationOnlyStreak >= maxPreparationOnlyStreak + 3 || duplicateOrBlockedStreak >= 4) {
          executionBudgetReached = true;
          phaseToolBudgetReached = true;
        }
        if (toolCallsThisPhase >= maxToolCallsPerPhase || totalToolAttempts >= maxTotalToolAttempts) {
          phaseToolBudgetReached = true;
          if (totalToolAttempts >= maxTotalToolAttempts) executionBudgetReached = true;
        }
        // 对 tool output 长度做上限，防止下游模型调用因上下文超长失败
        const truncated = result.output.slice(0, 1500);
        const historyArguments = compactToolArgumentsForHistory(tc.name, effectiveArguments, resultSuccess);
        currentTurns.push(createAssistantToolHistoryMessage(r, [
          { id: tc.id, type: 'function', function: { name: tc.name, arguments: historyArguments } },
        ]) as any);
        currentTurns.push({ role: 'tool', content: truncated, tool_call_id: tc.id } as any);
        // v2 observes a failed Skill call like any other capability failure.
        // The model can discover another tool or source; the client no longer
        // launches an unrelated recovery route behind its back.
        if (shouldStop?.()) { stopped = true; break; } // 用户停止：工具执行后中止
        const afterToolGuidance = consumeSteeringMessages?.() ?? [];
        if (afterToolGuidance.length > 0) {
          const steering = await respondToSteering(afterToolGuidance);
          if (steering.stopped) stopped = true;
          steeringHandled = true;
          break;
        }
      }
      if (stopped) break;
      if (completedInstallOnlyTask) break;
      if (completedSkillDiscovery) break;
      if (completedWebArtifactTask) break;
      if (steeringHandled) continue;
      if (phaseToolBudgetReached) continue;
      if (iterationHadFailure) {
        currentTurns.push({ role: 'system', content: executionControllerGuidance(executionState) });
      }
    } else if (r.content) {
      if (!conversationOnly) {
        const cognitiveOnlyCompletion = !executionState.requiresEvidence && callLog.length === 0;
        const acceptance = assessCurrentTaskCompletion(r.content);
        publishExecutionState(evaluateExecutionConclusion(executionState, {
          content: r.content,
          reviewed: cognitiveOnlyCompletion || finalReviewRequested,
          acceptancePassed: acceptance.passed,
          acceptanceIssues: acceptance.issues,
        }));
        const nextDecision = executionState.decision.kind;
        if (nextDecision === 'verify') {
          currentTurns.push({ role: 'assistant', content: r.content });
          currentTurns.push({ role: 'system', content: `${EXECUTION_SELF_REVIEW_GUIDE}\n\n${executionControllerGuidance(executionState)}` });
          finalReviewRequested = true;
          continue;
        }
        if (nextDecision === 'act' || nextDecision === 'continue' || nextDecision === 'retry' || nextDecision === 'switch_route') {
          currentTurns.push({ role: 'assistant', content: r.content });
          currentTurns.push({ role: 'system', content: executionControllerGuidance(executionState) });
          finalReviewRequested = false;
          continue;
        }
      }
      finalContent = r.content;
      break;
    } else {
      break;
    }
  }

  if (executionBudgetReached && executionState.status === 'running') {
    publishExecutionState(markExecutionBudgetReached(executionState));
  }

  if (researchOnlyTask && requiredResearchSucceeded) {
    const unusableSummary = !finalContent
      || isResearchDeliveryDeflection(finalContent)
      || /(?:没有|未能|无法|不能).{0,18}(?:搜索|检索|查询|实时结果)|卡在.{0,12}(?:查询|搜索)|搜索.{0,12}失败/u.test(finalContent);
    finalContent = unusableSummary
      ? buildResearchFallback(originalUserText, requiredResearchOutput)
      : ensureResearchSourceLinks(finalContent ?? '', originalUserText, requiredResearchOutput);
  }

  const failuresBeforeSummary = callLog.filter((call) => !call.success);
  const answerNeedsNextStep = finalContent != null
    && /还没|没有完成|不能确认|未完成|失败|卡在|没有处理好/u.test(finalContent)
    && !/(?:下一步|你现在(?:需要|可以)|请(?:打开|点击|提供|登录|授权|检查|选择|回复|上传|填写|重新启动))/u.test(finalContent);

  // 到达执行预算或模型留下模糊失败答复时，禁用工具做一次强制交接总结。
  if (!stopped && callLog.length > 0 && (!finalContent || answerNeedsNextStep)) {
    const successfulStages = [...new Set(callLog.filter((call) => call.success).map((call) => getToolStage(call.name)))].slice(-8);
    const failureEvidence = failuresBeforeSummary.slice(-6).map((call, index) =>
      `${index + 1}. 阶段：${getToolStage(call.name)}\n原因摘要：${humanizeExecutionError(call.result)}\n真实反馈：${call.result.slice(0, 700)}`
    ).join('\n\n');
    try {
      const handoff = await chatCompletion([
        { role: 'system', content: `${BEGINNER_RESPONSE_GUIDE}\n\n你现在只负责根据真实执行证据写最终交接，不得调用工具，不得虚构成功。` },
        { role: 'system', content: '内部工具预算、上下文压缩或阶段次数不是用户需要解决的问题。除非确实缺少账号、授权、验证码、文件或业务选择，否则不得要求用户回复“继续”；要明确说明系统已经自动尝试的替代路径。' },
        { role: 'user', content: `用户最初目标：\n${originalUserText.slice(0, 4000)}\n\n已成功的阶段：\n${successfulStages.length ? successfulStages.join('、') : '暂时没有可确认的完成项'}\n\n最近失败证据：\n${failureEvidence || '没有明确失败，但执行预算已经用完。'}\n\n是否达到执行预算：${executionBudgetReached ? '是' : '否'}\n\n请用通俗中文交接，必须包含：\n1. 第一行明确整个目标成功还是没有成功；\n2. 已经完成并保留了什么；\n3. 最后卡在哪一类事情和通俗原因；\n4. 用户现在唯一最省事的下一步，明确点哪里、提供什么或回复什么。\n如果不需要用户提供账号、授权、文件或选择，就直说用户不需要改设置；禁止把“回复继续”当成推进任务的条件。不要只说“重新验收”“请重试”或“查看执行过程”。` },
      ], scene, `${label} · 失败交接`, undefined, modelConfig, extraSystemContext);
      totalUsage.promptTokens += handoff.usage.promptTokens;
      totalUsage.completionTokens += handoff.usage.completionTokens;
      totalUsage.totalTokens += handoff.usage.totalTokens;
      publishExecutionState(recordExecutionUsage(executionState, { modelCalls: 1, tokens: handoff.usage.totalTokens }));
      latestContextUsage = handoff.contextUsage;
      if (!finalModel) finalModel = handoff.model;
      if (handoff.content) finalContent = handoff.content;
    } catch {
      // 模型交接失败时继续使用下方确定性回退，保证用户仍能拿到具体下一步。
    }
  }

  // 工具循环用尽但模型未产出最终文本：只给普通用户看得懂的结果，技术记录由折叠执行过程承载。
  if (!finalContent) {
    if (stopped) {
      finalContent = isInstallationTask
        ? '还没有安装好，任务已经停止。\n\n停止前完成的内容仍然保留。你可以重新发送安装要求，我会从没有完成的步骤继续；详细记录可以在下方“执行过程”中查看。'
        : '还没有完成，任务已经停止。\n\n停止前完成的内容仍然保留。需要时可以重新发送要求，从没有完成的步骤继续；详细记录可以在下方“执行过程”中查看。';
    } else if (callLog.length > 0) {
      const failures = callLog.filter((call) => !call.success);
      const lastCall = callLog.at(-1)!;
      if (failures.length === 0) {
        const connectorVerified = callLog.some((call) => call.success && (call.name === 'test_connector' || (call.name === 'run_command' && /"verification"\s*:\s*(?:true|"true")/iu.test(call.args) && /"connector"\s*:/iu.test(call.args))));
        const connectorPrepared = callLog.some((call) => call.name === 'prepare_connector' && call.success);
        finalContent = connectorSetupTask && !connectorVerified
          ? connectorPrepared
            ? '还没有完成连接器配置。\n\n配置窗口已经打开，现有草稿也已保留，但还需要你填写该服务要求的地址、目录或认证凭据并点击“一键配置”。保存后助手会做真实连接测试，测试通过才算完成。'
            : '还没有完成连接器配置。\n\n目前只完成了连接器状态检查，还没有保存并通过真实连接测试。请按已经打开的配置入口填写必要信息后继续验证。'
          : isSkillInstallation
          ? '目前还不能确认这个技能已经完全可用。\n\n技能相关的操作已经执行完，但还没有拿到“版本正确、必要配置完成、实际调用通过”三项完整验收结果。请让我继续做最后检查；详细记录可以在下方“执行过程”中查看。'
          : isInstallationTask
            ? '目前还不能确认已经完全安装好。\n\n安装相关的操作已经执行完，但还缺最后的版本、配置和实际打开检查。完成这些检查后才能正式确认；详细记录可以在下方“执行过程”中查看。'
            : '已经处理好了。\n\n这次需要的步骤已经全部完成并做了最后检查。你可以直接回到刚才的功能继续使用；详细记录可以在下方“执行过程”中查看。';
      } else if (lastCall.success) {
        const lastFailure = failures.at(-1)!;
        const completedStages = [...new Set(callLog.filter((call) => call.success).map((call) => getToolStage(call.name)))].slice(-5);
        finalContent = `${isInstallationTask ? '还没有安装好' : '还没有完成整个目标'}。\n\n已经完成并保留：${completedStages.length ? completedStages.join('、') : '目前没有可确认的完成项'}。\n\n最后卡在“${getToolStage(lastFailure.name)}”。${humanizeExecutionError(lastFailure.result)}\n\n你现在需要这样做：${getUserActionForFailure(lastFailure.result)}\n\n详细记录可以在下方“执行过程”中逐条展开查看。`;
      } else {
        finalContent = `${isInstallationTask ? '还没有安装好' : '还没有处理好'}。\n\n最后卡在“${getToolStage(lastCall.name)}”这一步。${humanizeExecutionError(lastCall.result)}\n\n你现在需要这样做：${getUserActionForFailure(lastCall.result)}\n\n原始记录可以在下方“执行过程”中逐条展开查看。`;
      }
    } else {
      finalContent = `${isInstallationTask ? '还没有安装好' : '还没有拿到有效结果'}。\n\n这次没有收到可以确认的结果，所以不能把它当作成功。请重新发送一次；如果仍然没有回复，请打开“设置 → 模型”检查当前模型是否可用。`;
    }
  }
  if (failuresBeforeSummary.length > 0 && finalContent
      && /还没|没有完成|不能确认|未完成|失败|卡在|没有处理好/u.test(finalContent)
      && !/(?:下一步|你现在(?:需要|可以)|请(?:打开|点击|提供|登录|授权|检查|选择|回复|上传|填写|重新启动))/u.test(finalContent)) {
    const lastFailure = failuresBeforeSummary.at(-1)!;
    finalContent += `\n\n你现在需要这样做：${getUserActionForFailure(lastFailure.result)}`;
  }
  if (isInstallationTask && !connectorTask) {
    finalContent = guardInstallationSummary(finalContent, originalUserText, callLog.map((call) => call.result).join('\n'));
  }
  if (connectorSetupTask) {
    const connectorVerified = callLog.some((call) => call.success && (call.name === 'test_connector' || (call.name === 'run_command' && /"verification"\s*:\s*(?:true|"true")/iu.test(call.args) && /"connector"\s*:/iu.test(call.args))));
    const connectorPrepared = callLog.some((call) => call.name === 'prepare_connector' && call.success);
    const falselyClaimsReady = /(?:已经|已)(?:成功)?(?:完成|配置|连接|关联)|处理好了|现在可以(?:使用|调用)/u.test(finalContent);
    if (!connectorVerified && falselyClaimsReady) {
      finalContent = connectorPrepared
        ? '还没有完成连接器配置。\n\n配置入口已经准备并打开，但还缺用户必须填写的服务地址、目录或认证凭据，以及保存后的真实连接测试。请在配置窗口填写并点击“一键配置”；测试通过前不会把它说成完成。'
        : '还没有完成连接器配置。\n\n目前没有拿到真实连接测试通过的证据。请先打开对应连接器配置，填写必要信息并保存，然后再进行连接测试。';
    }
  }
  const controllerDidNotComplete = !conversationOnly && executionState.status !== 'completed';
  const falselyClaimsControllerCompletion = /(?:已经|已)(?:成功)?(?:完成|处理|配置|安装|连接)|处理好了|现在可以(?:使用|调用)/u.test(finalContent);
  if (controllerDidNotComplete && falselyClaimsControllerCompletion) {
    finalContent = `还没有完成。\n\n${executionState.decision.reason}\n\n系统没有取得足够的真实执行与验收证据，因此没有采纳模型刚才的完成声明。已产生的文件和执行记录仍然保留。`;
  }
  if (!conversationOnly && callLog.length > 0) {
    const successfulTools = [...new Set(callLog.filter((call) => call.success).map((call) => call.name))];
    const failedTools = [...new Set(callLog.filter((call) => !call.success).map((call) => call.name))];
    const failureLabels = [...new Set(executionState.failures.map((failure) => failure.label))];
    const outcome = stopped || executionState.status === 'stopped'
      ? 'stopped'
      : executionState.status === 'completed' ? 'completed' : 'blocked';
    const lesson = outcome === 'completed'
      ? `${taskDecision.primaryRoute} 路线形成了可验收结果${executionState.routeChanges > 0 ? `，期间切换了 ${executionState.routeChanges} 次路线` : ''}。`
      : failureLabels.length > 0
        ? `最后阻塞属于“${failureLabels.at(-1)}”；再次遇到相似目标时先检查该条件，并避免原样重复失败路线。`
        : '本次没有形成完整验收证据；再次执行时应从未满足的完成标准继续。';
    recordTaskLearning({
      goal: originalUserText,
      outcome,
      successfulTools,
      failedTools,
      failureLabels,
      lesson,
    });
  }
  const finalized = finalizeRuntimeTurn(turnRuntime, {
    status: turnRuntime.phase === 'waiting_user'
      ? 'waiting_user'
      : stopped ? 'stopped'
          : executionState.status === 'completed' ? 'completed'
            : 'checkpointed',
    content: finalContent,
    waitingFor: turnRuntime.phase === 'waiting_user' ? turnRuntime.unresolvedIssues.at(-1) : '',
  });
  turnRuntime = finalized.runtime;
  turnLifecycle = synchronizeTurnLifecycle(turnLifecycle, turnRuntime, finalized.finalization, {
    scope: scope ?? scene,
    goal: originalUserText,
    reason: finalized.finalization.status,
  });
  publishTurnLifecycle();
  return { content: finalContent, usage: totalUsage, contextUsage: latestContextUsage, model: finalModel, executionState, taskDecision, turnRuntime, turnFinalization: finalized.finalization, turnLifecycle };
}

// ===== 初始加载 =====
}
