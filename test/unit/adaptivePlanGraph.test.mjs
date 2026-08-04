import { describe, expect, it } from 'vitest';
import {
  applyAdaptivePlanRevision,
  assessAdaptiveBudget,
  createAdaptivePlanGraph,
  downstreamNodeIds,
  projectGraphToTaskSteps,
  readyAdaptiveNodes,
  selectAdaptiveRecovery,
  validateAdaptivePlanGraph,
} from '../../src/engine/adaptivePlanGraph.mjs';

function graph() {
  return createAdaptivePlanGraph({
    goalId: 'goal-one',
    nodes: [
      { id: 'brief', title: 'Brief', status: 'completed', evidence: [{ id: 'brief-file', verified: true }] },
      { id: 'build', title: 'Build', employeeId: 'frontend', dependsOnStepIds: ['brief'], status: 'failed', attempts: 2, strategy: { routeId: 'route-a', toolName: 'run_command', description: 'old route', fingerprint: 'route-a' } },
      { id: 'test', title: 'Test', employeeId: 'qa', dependsOnStepIds: ['build'], status: 'completed' },
      { id: 'delivery', title: 'Delivery', employeeId: 'pm', dependsOnStepIds: ['test'], status: 'queued' },
    ],
    now: 10,
  });
}

describe('adaptive plan graph', () => {
  it('creates a valid graph and finds dependency impact', () => {
    const value = graph();
    expect(validateAdaptivePlanGraph(value).valid).toBe(true);
    expect(value.nodes.find((node) => node.id === 'brief').status).toBe('completed');
    expect(downstreamNodeIds(value, ['build'])).toEqual(['build', 'test', 'delivery']);
  });

  it('switches to a materially different route and preserves unrelated completed evidence', () => {
    const revised = applyAdaptivePlanRevision(graph(), {
      trigger: 'failure',
      reason: 'The command route failed twice; use browser verification.',
      operations: [{ type: 'switch_route', nodeId: 'build', strategy: { routeId: 'browser', toolName: 'verify_web_artifact', description: 'browser verification', fingerprint: 'browser-verification' } }],
    }, { now: 20 });
    expect(revised.revision).toBe(2);
    expect(revised.nodes.find((node) => node.id === 'build').status).toBe('queued');
    expect(revised.nodes.find((node) => node.id === 'build').strategy.fingerprint).toBe('browser-verification');
    expect(revised.revisionHistory.at(-1).preservedCompletedNodeIds).toContain('brief');
    expect(() => applyAdaptivePlanRevision(revised, {
      reason: 'repeat',
      operations: [{ type: 'switch_route', nodeId: 'build', strategy: { fingerprint: 'browser-verification' } }],
    })).toThrow(/materially different/u);
  });

  it('reopens only the responsible node and affected downstream nodes', () => {
    const revised = applyAdaptivePlanRevision(graph(), {
      trigger: 'review',
      reason: 'The implementation failed acceptance.',
      operations: [{ type: 'reopen_node', nodeId: 'build', reason: 'Fix implementation' }],
    }, { now: 20 });
    expect(revised.nodes.find((node) => node.id === 'brief').status).toBe('completed');
    expect(revised.nodes.find((node) => node.id === 'build').status).toBe('queued');
    expect(revised.nodes.find((node) => node.id === 'test').status).toBe('queued');
    expect(revised.nodes.find((node) => node.id === 'delivery').status).toBe('queued');
  });

  it('supports owner replacement without rebuilding the project', () => {
    const revised = applyAdaptivePlanRevision(graph(), {
      trigger: 'staffing',
      reason: 'A frontend specialist is now available.',
      operations: [{ type: 'reassign_node', nodeId: 'build', employeeId: 'frontend-two', employeeName: 'Frontend Two' }],
    }, { now: 20 });
    expect(revised.graphId).toBe(graph().graphId);
    expect(revised.nodes.find((node) => node.id === 'build').ownerEmployeeId).toBe('frontend-two');
    expect(revised.revisionHistory.at(-1).affectedNodeIds).toEqual(['build']);
  });

  it('records a runtime staffing change with its impact and new acceptance requirements', () => {
    const revised = applyAdaptivePlanRevision(graph(), {
      trigger: 'staffing',
      reason: 'The owner added a responsive UI specialist.',
      operations: [{
        type: 'register_member', employeeId: 'responsive-ui', employeeName: 'Responsive UI',
        affectedNodeIds: ['build', 'test'], acceptanceCriteria: ['Verify the 375px viewport.'],
      }],
    }, { now: 20 });
    expect(revised.rosterChanges.at(-1)).toMatchObject({
      employeeId: 'responsive-ui', affectedNodeIds: ['build', 'test'], acceptanceCriteria: ['Verify the 375px viewport.'],
    });
    expect(revised.revisionHistory.at(-1).affectedNodeIds).toEqual(['build', 'test']);
    expect(revised.revisionHistory.at(-1).preservedCompletedNodeIds).toContain('brief');
  });

  it('separates retry, user wait, alternative discovery and real route revision', () => {
    const value = graph();
    expect(selectAdaptiveRecovery(value, { nodeId: 'build', error: 'network timeout', sameRouteFailures: 1 }).action).toBe('retry');
    expect(selectAdaptiveRecovery(value, { nodeId: 'build', error: '401 missing api key', sameRouteFailures: 1 }).action).toBe('await_user');
    expect(selectAdaptiveRecovery(value, { nodeId: 'build', error: 'invalid result', sameRouteFailures: 2 }).action).toBe('discover_alternative');
    expect(selectAdaptiveRecovery(value, { nodeId: 'build', error: 'invalid result', sameRouteFailures: 2, alternativeStrategy: { fingerprint: 'new-route', description: 'new implementation' } }).action).toBe('revise');
  });

  it('uses progress, context, risk and hard limits instead of one fixed step count', () => {
    expect(assessAdaptiveBudget({ repeatedRouteDetected: true }).action).toBe('replan');
    expect(assessAdaptiveBudget({ contextRatio: 0.75 }).action).toBe('compact');
    expect(assessAdaptiveBudget({ contextRatio: 0.9 }).action).toBe('checkpoint');
    expect(assessAdaptiveBudget({ needsApproval: true }).action).toBe('await_user');
    expect(assessAdaptiveBudget({ usage: { toolCalls: 72 } }).action).toBe('stop');
  });

  it('projects the revised graph back to executable task steps', () => {
    const revised = applyAdaptivePlanRevision(graph(), {
      reason: 'Replace owner',
      operations: [{ type: 'reassign_node', nodeId: 'build', employeeId: 'frontend-two' }],
    });
    const steps = projectGraphToTaskSteps(revised, []);
    expect(steps.find((step) => step.id === 'build').employeeId).toBe('frontend-two');
    expect(steps.find((step) => step.id === 'build').adaptivePlanRevision).toBe(2);
    expect(readyAdaptiveNodes(revised).map((node) => node.id)).toContain('build');
  });
});
