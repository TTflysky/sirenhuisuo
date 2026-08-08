import { describe, expect, it } from 'vitest';
import { compileDeliverableTeamPlan } from '../../src/engine/deliverableTeamPlanner';
import type { Employee } from '../../src/types';

function employee(id: string, capabilities: string[], stationIndex: number): Employee {
  return {
    id,
    name: id,
    title: `${id} specialist`,
    role: id === 'reviewer' ? 'checker' : id === 'coordinator' ? 'pm' : 'coder',
    avatar: 'avatar-01-red',
    avatarKind: 'preset',
    statusColor: '#fff',
    stationIndex,
    isOnline: true,
    isWorking: false,
    capabilities,
  };
}

const employees = [
  employee('frontend', ['frontend'], 0),
  employee('backend', ['backend'], 1),
  employee('coordinator', ['coordination'], 2),
  employee('reviewer', ['review'], 3),
];

describe('deliverable team planner', () => {
  it('builds parallel deliverables and waits for both before integration', () => {
    const plan = compileDeliverableTeamPlan({
      goal: 'Build and verify a small product',
      employees,
      memberIds: employees.map((member) => member.id),
      decision: {
        mode: 'execute',
        goal: 'Build and verify a small product',
        primaryRoute: 'team_dispatch',
        deliverableType: 'mixed',
        acceptanceCriteria: ['Frontend and backend are integrated'],
        requiredConstraints: [],
        requiredCapabilities: ['frontend', 'backend', 'coordination', 'review'],
        deliverables: [
          {
            id: 'web-client', label: 'Web client', type: 'file', required: true,
            requiredCapabilities: ['frontend'], acceptanceCriteria: ['Client builds'],
            outputPath: 'artifacts/client', verification: ['Run the client build'],
          },
          {
            id: 'api', label: 'API', type: 'file', required: true,
            requiredCapabilities: ['backend'], acceptanceCriteria: ['API tests pass'],
            outputPath: 'artifacts/api', verification: ['Run API tests'],
          },
        ],
        requiresEvidence: true,
        needsUser: false,
        missingUserCondition: '',
        searchQuery: '',
        decisionReason: 'Two independent deliverables require a team.',
        confidence: 1,
        source: 'model',
      },
    });

    expect(plan.parallelGroups[0]).toEqual(['web-client', 'api']);
    expect(plan.steps.find((step) => step.id === 'integration')?.dependsOnStepIds).toEqual(['web-client', 'api']);
    expect(plan.steps.find((step) => step.id === 'web-client')).toMatchObject({
      employeeId: 'frontend', outputPath: 'artifacts/client', requiredCapabilities: ['frontend'],
    });
    expect(plan.steps.find((step) => step.id === 'api')?.employeeId).toBe('backend');
    expect(plan.steps.at(-1)).toMatchObject({ id: 'final-review', employeeId: 'reviewer', kind: 'review' });
  });

  it('preserves deliverable dependencies and creates complete task contracts', () => {
    const plan = compileDeliverableTeamPlan({
      goal: 'Implement after the API contract is approved',
      employees,
      memberIds: employees.map((member) => member.id),
      decision: {
        mode: 'execute', goal: 'Implement after the API contract is approved', primaryRoute: 'team_dispatch', deliverableType: 'mixed',
        acceptanceCriteria: ['Implementation follows the contract'], requiredConstraints: [], requiredCapabilities: ['backend', 'frontend'],
        deliverables: [
          { id: 'contract', label: 'API contract', type: 'decision', required: true, requiredCapabilities: ['backend'] },
          { id: 'client', label: 'Client implementation', type: 'file', required: true, requiredCapabilities: ['frontend'], dependsOn: ['contract'] },
        ],
        requiresEvidence: true, needsUser: false, missingUserCondition: '', searchQuery: '', decisionReason: 'Dependency is explicit', confidence: 1, source: 'model',
      },
    });

    const client = plan.steps.find((step) => step.id === 'client');
    expect(client?.dependsOnStepIds).toEqual(['contract']);
    expect(client?.taskContract).toMatchObject({
      contractVersion: 1,
      inputRefs: ['verified:contract'],
      output: { type: 'file', description: 'Client implementation' },
      budget: { maxModelRounds: 8, maxToolCalls: 24, maxReworkAttempts: 2 },
    });
    expect(client?.taskContract?.completionConditions.length).toBeGreaterThan(0);
    expect(client?.taskContract?.verification.length).toBeGreaterThan(0);
  });

  it('reports capability gaps instead of hiding them behind a generic assignee', () => {
    const plan = compileDeliverableTeamPlan({
      goal: 'Produce a backend service',
      employees: [employees[0]],
      memberIds: ['frontend'],
      decision: {
        mode: 'execute', goal: 'Produce a backend service', primaryRoute: 'team_dispatch', deliverableType: 'file',
        acceptanceCriteria: ['Service tests pass'], requiredConstraints: [], requiredCapabilities: ['backend'],
        deliverables: [{ id: 'service', label: 'Backend service', type: 'file', required: true, requiredCapabilities: ['backend'] }],
        requiresEvidence: true, needsUser: false, missingUserCondition: '', searchQuery: '', decisionReason: 'Backend capability required', confidence: 1, source: 'model',
      },
    });

    expect(plan.capabilityGaps).toContain('backend');
    expect(plan.steps.find((step) => step.id === 'service')?.requiredCapabilities).toEqual(['backend']);
  });
});
