import type { ModelConfig } from '../types';
import type { ContextUsage, TokenUsage } from './hermesClient';
import type { TaskDecision } from '../engine/taskDecisionKernel.mjs';
import type { ExecutionControllerSnapshot } from '../engine/executionController.mjs';
import type { TurnRuntimeState } from '../engine/turnRuntime.mjs';
import type { TurnLifecycleState } from '../engine/turnLifecycle.mjs';
import { buildResearchFallback, ensureResearchSourceLinks, isResearchDeliveryDeflection } from '../engine/agentGuardrails.mjs';
import { buildExecutionHandoff, recordExecutionUsage } from '../engine/executionController.mjs';
import { recordTaskLearning } from '../engine/taskLearningMemory';
import { finalizeTurn as finalizeRuntimeTurn } from '../engine/turnRuntime.mjs';
import { synchronizeTurnLifecycle } from '../engine/turnLifecycle.mjs';
import {
  BEGINNER_RESPONSE_GUIDE,
  getToolStage,
  guardInstallationSummary,
  humanizeExecutionError,
} from './assistantPresentation';
import { getUserActionForFailure } from './agentLoopPolicy';

export interface AgentLoopCallLogEntry {
  name: string;
  args: string;
  result: string;
  success: boolean;
}

export interface AgentLoopFinalizationInput {
  stopped: boolean;
  callLog: AgentLoopCallLogEntry[];
  finalContent?: string;
  researchOnlyTask: boolean;
  requiredResearchSucceeded: boolean;
  requiredResearchOutput: string;
  originalUserText: string;
  executionBudgetReached: boolean;
  scene: string;
  label: string;
  modelConfig?: ModelConfig;
  extraSystemContext?: string;
  totalUsage: TokenUsage;
  executionState: ExecutionControllerSnapshot;
  latestContextUsage?: ContextUsage;
  finalModel: string;
  isInstallationTask: boolean;
  connectorSetupTask: boolean;
  isSkillInstallation: boolean;
  connectorTask: boolean;
  conversationOnly: boolean;
  taskDecision: TaskDecision;
  turnRuntime: TurnRuntimeState;
  turnLifecycle: TurnLifecycleState;
  scope?: string;
}

