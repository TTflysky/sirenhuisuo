import type { ModelConfig, TaskRunMemberSnapshot } from '../types';

export function syncNativeTaskRoster(
  taskId: string,
  members: Array<TaskRunMemberSnapshot & { modelConfig: ModelConfig }>,
  reason: string,
  affectedNodeIds: string[] = [],
  acceptanceCriteria: string[] = [],
) {
  return window.electronAPI?.taskExecutionSyncMembers?.({
    taskId, members, reason, affectedNodeIds, acceptanceCriteria,
  });
}
