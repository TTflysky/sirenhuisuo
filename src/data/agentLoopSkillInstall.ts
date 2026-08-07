import type { ConnectorProtocolResult } from '../engine/connectorProtocol.mjs';
import { evaluateExecutionConclusion, observeExecutionResult, type ExecutionControllerSnapshot } from '../engine/executionController.mjs';
import type { ToolExecutionEvidence } from '../engine/executionEvidence.mjs';
import { observeToolResult, type TurnRuntimeState } from '../engine/turnRuntime.mjs';
import { recordLifecycleToolFinished, recordLifecycleToolStarted, type TurnLifecycleState } from '../engine/turnLifecycle.mjs';
import type { OutputScope } from './outputs';
import { humanizeExecutionError } from './assistantPresentation';
import { createDeterministicSkillInstallDecision, type TaskDecision } from '../engine/taskDecisionKernel.mjs';
import {
  isSkillInstallAction,
  isSkillInstallOnlyRequest,
  resolveSkillInstallInput,
  resolveSkillInstallRequest,
} from '../engine/skillInstallRouting.mjs';

type CompileTaskDecisionFunction = typeof import('./hermesClient').compileTaskDecision;

interface AgentTaskDecisionCompilationInput {
  turns: Parameters<CompileTaskDecisionFunction>[0];
  tools: Parameters<CompileTaskDecisionFunction>[1];
  modelConfig?: Parameters<CompileTaskDecisionFunction>[2];
  signal?: Parameters<CompileTaskDecisionFunction>[3];
  userTexts: string[];
  current?: Awaited<ReturnType<CompileTaskDecisionFunction>>;
  compile: CompileTaskDecisionFunction;
}

export async function resolveAgentTaskDecisionCompilation(input: AgentTaskDecisionCompilationInput) {
  const latestMessage = input.userTexts.at(-1) ?? '';
  const decision = createDeterministicSkillInstallDecision({
    latestMessage,
    previousUserMessage: input.userTexts.at(-2) ?? '',
    availableTools: input.tools.map((tool) => String(tool?.function?.name ?? '')).filter(Boolean),
    userMessages: input.userTexts,
  });
  if (!decision) return input.current ?? input.compile(input.turns, input.tools, input.modelConfig, input.signal);
  return {
    ...(input.current ?? {}),
    decision,
    usage: input.current?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    contextUsage: input.current?.contextUsage,
    model: input.current?.model,
  };
}

interface AgentSkillInstallPreparationInput {
  taskDecision: TaskDecision;
  latestUserText: string;
  tools: any[];
  referenceSourceUrl?: string;
  isConnectorTask: (goal: string) => boolean;
  isConnectorSetupRequest: (goal: string) => boolean;
}

