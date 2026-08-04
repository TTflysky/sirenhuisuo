import { describe, expect, it } from 'vitest';
import { reconcileAutonomousControl } from '../../src/engine/autonomousControl.mjs';
import { createAutonomousToolAction, validateAutonomousToolExecution } from '../../src/engine/autonomousExecutionGate.mjs';

function authorizedRun(overrides = {}) {
  const base = reconcileAutonomousControl({
    id: 'run-one', teamId: 'team-one', status: 'running', title: 'Build', request: 'Build', goal: 'Build',
    createdAt: 1, updatedAt: 1, acceptanceCriteria: ['file exists'],
    memberSnapshot: [{ id: 'frontend', name: 'Frontend', role: 'coder' }],
    steps: [
      { id: 'brief', employeeId: 'planner', title: 'Brief', assignment: 'Brief', status: 'completed', dependsOnStepIds: [], events: [] },
      { id: 'build', employeeId: 'frontend', title: 'Build', assignment: 'Build', status: 'running', dependsOnStepIds: ['brief'], events: [] },
    ],
  }, { now: 2 });
  const proposalId = 'proposal-tool';
  const proposed = {
    ...base,
    autonomousDecisionProposal: {
      proposalVersion: 1, proposalId, source: 'model', goalId: base.goalState.goalId,
      planRevision: base.adaptivePlanGraph.revision,
      selectedAction: createAutonomousToolAction({ stepId: 'build', employeeId: 'frontend', toolName: 'write_file' }),
      observedFactIds: [], publicRationale: 'Build the assigned artifact.', expectedEvidence: ['file exists'],
      riskLevel: 'low', approvalRequired: false, createdAt: 3,
    },
    ...overrides,
  };
  return { run: reconcileAutonomousControl(proposed, { now: 3 }), proposalId };
}

describe('unified autonomous execution gate', () => {
  it('accepts a hosted tool action for the current responsibility step', () => {
    const { run, proposalId } = authorizedRun();
    expect(validateAutonomousToolExecution(run, {
      proposalId, goalId: run.goalState.goalId, planRevision: run.adaptivePlanGraph.revision,
      stepId: 'build', employeeId: 'frontend', toolName: 'write_file',
    })).toMatchObject({ allowed: true, errors: [] });
  });

  it('rejects stale plans, unresolved dependencies and the wrong employee', () => {
    const { run, proposalId } = authorizedRun();
    run.adaptivePlanGraph.nodes.find((node) => node.id === 'brief').status = 'queued';
    const gate = validateAutonomousToolExecution(run, {
      proposalId, goalId: run.goalState.goalId, planRevision: run.adaptivePlanGraph.revision - 1,
      stepId: 'build', employeeId: 'unrelated', toolName: 'write_file',
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/stale plan|unresolved dependencies|Wrong responsibility employee/u);
  });

  it('rejects a direct call whose accepted proposal belongs to another tool', () => {
    const { run, proposalId } = authorizedRun();
    const gate = validateAutonomousToolExecution(run, {
      proposalId, goalId: run.goalState.goalId, planRevision: run.adaptivePlanGraph.revision,
      stepId: 'build', employeeId: 'frontend', toolName: 'run_command',
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/tool name does not match/u);
  });
});
