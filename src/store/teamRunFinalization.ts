import type { SkillUsageEvidence, TaskRun } from '../types';

export function finalizeTeamRun(run: TaskRun, paused: boolean, stopped: boolean): void {
  const hasFailed = run.steps.some((step) => step.status === 'failed') || !!run.lastError;
  const hasUnfinished = run.steps.some((step) => step.status !== 'completed' && step.status !== 'failed' && step.status !== 'stopped');
  const evidence = run.evidence ?? [];
  const deliverableType = run.contract?.deliverableType
    ?? run.steps.find((step) => step.kind !== 'review')?.deliverableType
    ?? 'mixed';
  const hasFileEvidence = evidence.some((item) => item.kind === 'file' && item.verified);
  const hasRunEvidence = evidence.some((item) => item.kind === 'run' && item.verified);
  const hasConnectionEvidence = evidence.some((item) => item.kind === 'connection' && item.verified);
  const hasOperationEvidence = hasRunEvidence || hasConnectionEvidence;
  const hasMixedEvidence = hasFileEvidence || hasOperationEvidence;
  const reviewSteps = run.steps.filter((step) => step.kind === 'review');
  const hasReviewEvidence = reviewSteps.length === 0 || evidence.some((item) => item.kind === 'review' && item.verified);
  const deliveryVerification = deliverableType === 'file'
    ? [{ kind: 'file' as const, label: '文件交付', status: hasFileEvidence ? 'passed' as const : 'blocked' as const, detail: hasFileEvidence ? '要求的文件已写入并通过磁盘验证' : '该任务要求文件交付，但没有可交接的真实文件' }]
    : deliverableType === 'connection'
      ? [{ kind: 'connection' as const, label: '连接验证', status: hasConnectionEvidence ? 'passed' as const : 'blocked' as const, detail: hasConnectionEvidence ? '已完成最小真实连接调用' : '该任务要求连接可用性，但尚未取得真实连接证据' }]
      : deliverableType === 'operation'
        ? [{ kind: 'run' as const, label: '操作结果', status: hasOperationEvidence ? 'passed' as const : 'blocked' as const, detail: hasOperationEvidence ? '已保留真实操作或连接结果' : '该任务要求实际操作，但尚未取得运行或连接证据' }]
        : deliverableType === 'mixed'
          ? [{ kind: 'file' as const, label: '交付证据', status: hasMixedEvidence ? 'passed' as const : 'blocked' as const, detail: hasMixedEvidence ? '已保留与任务匹配的文件、运行或连接证据' : '混合交付尚未保留任何真实文件、运行或连接证据' }]
          : [];
  run.verification = [
    ...deliveryVerification,
    ...(reviewSteps.length ? [{ kind: 'review' as const, label: '责任审查', status: hasReviewEvidence ? 'passed' as const : 'blocked' as const, detail: hasReviewEvidence ? '审查步骤已给出明确结论' : '审查步骤没有提交具体的通过或退回依据' }] : []),
  ];
  const verificationBlocked = run.verification.some((item) => item.status === 'blocked');
  run.status = stopped ? 'stopped' : paused ? 'paused' : hasFailed || hasUnfinished || verificationBlocked ? 'failed' : 'completed';
  run.phase = stopped || paused ? 'blocked' : hasFailed || hasUnfinished || verificationBlocked ? 'blocked' : 'verifying';

  if (!stopped && !paused && !hasFailed && !hasUnfinished && verificationBlocked) {
    run.lastError = `验收未通过：${run.verification.filter((item) => item.status === 'blocked').map((item) => item.detail).join('；')}`;
    run.handoff = {
      ts: Date.now(), completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
      blocked: run.lastError, nextAction: '点击继续执行，只补齐缺少的产出、运行、连接或审查证据。',
    };
  }
  if (!stopped && !paused && hasUnfinished) {
    run.lastError = '部分成员未完成执行，可点击继续执行重试。';
    run.steps.forEach((step) => {
      if (step.status === 'queued' || step.status === 'running') {
        step.status = 'failed'; step.lastError = '执行未完成';
        step.events.push({ ts: Date.now(), type: 'error', detail: '执行未完成，等待重试' });
      }
    });
  }
  if (paused) run.steps.forEach((step) => {
    if (step.status === 'running') { step.status = 'paused'; step.events.push({ ts: Date.now(), type: 'status', detail: '已暂停，等待继续' }); }
  });
  if (stopped) {
    run.lastError = undefined;
    run.steps.forEach((step) => {
      if (step.status !== 'completed' && step.status !== 'failed') {
        step.status = 'stopped';
        step.events.push({ ts: Date.now(), type: 'status', detail: '用户已停止任务' });
      }
    });
    run.handoff = {
      ts: Date.now(),
      completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
      blocked: '任务已由用户停止。',
      nextAction: '已完成内容会保留；需要继续时请重新发起任务。',
    };
  }
  if (!stopped && !paused && !hasFailed && !hasUnfinished && !verificationBlocked) {
    run.phase = 'completed';
    run.preflight = (run.preflight ?? []).map((item) => item.label === '确认最终验收'
      ? { ...item, status: 'passed', detail: '所有任务步骤已完成并通过最终汇总' }
      : item);
  }
  if (run.status === 'completed' || run.status === 'failed') {
    const invoked = [...new Map((run.skillEvidence ?? []).filter((item) => item.action === 'called' && item.verified).map((item) => [item.skillId || item.skillName, item])).values()];
    for (const item of invoked) {
      const acceptanceEvidence: SkillUsageEvidence = {
        ts: Date.now(), skillId: item.skillId, skillName: item.skillName,
        action: run.status === 'completed' ? 'accepted' : 'rejected',
        reason: run.status === 'completed' ? '团队任务通过最终验收' : `团队任务未通过最终验收：${run.lastError ?? '仍有未决问题'}`,
        verified: run.status === 'completed', stage: 'acceptance', source: 'team',
      };
      run.skillEvidence = [...(run.skillEvidence ?? []), acceptanceEvidence].slice(-60);
    }
  }
  if (run.recoveryContext) {
    run.recoveryContext.summary = run.status === 'completed' ? '任务已完成并保留验收证据。'
      : run.status === 'paused' ? '任务已暂停，等待用户继续。'
        : run.status === 'stopped' ? '任务已停止，已完成内容仍然保留。'
          : '任务尚有未决问题，等待处理后恢复。';
    run.recoveryContext.budget.updatedAt = Date.now();
  }
}
