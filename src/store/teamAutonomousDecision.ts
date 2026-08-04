import type { TaskRun } from '../types';
import { createAutonomousToolAction, validateAutonomousToolExecution } from '../engine/autonomousExecutionGate.mjs';

export function createTeamAutonomousDecisionRecorder(input: {
  getRun: () => TaskRun | undefined;
  updateRun: (mutate: (run: TaskRun) => void) => void;
}) {
  let sequence = 0;
  return async function recordTeamAutonomousDecision(employeeId: string, stepId: string, toolName: string) {
    const current = input.getRun();
    if (!current?.goalState?.goalId || !current.adaptivePlanGraph) return;
    sequence += 1;
    const proposalId = `proposal-${current.id}-${Date.now()}-${sequence}`;
    input.updateRun((run) => {
      run.autonomousDecisionProposal = {
        proposalVersion: 1,
        proposalId,
        source: 'model',
        goalId: run.goalState!.goalId,
        planRevision: run.adaptivePlanGraph!.revision,
        selectedAction: createAutonomousToolAction({
          stepId,
          employeeId,
          toolName,
          summary: `${run.memberSnapshot.find((member) => member.id === employeeId)?.name || employeeId} 在责任步骤中调用 ${toolName} 产生可验证证据。`,
        }),
        observedFactIds: run.situationModel?.confirmedFacts.slice(-12).map((fact) => fact.id) || [],
        publicRationale: '该工具由当前责任员工根据项目目标、阶段交接和真实现场选择；内核只校验目标、计划、权限和证据边界。',
        expectedEvidence: run.acceptanceCriteria || [],
        riskLevel: 'low',
        approvalRequired: false,
        createdAt: Date.now(),
      };
    });
    const authorizedRun = input.getRun();
    const gate = validateAutonomousToolExecution(authorizedRun, {
      proposalId,
      goalId: current.goalState.goalId,
      planRevision: current.adaptivePlanGraph.revision,
      stepId,
      employeeId,
      toolName,
    });
    if (!gate.allowed) throw new Error(gate.reason || '团队自主行动没有通过当前目标与计划校验');
  };
}