export function prepareAgentSkillInstallation(input: AgentSkillInstallPreparationInput) {
  let taskDecision = input.taskDecision;
  const hasNativeSkillInstaller = input.tools.some((tool) => String(tool?.function?.name ?? '') === 'install_skill');
  const boundSkillInstallIntent = Boolean(input.referenceSourceUrl)
    && isSkillInstallAction(input.latestUserText, { allowBoundReference: true });
  if (boundSkillInstallIntent && hasNativeSkillInstaller) {
    taskDecision = {
      ...taskDecision,
      mode: 'execute',
      primaryRoute: 'install_skill',
      deliverableType: 'operation',
      acceptanceCriteria: ['通过客户端原生安装器写入正确的技能目录', '重新读取已安装 Skill 并确认规则完整'],
      deliverables: [{ label: '已安装并完成回读验证的 Skill', format: 'operation', type: 'operation', category: 'final', required: true }],
      requiresEvidence: true,
      needsUser: false,
      missingUserCondition: '',
      searchQuery: '',
      decisionReason: '用户已点名一个带真实来源的 Skill，直接使用原生安装器完成安装和回读验证。',
      confidence: 1,
    };
  }
  const originalUserText = taskDecision.goal;
  const explicitSkillInstallRequest = resolveSkillInstallRequest(originalUserText);
  if (explicitSkillInstallRequest?.sourceUrl && hasNativeSkillInstaller && taskDecision.mode === 'execute') {
    taskDecision = {
      ...taskDecision,
      primaryRoute: 'install_skill',
      deliverableType: 'operation',
      acceptanceCriteria: ['通过客户端原生安装器写入正确的技能目录', '重新读取已安装 Skill 并确认规则完整'],
      deliverables: [{ label: '已安装并完成回读验证的 Skill', format: 'operation', type: 'operation', category: 'final', required: true }],
      requiresEvidence: true,
      needsUser: false,
      missingUserCondition: '',
      searchQuery: '',
      decisionReason: '当前任务已有明确 Skill 来源，直接使用原生安装器完成安装和回读验证。',
      confidence: 1,
    };
  }
  const installOnlyTask = isSkillInstallOnlyRequest(originalUserText, { allowBoundReference: boundSkillInstallIntent })
    || (boundSkillInstallIntent && isSkillInstallOnlyRequest(input.latestUserText, { allowBoundReference: true }));
  const isInstallationTask = /安装|装好|装上|安装包|部署/u.test(originalUserText);
  const connectorTask = input.isConnectorTask(originalUserText) || taskDecision.primaryRoute === 'inspect_connectors';
  const connectorSetupTask = input.isConnectorSetupRequest(originalUserText) || taskDecision.primaryRoute === 'inspect_connectors';
  const isSkillInstallation = Boolean(explicitSkillInstallRequest?.sourceUrl)
    || boundSkillInstallIntent
    || (isInstallationTask && !connectorTask
      && (/skill|技能|插件/iu.test(originalUserText) || Boolean(input.referenceSourceUrl)));
  const conversationOnly = taskDecision.mode !== 'execute';
  const pinnedSkillInstall = !conversationOnly && installOnlyTask && isSkillInstallation
    ? resolveSkillInstallInput({
      sourceUrl: explicitSkillInstallRequest?.sourceUrl || (boundSkillInstallIntent ? input.referenceSourceUrl : undefined),
      ...(Array.isArray((explicitSkillInstallRequest as any)?.skillNames) && (explicitSkillInstallRequest as any).skillNames.length
        ? { skillNames: (explicitSkillInstallRequest as any).skillNames }
        : {}),
      ...((explicitSkillInstallRequest as any)?.installAll !== undefined
        ? { installAll: (explicitSkillInstallRequest as any).installAll }
        : {}),
    }, originalUserText)
    : undefined;
  return {
    taskDecision,
    originalUserText,
    explicitSkillInstallRequest,
    installOnlyTask,
    isInstallationTask,
    connectorTask,
    connectorSetupTask,
    isSkillInstallation,
    conversationOnly,
    pinnedSkillInstall,
    pinnedSkillSource: !pinnedSkillInstall?.error ? pinnedSkillInstall?.sourceUrl || '' : '',
  };
}

interface PinnedSkillInstallInput {
  sourceUrl: string;
  skillNames?: string[];
  installAll?: boolean;
  scope?: OutputScope;
  workspaceId?: string;
  goal: string;
  turnRuntime: TurnRuntimeState;
  turnLifecycle: TurnLifecycleState;
  executionState: ExecutionControllerSnapshot;
  callLog: Array<{ name: string; args: string; result: string; success: boolean }>;
  isUsefulToolOutcome: (name: string, success: boolean, output: string, goal: string) => boolean;
  assessCompletion: (content: string) => { passed: boolean; issues: string[] };
  executionRouteKey: (name: string, argumentsText: string) => string;
  onExecutionState?: (state: ExecutionControllerSnapshot) => void;
  onTurnLifecycle?: (state: TurnLifecycleState) => void;
  onToolCall?: (name: string, args: string) => Promise<void> | void;
  onToolResult?: (name: string, args: string, result: string, success?: boolean, protocolEvidence?: ConnectorProtocolResult, structuredEvidence?: ToolExecutionEvidence) => void;
}

