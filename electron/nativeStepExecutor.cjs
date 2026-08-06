const { createNativeAssistantToolHistoryMessage } = require('./modelReasoningCompatibility.cjs');

function createNativeStepExecutor(deps) {
  const {
    options,
    loadEngineModules,
    inferStepDeliverableType,
    consultStepAdvisors,
    buildSystem,
    buildInheritedTaskContext,
    buildChildTaskContext,
    buildUserTurn,
    toolAvailableForStep,
    emit,
    requiresLongModelRequest,
    MAX_LONG_MODEL_ROUNDS_PER_STEP,
    MAX_MODEL_ROUNDS_PER_STEP,
    MODEL_ROUNDS_PER_STAGE,
    assertCanContinue,
    shouldExtendModelRoundBudget,
    updateRun,
    callModel,
    longModelRequestTimeoutMs,
    modelRequestTimeoutMs,
    ExecutionControlSignal,
    modelName,
    persistTurnRuntime,
    readRun,
    verifiedFileStepCompletesStep,
    MAX_TOOL_CALLS_PER_STEP,
    toolKey,
    toolCacheKey,
    isWorkspaceMutationTool,
    reportActivity,
    publicMember,
    timeoutPromise,
    toolCallTimeoutMs,
    delegateSubtask,
    executeWorktreeTool,
    authorizeToolExecution,
    isPreparationTool,
    recordTool,
    requestToolApproval,
    MAX_PREPARATION_STREAK,
    completeOutstandingToolMessages,
    structuredReviewCompletesStep,
    text,
    substantiveDecisionCompletesStep,
  } = deps;

  return async function executeStep(job, run, step, member, executionOptions = {}) {
    const { fidelity, toolRegistry, contextRouter, turnRuntime, turnLifecycle, moaRuntime, explicitResource } = await loadEngineModules();
    const stepDeliverableType = inferStepDeliverableType(step, run);
    let runtime = turnRuntime.createTurnRuntime({
      taskId: job.taskId,
      scope: `team:${run.teamId}`,
      // Each team member is verified against its own contractual stage. The
      // full project goal remains in the system prompt and final run checks.
      goal: step.assignment || run.goal || run.request,
      contract: { ...(run.contract || {}), goal: step.assignment || run.goal || run.request, deliverableType: stepDeliverableType },
    });
    const layeredMemory = options.memoryManager
      ? await options.memoryManager.context({ query: run.goal || run.request, teamId: run.teamId, employeeId: member.id, limit: 16 }).catch(() => ({ context: '' }))
      : { context: '' };
    const stepRecoveryPrompt = contextRouter.buildRecoveryPrompt({
      ...run,
      steps: run.steps.filter((item) => item.status === 'completed' || item.id === step.id),
    });
    const advisorGuidance = executionOptions.compensation
      ? ''
      : await consultStepAdvisors(job, run, step, member, moaRuntime, run.evidence || []);
    const explicitResourceContract = explicitResource.createExplicitResourceContract(run.goal || run.request);
    const explicitResourceGuidance = explicitResource.buildExplicitResourceGuidance(explicitResourceContract);
    const messages = [
      { role: 'system', content: `${buildSystem(run, step, member, job, turnRuntime.buildTurnGuidance(runtime), advisorGuidance)}${explicitResourceGuidance ? `\n\n${explicitResourceGuidance}` : ''}${layeredMemory.context ? `\n\n## 太极分层热记忆\n${layeredMemory.context}\n\n以上记忆只作为可复用背景；与老板当前明确要求冲突时，以当前要求为准。` : ''}${buildInheritedTaskContext(run)}${buildChildTaskContext(run)}\n\n${stepRecoveryPrompt}` },
      buildUserTurn(run, step, job),
    ];
    const availableDefinitions = [...options.toolRuntime.definitions, ...(job.connectorTools || [])]
      .filter((definition) => toolAvailableForStep(definition?.function?.name, run, step));
    const registry = toolRegistry.buildToolRegistry(availableDefinitions);
    const tools = registry.definitions;
    emit(job, 'tool_registry_ready', {
      stepId: step.id,
      registryProtocolVersion: registry.protocolVersion,
      ready: registry.ready,
      blocked: registry.blocked,
      collisions: registry.collisions,
      invalid: registry.invalid,
    });
    if (!tools.length) throw new Error('统一工具注册中心没有可用工具，任务无法开始');
    const cache = new Map();
    const callLog = [];
    let workspaceMutationEpoch = 0;
    let preparationStreak = 0;
    let finalContent = '';
    let review;
    let forceActionCount = 0;
    let appliedSteering = job.steering.length;
    let liveBudget = contextRouter.createContextBudget(run.recoveryContext?.budget);
    const longGenerationStep = requiresLongModelRequest(step, stepDeliverableType);
    const maxModelRounds = longGenerationStep ? MAX_LONG_MODEL_ROUNDS_PER_STEP : MAX_MODEL_ROUNDS_PER_STEP;
    for (let round = 0; round < maxModelRounds; round += 1) {
      await assertCanContinue(job);
      if (round === MAX_MODEL_ROUNDS_PER_STEP && longGenerationStep) {
        const hasMaterialProgress = shouldExtendModelRoundBudget(step, stepDeliverableType, callLog);
        if (!hasMaterialProgress) break;
        messages.push({ role: 'system', content: `前 ${MAX_MODEL_ROUNDS_PER_STEP} 轮已经产生真实写入、运行或连接证据，因此自动进入收尾阶段。只补齐尚缺的验证与总结，不得重做已完成文件；总轮次仍受 ${MAX_LONG_MODEL_ROUNDS_PER_STEP} 轮硬上限约束。` });
        emit(job, 'model_round_budget_extended', {
          stepId: step.id,
          completedRounds: round,
          maxRounds: maxModelRounds,
          reason: 'material-progress',
        });
      }
      const currentPromptTokens = contextRouter.estimateTokens(messages.map((item) => item.content || item.tool_calls || '').join('\n'));
      const budgetAssessment = contextRouter.assessContextBudget(liveBudget, { currentPromptTokens });
      const stageBoundary = round > 0 && round % MODEL_ROUNDS_PER_STAGE === 0;
      if ((budgetAssessment.action === 'compact' || budgetAssessment.action === 'checkpoint' || stageBoundary) && messages.length > 8) {
        const compacted = contextRouter.compactMessageWindow(messages, { keepRecent: 10 });
        messages.splice(0, messages.length, ...compacted.messages);
        await updateRun(job.taskId, (next) => {
          if (!next.recoveryContext) return;
          const budget = contextRouter.createContextBudget(next.recoveryContext.budget);
          budget.compactions += 1;
          if (stageBoundary) budget.stage += 1;
          budget.estimatedTokens = contextRouter.estimateTokens(messages.map((item) => item.content || '').join('\n'));
          budget.updatedAt = Date.now();
          next.recoveryContext.budget = budget;
          liveBudget = budget;
          next.recoveryContext.summary = `长任务已完成第 ${budget.stage - 1} 阶段压缩，保留原始目标、证据和未决问题后继续。`;
          next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: `上下文阶段 ${budget.stage} 压缩` });
          next.turnLifecycle = turnLifecycle.recordLifecycleContext(
            turnLifecycle.restoreTurnLifecycle(next.turnLifecycle, {
              taskId: next.id,
              conversationId: next.conversationId,
              scope: `team:${next.teamId}`,
              goal: next.goal || next.request,
              deliverableType: next.contract?.deliverableType,
            }),
            {
              compacted: true,
              stage: budget.stage,
              estimatedTokens: budget.estimatedTokens,
              contextWindowTokens: budget.contextWindowTokens,
              summary: next.recoveryContext.summary,
              unresolvedIssues: next.recoveryContext.unresolvedIssues,
            },
          );
          next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
        }, '原生 Adapter 压缩长任务上下文');
        if (stageBoundary) await options.store.createRecoveryPoint({ taskId: job.taskId, label: `自动阶段 ${Math.floor(round / MODEL_ROUNDS_PER_STAGE)} 恢复点` });
        emit(job, 'context_compacted', { stepId: step.id, removedMessages: compacted.removed, round, reason: stageBoundary ? 'stage-boundary' : budgetAssessment.reason });
      }
      if (budgetAssessment.action === 'replan') {
        messages.push({ role: 'system', content: '连续多轮没有新增可验证证据。立即停止当前重复路线，说明根因并选择本质不同的工具、来源或实现方法。' });
        emit(job, 'route_replan_required', { stepId: step.id, reason: budgetAssessment.reason });
      }
      if (job.steering.length > appliedSteering) {
        const updates = job.steering.slice(appliedSteering);
        runtime = turnRuntime.applySteering(runtime, updates);
        await updateRun(job.taskId, (next) => {
          next.turnLifecycle = turnLifecycle.recordLifecycleSteering(
            turnLifecycle.restoreTurnLifecycle(next.turnLifecycle, {
              taskId: next.id,
              conversationId: next.conversationId,
              scope: `team:${next.teamId}`,
              goal: next.goal || next.request,
              deliverableType: next.contract?.deliverableType,
            }),
            updates,
          );
          next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
        }, '原生 Adapter 将用户插话写入 Turn Lifecycle');
        messages.push({ role: 'system', content: `老板在执行中补充了要求。先结合原目标判断影响，再调整当前路线：\n${updates.join('\n')}` });
        messages.push({ role: 'system', content: turnRuntime.buildTurnGuidance(runtime) });
        appliedSteering = job.steering.length;
      }
      job.modelRounds += 1;
      const modelMember = step.kind === 'review' && job.reviewModelConfig
        ? { ...member, modelConfig: job.reviewModelConfig }
        : member;
      let response;
      try {
        response = await callModel(job, modelMember, messages, tools, {
          timeoutMs: requiresLongModelRequest(step, stepDeliverableType)
            ? longModelRequestTimeoutMs
            : modelRequestTimeoutMs,
        });
      } catch (error) {
        if (error instanceof ExecutionControlSignal) throw error;
        const observed = turnRuntime.observeToolResult(runtime, {
          toolCallId: `model-${job.taskId}-${step.id}-${round + 1}`,
          name: 'model_request',
          args: { model: modelName(modelMember.modelConfig), round: round + 1 },
          success: false,
          useful: false,
          output: error?.message || String(error),
          kind: 'model',
        });
        runtime = observed.runtime;
        const recovery = turnRuntime.decideRecovery(runtime, observed.error || error);
        runtime = recovery.runtime;
        const terminalStatus = recovery.decision.action === 'waiting_user' ? 'waiting_user' : 'failed';
        const finalContent = recovery.decision.userMessage || recovery.decision.message || '模型请求失败';
        const finalized = turnRuntime.finalizeTurn(runtime, {
          status: terminalStatus,
          content: finalContent,
          waitingFor: terminalStatus === 'waiting_user' ? finalContent : '',
        });
        runtime = finalized.runtime;
        await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 收尾模型请求异常');
        if (terminalStatus === 'waiting_user') throw new ExecutionControlSignal('awaiting_user', finalContent);
        throw error;
      }
      if (response.outputDiagnostics) emit(job, 'model_output_normalized', response.outputDiagnostics);
      const message = response.message;
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const observedDecision = turnRuntime.observeModelDecision(runtime, {
        content: message.content,
        toolCalls: toolCalls.map((call) => ({
          name: call?.function?.name,
          arguments: call?.function?.arguments,
        })),
      });
      runtime = observedDecision.runtime;
      await updateRun(job.taskId, (next) => {
        next.turnLifecycle = turnLifecycle.recordLifecycleDecision(
          turnLifecycle.restoreTurnLifecycle(next.turnLifecycle, {
            taskId: next.id,
            conversationId: next.conversationId,
            scope: `team:${next.teamId}`,
            goal: next.goal || next.request,
            deliverableType: next.contract?.deliverableType,
          }),
          observedDecision.decision,
        );
        next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
      }, '原生 Adapter 保存模型公开决策');
      liveBudget = contextRouter.recordContextUsage({
        ...liveBudget,
        contextWindowTokens: Number(modelMember.modelConfig?.contextWindowTokens) || liveBudget.contextWindowTokens,
      }, {
        promptTokens: Number(response.usage.prompt_tokens) || 0,
          completionTokens: Number(response.usage.completion_tokens) || 0,
          estimatedTokens: currentPromptTokens,
          modelRounds: 1,
          progress: toolCalls.length > 0,
      });
      if (toolCalls.length > 0 || (round + 1) % 3 === 0 || round === maxModelRounds - 1) {
        await updateRun(job.taskId, (next) => {
          if (!next.recoveryContext) return;
          next.recoveryContext.budget = liveBudget;
          next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: '模型轮次用量检查点' });
        }, '记录原生模型上下文用量');
      }
      if (toolCalls.length) {
        messages.push(createNativeAssistantToolHistoryMessage(message, toolCalls));
        const completedToolCallIds = new Set();
        try {
          for (const call of toolCalls) {
          await assertCanContinue(job);
          if (callLog.length >= MAX_TOOL_CALLS_PER_STEP) {
            const latestRun = await readRun(job.taskId);
            const latestStep = latestRun?.steps?.find((item) => item.id === step.id);
            if (verifiedFileStepCompletesStep(step, stepDeliverableType, callLog, latestStep?.evidence)) {
              const content = `当前步骤已产生真实文件，并通过成功的运行验证；达到 ${MAX_TOOL_CALLS_PER_STEP} 次工具预算后按现有证据完成收口，没有执行额外的重复命令。`;
              emit(job, 'tool_budget_completed_from_evidence', {
                stepId: step.id,
                toolCalls: callLog.length,
                reason: 'verified-file-and-command-evidence',
              });
              const finalized = turnRuntime.finalizeTurn(runtime, { status: 'completed', content });
              runtime = finalized.runtime;
              await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 依据真实证据在工具预算边界完成步骤');
              return { content, review, callLog, usageModel: response.model, turnRuntime: runtime, turnFinalization: finalized.finalization };
            }
            throw new ExecutionControlSignal('checkpoint', `当前步骤达到 ${MAX_TOOL_CALLS_PER_STEP} 次工具预算，现场和证据已保存；请从恢复点继续或更换模型。`);
          }
          const rawName = String(call?.function?.name || '');
          const normalizedCall = turnRuntime.normalizeToolCall(rawName, call?.function?.arguments || '{}');
          const name = normalizedCall.name || rawName;
          const args = normalizedCall.args || {};
          let result;
          const key = toolKey(name, args);
          const cacheKey = toolCacheKey(name, args, workspaceMutationEpoch);
          const preflight = toolRegistry.preflightToolCall(registry, name, args, { approvalGranted: true });
          const explicitResourceGate = explicitResource.validateExplicitResourceToolCall(explicitResourceContract, name, args, callLog);
          if (!normalizedCall.ok) result = { name, success: false, output: normalizedCall.error || '工具参数无效' };
          else if (!explicitResourceGate.allowed) result = { name, success: false, output: explicitResourceGate.reason };
          else if (!preflight.ok) result = { name, success: false, output: `工具预检未通过：${preflight.message}` };
          else if (job.approvalDenials?.has(key)) result = { name, success: false, output: '用户已经拒绝这项完全相同的操作，不得重复申请；必须改用不需要该权限的路线。' };
          else if (cache.has(cacheKey)) result = { name, success: false, duplicate: true, output: '完全相同的工具调用已执行，不能重复消耗算力，必须更换路线。' };
          else {
            await authorizeToolExecution(job, run, step, member, name, call.id);
            await reportActivity(job, 'tool_started', `${member.name} 正在调用 ${name}`, {
              stepId: step.id, member: publicMember(member), toolName: name,
            });
            const deadline = timeoutPromise(toolCallTimeoutMs, `工具 ${name} 在 ${Math.ceil(toolCallTimeoutMs / 1000)} 秒内没有返回`, () => {});
            try {
              const execution = name === 'delegate_subtask'
                ? delegateSubtask(job, run, step, args)
                : name === 'prepare_git_worktree' || name === 'checkpoint_git_worktree'
                  ? executeWorktreeTool(job, run, name, args)
                  : options.toolRuntime.execute(name, args, {
                    taskId: job.taskId, scope: `team:${run.teamId}`, workspaceId: run.workspaceId, worktreePath: run.worktree?.path,
                    goal: run.goal || run.request,
                    executionPolicy: job.executionPolicy, connectors: job.connectors, connectorActions: job.connectorActions,
                    approvalGranted: job.approvalGrants?.has(key) === true,
                  });
              result = await Promise.race([execution, deadline.promise]);
            } catch (error) {
              if (error?.code === 'TAIJI_OPERATION_TIMEOUT') {
                job.lastError = `${error.message}。结果是否已产生尚未确认，为避免重复执行，任务已安全暂停。`;
                throw new ExecutionControlSignal('stall', job.lastError);
              }
              throw error;
            } finally {
              deadline.clear();
            }
          }
          cache.set(cacheKey, { success: result.success, output: result.output });
          if (result.success && isWorkspaceMutationTool(name, args)) workspaceMutationEpoch += 1;
          callLog.push({ name, args: JSON.stringify(args), result: result.output, success: result.success });
          if (result.structuredEvidence?.review) review = result.structuredEvidence.review;
          preparationStreak = result.success && isPreparationTool(name) ? preparationStreak + 1 : result.success ? 0 : preparationStreak;
          await recordTool(job, run, step, member, name, args, result);
          const resultReference = result.structuredEvidence?.artifacts?.[0]?.diskPath
            || result.structuredEvidence?.artifacts?.[0]?.path
            || '';
          const observed = turnRuntime.observeToolResult(runtime, {
            toolCallId: call.id,
            name,
            args,
            success: result.success === true,
            useful: result.success === true,
            output: result.output,
            errorType: !result.success && name === 'run_command' && args.verification === true ? 'verification_failed' : undefined,
            resultRef: resultReference,
            kind: result.structuredEvidence?.artifacts?.length
              ? 'file'
              : result.structuredEvidence?.connection ? 'connection'
                : result.structuredEvidence?.review ? 'review' : 'tool',
          });
          runtime = observed.runtime;
          await persistTurnRuntime(job, runtime, undefined, `${member.name}记录 Turn Runtime 工具证据`);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result.output.slice(0, 12000) });
          completedToolCallIds.add(String(call.id || ''));
          if (result.awaitingUser || result.awaitingApproval) {
            if (result.awaitingApproval) await requestToolApproval(job, run, step, member, name, args, result);
            const finalized = turnRuntime.finalizeTurn(runtime, { status: 'waiting_user', content: result.output, waitingFor: result.output });
            runtime = finalized.runtime;
            await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 等待用户条件');
            throw new ExecutionControlSignal('awaiting_user', result.output);
          }
          if (observed.error && !result.duplicate) {
            const routeAttempts = runtime.seenCalls?.[observed.evidence.callFingerprint]?.attempts || 1;
            const recovery = turnRuntime.decideRecovery(runtime, observed.error, { routeAttempts });
            runtime = recovery.runtime;
            if (recovery.decision.action === 'retry') cache.delete(cacheKey);
            messages.push({ role: 'system', content: `${turnRuntime.buildTurnGuidance(runtime)}\n\n失败类型：${recovery.decision.errorType}；下一恢复动作：${recovery.decision.action}。不要原样重复无效路线。` });
            if (recovery.decision.action === 'waiting_user') {
              const finalized = turnRuntime.finalizeTurn(runtime, { status: 'waiting_user', content: recovery.decision.userMessage, waitingFor: recovery.decision.message });
              runtime = finalized.runtime;
              await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 等待用户条件');
              throw new ExecutionControlSignal('awaiting_user', recovery.decision.userMessage);
            }
            if (recovery.decision.action === 'checkpoint') {
              const finalized = turnRuntime.finalizeTurn(runtime, { status: 'checkpointed', content: recovery.decision.message });
              runtime = finalized.runtime;
              await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 失败恢复检查点');
              throw new ExecutionControlSignal('checkpoint', recovery.decision.message || '同类恢复已经达到上限');
            }
          }
          if (preparationStreak >= MAX_PREPARATION_STREAK) {
            messages.push({ role: 'system', content: `已连续 ${preparationStreak} 次只读取或检查，没有产生可验收结果。必须立即执行真实写入、运行、连接验证或明确交接唯一外部阻塞。` });
          }
          }
        } catch (error) {
          completeOutstandingToolMessages(messages, toolCalls, completedToolCallIds, error?.message || error);
          throw error;
        }
        if (structuredReviewCompletesStep(step, stepDeliverableType, review)) {
          const reviewContent = review.decision === 'pass'
            ? `结构化结论已通过：${review.reason}`
            : `结构化审查已退回：${review.reason}`;
          const finalized = turnRuntime.finalizeTurn(runtime, { status: 'completed', content: reviewContent });
          runtime = finalized.runtime;
          await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 以结构化审查结论完成步骤');
          return { content: reviewContent, review, callLog, usageModel: response.model, turnRuntime: runtime, turnFinalization: finalized.finalization };
        }
        continue;
      }
      finalContent = text(message.content, 20000);
      const latestRun = await readRun(job.taskId);
      const currentStep = latestRun.steps.find((item) => item.id === step.id);
      const hasFile = currentStep?.evidence?.some((item) => item.kind === 'file' && item.verified);
      const hasSuccessfulTool = callLog.some((call) => call.success);
      if (executionOptions.compensation && !hasSuccessfulTool) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent || '补偿步骤说明' });
        messages.push({ role: 'system', content: '补偿步骤尚未形成真实工具执行证据。必须调用已注册工具完成声明的补偿动作，不能只用文字说明。' });
        continue;
      }
      const fileEvidenceRequired = runtime.deliverableType === 'file'
        || turnRuntime.requiresFileEvidence(run.contract || { goal: run.goal || run.request }, step);
      if (!executionOptions.compensation && step.kind !== 'review' && fileEvidenceRequired && !hasFile) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent || '当前步骤说明' });
        messages.push({ role: 'system', content: forceActionCount <= 2
          ? '当前是交付步骤，但还没有经过磁盘校验的文件证据。下一步必须调用 write_file 形成可交接文件，然后再总结。'
          : '仍然没有经过磁盘校验的文件证据，禁止宣布完成。立即改用可行的真实写入路线；若缺少外部条件，只能明确交接该唯一条件。' });
        continue;
      }
      if (!executionOptions.compensation && verifiedFileStepCompletesStep(step, stepDeliverableType, callLog, currentStep?.evidence)) {
        const content = finalContent || '当前文件步骤已产生真实文件，并通过运行验证。';
        emit(job, 'file_step_completed_from_evidence', {
          stepId: step.id,
          reason: 'verified-file-and-command-evidence',
        });
        const finalized = turnRuntime.finalizeTurn(runtime, { status: 'completed', content });
        runtime = finalized.runtime;
        await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 依据真实文件与运行验证完成步骤');
        return { content, review, callLog, usageModel: response.model, turnRuntime: runtime, turnFinalization: finalized.finalization };
      }
      if (step.kind === 'review' && !review) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent || '审查说明' });
        messages.push({ role: 'system', content: forceActionCount <= 2
          ? '审查步骤没有 submit_review 证据。必须先检查真实文件或运行结果，再调用 submit_review 提交 PASS 或 REJECT。'
          : '仍然没有结构化审查证据，禁止宣布完成。立即读取或运行真实产出并提交 PASS/REJECT；无法继续时只交接具体阻塞。' });
        continue;
      }
      if (executionOptions.compensation) {
        const finalized = turnRuntime.finalizeTurn(runtime, { status: 'completed', content: finalContent || '补偿步骤已完成真实工具执行。' });
        runtime = finalized.runtime;
        await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 完成补偿步骤');
        return { content: finalContent || '补偿步骤已完成真实工具执行。', review, callLog, usageModel: response.model, turnRuntime: runtime, turnFinalization: finalized.finalization };
      }
      if (substantiveDecisionCompletesStep(step, stepDeliverableType, finalContent)) {
        const finalized = turnRuntime.finalizeTurn(runtime, { status: 'completed', content: finalContent });
        runtime = finalized.runtime;
        await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 完成实质决策步骤');
        return { content: finalContent, review, callLog, usageModel: response.model, turnRuntime: runtime, turnFinalization: finalized.finalization };
      }
      const acceptance = fidelity.assessTaskCompletion(runtime.goal, finalContent, callLog);
      const explicitAcceptance = explicitResource.assessExplicitResourceCompletion(explicitResourceContract, callLog);
      acceptance.issues.push(...explicitAcceptance.issues);
      acceptance.passed = acceptance.passed && explicitAcceptance.passed;
      if (!acceptance.passed) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent });
        messages.push({ role: 'system', content: forceActionCount <= 2
          ? `原始目标验收未通过：${acceptance.issues.join('；')}。请换路线补齐真实证据，不得宣布完成。`
          : `原始目标仍未验收：${acceptance.issues.join('；')}。必须改走本质不同的路线、补齐证据或明确唯一外部阻塞，禁止以普通文本结束。` });
        continue;
      }
      if (!finalContent) finalContent = '当前步骤已完成工具执行与真实结果验证。';
      const finalized = turnRuntime.finalizeTurn(runtime, { status: 'completed', content: finalContent });
      runtime = finalized.runtime;
      await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 完成团队步骤');
      return { content: finalContent, review, callLog, usageModel: response.model, turnRuntime: runtime, turnFinalization: finalized.finalization };
    }
    await options.store.createRecoveryPoint({ taskId: job.taskId, label: '模型轮次预算恢复点' }).catch(() => {});
    if (run.worktree && options.worktreeManager) await options.worktreeManager.checkpoint(job.taskId, { label: '模型轮次预算恢复点' }).catch(() => {});
    const completedRounds = shouldExtendModelRoundBudget(step, stepDeliverableType, callLog)
      ? MAX_LONG_MODEL_ROUNDS_PER_STEP
      : MAX_MODEL_ROUNDS_PER_STEP;
    const finalized = turnRuntime.finalizeTurn(runtime, { status: 'checkpointed', content: `当前步骤经过 ${completedRounds} 轮仍未形成可验收结果。` });
    runtime = finalized.runtime;
    await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 模型轮次预算检查点');
    throw new ExecutionControlSignal('checkpoint', `当前步骤经过 ${completedRounds} 轮仍未形成可验收结果。系统已保存目标、证据、未决问题和当前步骤，没有判定失败；可从恢复点继续或更换模型后继续。`);
  }

}

module.exports = { createNativeStepExecutor };