export async function finalizeAgentLoopResult(
  input: AgentLoopFinalizationInput,
  dependencies: {
    chatCompletion: (...args: any[]) => Promise<any>;
    publishExecutionState: (state: ExecutionControllerSnapshot) => void;
  },
) {
  let {
    finalContent, totalUsage, executionState, latestContextUsage, finalModel, turnRuntime, turnLifecycle,
  } = input;
  const capacityCheckpointed = executionState.status === 'checkpointed' && Boolean(executionState.budgetStopReason);
  const {
    stopped, callLog, researchOnlyTask, requiredResearchSucceeded, requiredResearchOutput,
    originalUserText, executionBudgetReached, scene, label, modelConfig, extraSystemContext,
    isInstallationTask, connectorSetupTask, isSkillInstallation, connectorTask, conversationOnly,
    taskDecision, scope,
  } = input;

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

  if (!capacityCheckpointed && !stopped && callLog.length > 0 && (!finalContent || answerNeedsNextStep)) {
    const successfulStages = [...new Set(callLog.filter((call) => call.success).map((call) => getToolStage(call.name)))].slice(-8);
    const failureEvidence = failuresBeforeSummary.slice(-6).map((call, index) =>
      `${index + 1}. 阶段：${getToolStage(call.name)}\n原因摘要：${humanizeExecutionError(call.result)}\n真实反馈：${call.result.slice(0, 700)}`
    ).join('\n\n');
    try {
      const handoff = await dependencies.chatCompletion([
        { role: 'system', content: `${BEGINNER_RESPONSE_GUIDE}\n\n你现在只负责根据真实执行证据写最终交接，不得调用工具，不得虚构成功。` },
        { role: 'system', content: '内部工具预算、上下文压缩或阶段次数不是用户需要解决的问题。除非确实缺少账号、授权、验证码、文件或业务选择，否则不得要求用户回复“继续”；要明确说明系统已经自动尝试的替代路径。' },
        { role: 'user', content: `用户最初目标：\n${originalUserText.slice(0, 4000)}\n\n已成功的阶段：\n${successfulStages.length ? successfulStages.join('、') : '暂时没有可确认的完成项'}\n\n最近失败证据：\n${failureEvidence || '没有明确失败，但执行预算已经用完。'}\n\n是否达到执行预算：${executionBudgetReached ? '是' : '否'}\n\n请用通俗中文交接，必须包含：\n1. 第一行明确整个目标成功还是没有成功；\n2. 已经完成并保留了什么；\n3. 最后卡在哪一类事情和通俗原因；\n4. 用户现在唯一最省事的下一步，明确点哪里、提供什么或回复什么。\n如果不需要用户提供账号、授权、文件或选择，就直说用户不需要改设置；禁止把“回复继续”当成推进任务的条件。不要只说“重新验收”“请重试”或“查看执行过程”。` },
      ], scene, `${label} · 失败交接`, undefined, modelConfig, extraSystemContext);
      totalUsage = {
        promptTokens: totalUsage.promptTokens + handoff.usage.promptTokens,
        completionTokens: totalUsage.completionTokens + handoff.usage.completionTokens,
        totalTokens: totalUsage.totalTokens + handoff.usage.totalTokens,
      };
      executionState = recordExecutionUsage(executionState, { modelCalls: 1, tokens: handoff.usage.totalTokens });
      dependencies.publishExecutionState(executionState);
      latestContextUsage = handoff.contextUsage;
      if (!finalModel) finalModel = handoff.model;
      if (handoff.content) finalContent = handoff.content;
    } catch {
      // Deterministic fallback below still gives the user a concrete handoff.
    }
  }

  if (!finalContent) {
    if (capacityCheckpointed) {
      finalContent = buildExecutionHandoff(executionState);
    } else if (stopped) {
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
    finalContent += `\n\n你现在需要这样做：${getUserActionForFailure(failuresBeforeSummary.at(-1)!.result)}`;
  }
  if (isInstallationTask && !connectorTask) finalContent = guardInstallationSummary(finalContent, originalUserText, callLog.map((call) => call.result).join('\n'));
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
    const outcome = stopped || executionState.status === 'stopped' ? 'stopped' : executionState.status === 'completed' ? 'completed' : executionState.status === 'checkpointed' ? 'checkpointed' : 'blocked';
    const lesson = outcome === 'completed'
      ? `${taskDecision.primaryRoute} 路线形成了可验收结果${executionState.routeChanges > 0 ? `，期间切换了 ${executionState.routeChanges} 次路线` : ''}。`
      : failureLabels.length > 0
        ? `最后阻塞属于“${failureLabels.at(-1)}”；再次遇到相似目标时先检查该条件，并避免原样重复失败路线。`
      : executionState.status === 'checkpointed'
        ? '本轮达到容量检查点但没有把它当成业务失败；恢复后只从未满足的验收标准继续。'
        : '本次没有形成完整验收证据；再次执行时应从未满足的完成标准继续。';
    recordTaskLearning({ goal: originalUserText, outcome, successfulTools, failedTools, failureLabels, lesson });
  }
  const finalized = finalizeRuntimeTurn(turnRuntime, {
    status: turnRuntime.phase === 'waiting_user' ? 'waiting_user' : stopped ? 'stopped' : executionState.status === 'completed' ? 'completed' : 'checkpointed',
    content: finalContent,
    waitingFor: turnRuntime.phase === 'waiting_user' ? turnRuntime.unresolvedIssues.at(-1) : '',
  });
  turnRuntime = finalized.runtime;
  turnLifecycle = synchronizeTurnLifecycle(turnLifecycle, turnRuntime, finalized.finalization, {
    scope: scope ?? scene,
    goal: originalUserText,
    reason: finalized.finalization.status,
  });
  return { finalContent, totalUsage, executionState, latestContextUsage, finalModel, turnRuntime, turnLifecycle, turnFinalization: finalized.finalization };
}
