function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function readTask(store, taskId) {
  const snapshot = await store.read({ taskId });
  if (!snapshot.ok || !snapshot.runs?.[0]) throw new Error(snapshot.error || `找不到任务：${taskId}`);
  return { snapshot, task: snapshot.runs[0] };
}

function createTaskServiceContextQueries(store) {
  async function context(taskId, options = {}) {
    const { task } = await readTask(store, taskId);
    const limit = Math.max(1, Math.min(50, Number(options.limit) || 20));
    const verifiedStepEvidence = (task.steps || []).flatMap((step) => (step.evidence || [])
      .filter((item) => item.verified === true)
      .map((item) => ({ ...clone(item), stepId: step.id })));
    const verifiedVerifications = (task.verifications || [])
      .filter((item) => item.status === 'passed')
      .map((item) => ({ ...clone(item), evidenceType: 'verification' }));
    const verifiedEvidence = [...verifiedStepEvidence, ...verifiedVerifications]
      .filter((item, index, all) => {
        const key = item.id || item.verificationId || item.artifactId || `${item.stepId || 'task'}:${item.summary || item.label || index}`;
        return all.findIndex((candidate, candidateIndex) => {
          const candidateKey = candidate.id || candidate.verificationId || candidate.artifactId
            || `${candidate.stepId || 'task'}:${candidate.summary || candidate.label || candidateIndex}`;
          return candidateKey === key;
        }) === index;
      });
    const contractedSteps = (task.steps || []).filter((step) => step.compensationOnly !== true && step.taskContract);
    return {
      ok: true,
      taskId,
      projectId: task.projectId,
      workspaceId: task.workspaceId || task.workspace?.workspaceId,
      goal: task.goal,
      acceptanceCriteria: clone(task.acceptanceCriteria || []),
      parentTaskId: task.parentTaskId,
      inheritedContext: clone(task.inheritedContext || {}),
      verifiedArtifacts: (task.artifacts || []).filter((item) => item.verified).slice(-limit).map(clone),
      references: (task.references || []).slice(-limit).map(clone),
      completedSteps: (task.steps || []).filter((step) => step.status === 'completed').slice(-limit)
        .map((step) => ({ id: step.id, title: step.title, output: clone(step.output) })),
      stepProjections: (task.steps || []).slice(-limit)
        .map((step) => ({
          id: step.id,
          title: step.title,
          status: step.status,
          output: clone(step.output),
          taskContract: clone(step.taskContract),
          evidence: clone(step.evidence || []),
          adaptiveEvidenceIds: clone(task.adaptivePlanGraph?.nodes?.find((node) => node.id === step.id)?.evidenceIds || []),
        })),
      verifiedEvidence: verifiedEvidence.slice(-limit),
      contractCoverage: {
        total: (task.steps || []).filter((step) => step.compensationOnly !== true).length,
        contracted: contractedSteps.length,
        complete: contractedSteps.length === (task.steps || []).filter((step) => step.compensationOnly !== true).length,
      },
      recoveryEvidence: clone(task.recoveryContext?.completedEvidence || []),
      unresolvedIssues: [task.lastError, ...(task.steps || []).filter((step) => step.status === 'failed').map((step) => step.lastError)]
        .filter(Boolean)
        .slice(-limit),
      turnLifecycle: clone(task.turnLifecycle),
      lifecycleRecovery: clone(task.lifecycleRecovery),
    };
  }

  async function readySteps(taskId) {
    const { task } = await readTask(store, taskId);
    return {
      ok: true,
      taskId,
      steps: (task.steps || []).filter((step) => ['queued', 'paused'].includes(step.status)
        && (step.dependsOnStepIds || []).every((dependency) => task.steps.find((item) => item.id === dependency)?.status === 'completed'))
        .map(clone),
    };
  }

  async function validateCompletion(taskId) {
    const { snapshot, task } = await readTask(store, taskId);
    const normalSteps = (task.steps || []).filter((step) => step.compensationOnly !== true);
    const checks = [
      { id: 'steps', label: '所有正常步骤已完成', passed: normalSteps.length > 0 && normalSteps.every((step) => step.status === 'completed') },
      { id: 'approval', label: '没有待处理授权', passed: !(task.approvals || []).some((item) => item.status === 'pending') },
    ];
    if ((Number(task.taskServiceVersion) || 0) >= 6 || normalSteps.some((step) => step.taskContract)) {
      checks.push({
        id: 'step-contracts',
        label: '所有正常步骤拥有可恢复任务合同',
        passed: normalSteps.length > 0 && normalSteps.every((step) => Boolean(step.taskContract)),
      });
    }
    const requiresCodingEvidence = task.workspace?.requiresEvidence === true
      || task.workspace?.mode === 'git-worktree'
      || task.taskType === 'coding'
      || Boolean(task.codingProject)
      || (task.checkpoints || []).length > 0;
    if (requiresCodingEvidence) {
      checks.push({ id: 'checkpoint', label: '存在工作树检查点', passed: task.workspace.status === 'ready' && (task.checkpoints || []).length > 0 });
      checks.push({ id: 'verification', label: '至少一个验证通过', passed: (task.verifications || []).some((item) => item.status === 'passed') });
    }
    return { ok: true, taskId, passed: checks.every((item) => item.passed), checks, status: task.status, integrity: snapshot.integrity };
  }

  return { context, readySteps, validateCompletion };
}

module.exports = { createTaskServiceContextQueries };
