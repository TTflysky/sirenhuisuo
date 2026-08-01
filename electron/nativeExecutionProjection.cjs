const { projectExecutionState } = require('./executionObservability.cjs');
const { publicMember } = require('./nativeExecutionPolicy.cjs');

function projectNativeJob(job, protocolVersion) {
  return {
    protocolVersion,
    jobId: job.jobId,
    taskId: job.taskId,
    state: job.state,
    queuePosition: job.queuePosition,
    waitingFor: job.waitingFor,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    lastProgressAt: job.lastProgressAt,
    currentActivity: job.currentActivity,
    finishedAt: job.finishedAt,
    currentStepId: job.currentStepId,
    currentMember: job.currentMember ? publicMember(job.currentMember) : undefined,
    modelRounds: job.modelRounds,
    toolCalls: job.toolCalls,
    lastError: job.lastError,
    eventSequence: job.eventSequence,
    semanticState: projectExecutionState(job),
  };
}

module.exports = { projectNativeJob };