export interface PinnedSkillInstallResult {
  content: string;
  turnRuntime: TurnRuntimeState;
  turnLifecycle: TurnLifecycleState;
  executionState: ExecutionControllerSnapshot;
}

export async function executePinnedSkillInstall(input: PinnedSkillInstallInput): Promise<PinnedSkillInstallResult> {
  const installArgs = {
    sourceUrl: input.sourceUrl,
    ...(input.skillNames?.length ? { skillNames: input.skillNames } : {}),
    ...(input.installAll !== undefined ? { installAll: input.installAll } : {}),
  };
  const installArguments = JSON.stringify(installArgs);
  const installCallId = `native-skill-install-${Date.now()}`;
  let turnRuntime = input.turnRuntime;
  let turnLifecycle = recordLifecycleToolStarted(input.turnLifecycle, {
    callId: installCallId,
    name: 'install_skill',
    args: installArgs,
    activity: '正在安装指定 Skill',
  });
  let executionState = input.executionState;
  input.onTurnLifecycle?.(turnLifecycle);
  await input.onToolCall?.('install_skill', installArguments);

  try {
    const { executeAgentTool } = await import('../engine/toolExecutorBridge');
    const result = await executeAgentTool({
      id: installCallId,
      name: 'install_skill',
      args: installArgs as any,
      scope: input.scope,
      workspaceId: input.workspaceId,
    });
    const success = input.isUsefulToolOutcome('install_skill', result.success, result.output, input.goal);
    input.callLog.push({ name: 'install_skill', args: installArguments, result: result.output.slice(0, 1200), success });
    executionState = observeExecutionResult(executionState, {
      toolName: 'install_skill',
      routeKey: input.executionRouteKey('install_skill', installArguments),
      success,
      result: result.output,
      contributesEvidence: success,
      evidenceKind: 'progress',
    });
    input.onExecutionState?.(executionState);
    const observed = observeToolResult(turnRuntime, {
      toolCallId: installCallId,
      name: 'install_skill',
      args: installArgs,
      success,
      useful: success,
      output: result.output,
      kind: 'tool',
    });
    turnRuntime = observed.runtime;
    turnLifecycle = recordLifecycleToolFinished(turnLifecycle, {
      callId: installCallId,
      name: 'install_skill',
      success,
      output: result.output,
      errorType: observed.error?.type,
      resultRef: observed.evidence.resultRef,
      evidenceIds: [observed.evidence.evidenceId],
    });
    input.onTurnLifecycle?.(turnLifecycle);
    input.onToolResult?.('install_skill', installArguments, result.output, success, result.protocolEvidence, result.structuredEvidence);
    if (!success) return { content: result.output, turnRuntime, turnLifecycle, executionState };

    const acceptance = input.assessCompletion(result.output);
    executionState = evaluateExecutionConclusion(executionState, {
      content: result.output,
      reviewed: true,
      acceptancePassed: acceptance.passed,
      acceptanceIssues: acceptance.issues,
    });
    input.onExecutionState?.(executionState);
    return {
      content: executionState.status === 'completed' ? `已经安装好了。\n\n${result.output}` : result.output,
      turnRuntime,
      turnLifecycle,
      executionState,
    };
  } catch (error: any) {
    const message = humanizeExecutionError(error?.message ?? String(error));
    input.callLog.push({ name: 'install_skill', args: installArguments, result: message, success: false });
    executionState = observeExecutionResult(executionState, {
      toolName: 'install_skill',
      routeKey: input.executionRouteKey('install_skill', installArguments),
      success: false,
      result: message,
      contributesEvidence: false,
      evidenceKind: 'progress',
    });
    input.onExecutionState?.(executionState);
    turnLifecycle = recordLifecycleToolFinished(turnLifecycle, {
      callId: installCallId,
      name: 'install_skill',
      success: false,
      output: message,
    });
    input.onTurnLifecycle?.(turnLifecycle);
    input.onToolResult?.('install_skill', installArguments, message, false);
    return { content: message, turnRuntime, turnLifecycle, executionState };
  }
}
