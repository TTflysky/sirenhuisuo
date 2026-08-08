function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function uniqueVerifiedEvidence(items) {
  return items.filter((item, index, all) => {
    const key = item.id || item.verificationId || item.artifactId || `${item.stepId || 'task'}:${item.summary || item.label || index}`;
    return all.findIndex((candidate, candidateIndex) => {
      const candidateKey = candidate.id || candidate.verificationId || candidate.artifactId
        || `${candidate.stepId || 'task'}:${candidate.summary || candidate.label || candidateIndex}`;
      return candidateKey === key;
    }) === index;
  });
}

function projectTaskContext(task, limit) {
  const verifiedStepEvidence = (task.steps || []).flatMap((step) => (step.evidence || [])
    .filter((item) => item.verified === true)
    .map((item) => ({ ...clone(item), stepId: step.id })));
  const verifiedVerifications = (task.verifications || [])
    .filter((item) => item.status === 'passed')
    .map((item) => ({ ...clone(item), evidenceType: 'verification' }));
  const contractedSteps = (task.steps || []).filter((step) => step.compensationOnly !== true && step.taskContract);
  return {
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
    verifiedEvidence: uniqueVerifiedEvidence([...verifiedStepEvidence, ...verifiedVerifications]).slice(-limit),
    contractCoverage: {
      total: (task.steps || []).filter((step) => step.compensationOnly !== true).length,
      contracted: contractedSteps.length,
      complete: contractedSteps.length === (task.steps || []).filter((step) => step.compensationOnly !== true).length,
    },
    recoveryEvidence: clone(task.recoveryContext?.completedEvidence || []),
  };
}

module.exports = { projectTaskContext };
