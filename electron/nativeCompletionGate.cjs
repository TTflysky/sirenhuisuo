const { isVerifiedArtifact, inferStepDeliverableType } = require('./nativeExecutionPolicy.cjs');

function text(value, limit = 1600) {
  return String(value ?? '').trim().slice(0, limit);
}

function evaluateNativeCompletion(run = {}) {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const evidence = Array.isArray(run.evidence) ? run.evidence : [];
  const unfinished = steps.filter((step) => step.status !== 'completed' && step.compensationOnly !== true);
  const needsCommand = /代码|程序|安装|部署|构建|编译|运行|测试/iu.test(run.request || '');
  const needsConnection = /连接器|知识库|mcp|obsidian|ima/iu.test(run.request || '');
  const checks = [
    { kind: 'file', label: '真实产出', passed: evidence.some((item) => item.kind === 'file' && item.verified && isVerifiedArtifact(item.artifact)), detail: '至少一个文件真实落盘并通过回读校验' },
    ...(needsCommand ? [{ kind: 'run', label: '运行结果', passed: evidence.some((item) => item.kind === 'run' && item.verified), detail: '任务涉及代码或安装，必须有成功运行证据' }] : []),
    ...(needsConnection ? [{ kind: 'connection', label: '连接验证', passed: evidence.some((item) => item.kind === 'connection' && item.verified), detail: '任务涉及外部连接，必须有最小真实调用证据' }] : []),
    ...(steps.some((step) => step.kind === 'review') ? [{ kind: 'review', label: '责任审查', passed: evidence.some((item) => item.kind === 'review' && item.verified), detail: '审查步骤必须明确通过' }] : []),
  ];
  const typedChecks = new Map();
  for (const step of steps.filter((item) => item.status === 'completed' && item.compensationOnly !== true && item.kind !== 'review')) {
    const type = inferStepDeliverableType(step, run);
    const stepEvidence = step.evidence || [];
    const childArtifacts = step.output?.childTask?.artifacts || [];
    const hasFile = stepEvidence.some((item) => item.kind === 'file' && item.verified && isVerifiedArtifact(item.artifact))
      || evidence.some((item) => item.kind === 'file' && item.verified && isVerifiedArtifact(item.artifact)) || childArtifacts.length > 0;
    const hasConnection = stepEvidence.some((item) => item.kind === 'connection' && item.verified)
      || evidence.some((item) => item.kind === 'connection' && item.verified);
    const hasOperation = stepEvidence.some((item) => ['run', 'connection', 'operation'].includes(item.kind) && item.verified)
      || evidence.some((item) => ['run', 'connection', 'operation'].includes(item.kind) && item.verified);
    const hasResult = Boolean(text(step.output?.summary || step.output?.childTask?.summary))
      || stepEvidence.some((item) => item.verified && ['child_task', 'progress', 'review'].includes(item.kind));
    if (type === 'file') typedChecks.set('file', { kind: 'file', label: 'file deliverable', passed: hasFile, detail: 'A file deliverable needs a verified disk artifact.' });
    else if (type === 'connection') typedChecks.set('connection', { kind: 'connection', label: 'connection deliverable', passed: hasConnection, detail: 'A connection deliverable needs a verified live call.' });
    else if (type === 'operation') typedChecks.set('operation', { kind: 'operation', label: 'operation deliverable', passed: hasOperation, detail: 'An operation deliverable needs a verified runtime result.' });
    else if (type === 'mixed') typedChecks.set('mixed', { kind: 'mixed', label: 'mixed deliverable', passed: hasResult || hasFile || hasConnection || hasOperation, detail: 'A mixed deliverable needs at least one verified result.' });
    else typedChecks.set(type, { kind: type, label: `${type} deliverable`, passed: hasResult, detail: 'An answer or decision deliverable needs a persisted real result.' });
  }
  if (typedChecks.size) {
    const merged = new Map(checks.filter((item) => item.kind !== 'file' || typedChecks.has('file')).map((item) => [item.kind, item]));
    for (const [kind, check] of typedChecks) merged.set(kind, check);
    if (steps.some((step) => step.kind === 'review')) merged.set('review', { kind: 'review', label: 'review decision', passed: evidence.some((item) => item.kind === 'review' && item.verified), detail: 'A review step needs an explicit PASS result.' });
    checks.splice(0, checks.length, ...merged.values());
  }
  return { unfinished, checks, blocked: checks.filter((item) => !item.passed) };
}

module.exports = { evaluateNativeCompletion };
