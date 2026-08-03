import { describe, expect, it } from 'vitest';
import {
  applyGoalSteering,
  createGoalState,
  deriveSituationModel,
  reconcileAutonomousControl,
  restoreGoalState,
} from '../../src/engine/autonomousControl.mjs';

function makeRun(overrides = {}) {
  return {
    id: 'run-autonomous',
    teamId: 'team-one',
    conversationId: 'conversation-one',
    request: 'Build a knowledge base client',
    goal: 'Build a knowledge base client',
    acceptanceCriteria: ['A real file exists', 'The client opens successfully'],
    status: 'queued',
    steps: [],
    memberSnapshot: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('autonomous control', () => {
  it('keeps goal identity stable across reconciliation and restore', () => {
    const first = reconcileAutonomousControl(makeRun(), { now: 200 });
    const restored = restoreGoalState(JSON.parse(JSON.stringify(first.goalState)), makeRun());
    const second = reconcileAutonomousControl({ ...first, goalState: restored, updatedAt: 300 }, { now: 300 });
    expect(second.goalState.goalId).toBe(first.goalState.goalId);
    expect(second.goalState.projectId).toBe(first.goalState.projectId);
    expect(second.goalState.conversationId).toBe('conversation-one');
  });

  it('separates a correction, a constraint and a genuinely new goal', () => {
    const original = createGoalState({ taskId: 'one', goal: 'Build desktop client', createdAt: 1 });
    const corrected = applyGoalSteering(original, { relation: 'correction', instruction: 'Build a desktop knowledge client', at: 2 });
    const constrained = applyGoalSteering(corrected, { relation: 'constraint', instruction: 'Keep existing user data', at: 3 });
    const nextGoal = applyGoalSteering(constrained, { relation: 'new_goal', instruction: 'Build an unrelated mobile app', at: 4 });
    expect(corrected.goalId).toBe(original.goalId);
    expect(corrected.originalGoal).toBe('Build desktop client');
    expect(corrected.currentGoal).toContain('Build a desktop knowledge client');
    expect(constrained.constraints).toContain('Keep existing user data');
    expect(nextGoal.goalId).not.toBe(original.goalId);
    expect(nextGoal.originalGoal).toBe('Build an unrelated mobile app');
  });

  it('never promotes unverified evidence to a confirmed fact', () => {
    const situation = deriveSituationModel(makeRun({
      evidence: [
        { ts: 10, summary: 'File exists', verified: true },
        { ts: 11, summary: 'Model says the app runs', verified: false },
      ],
    }));
    expect(situation.confirmedFacts.map((item) => item.statement)).toContain('File exists');
    expect(situation.confirmedFacts.map((item) => item.statement)).not.toContain('Model says the app runs');
    expect(situation.assumptions.map((item) => item.statement)).toContain('Model says the app runs');
  });

  it('merges routed user steering once while keeping separate goals isolated', () => {
    const run = makeRun({
      context: {
        events: [
          { id: 'correction-one', ts: 120, type: 'correction', source: 'user', summary: 'Keep the desktop UI', data: { action: 'preempt_and_replan' } },
          { id: 'new-goal-one', ts: 130, type: 'steering', source: 'user', summary: 'Build another mobile app', data: { action: 'queue_separately' } },
        ],
      },
    });
    const first = reconcileAutonomousControl(run, { now: 200 });
    const second = reconcileAutonomousControl({ ...first, updatedAt: 300 }, { now: 300 });
    expect(first.goalState.currentGoal).toContain('Keep the desktop UI');
    expect(first.goalState.currentGoal).not.toContain('Build another mobile app');
    expect(first.goalState.scopeChanges).toHaveLength(1);
    expect(second.goalState.scopeChanges).toHaveLength(1);
  });

  it('switches away from a route after two failed attempts', () => {
    const run = makeRun({
      status: 'running',
      recoveryContext: {
        controller: {
          routeHistory: [{ id: 'route-a', toolName: 'read_skill', strategySignature: 'repeat', attempts: 2, failures: 2, successes: 0, lastOutcome: 'same failure', updatedAt: 30 }],
        },
      },
    });
    const reconciled = reconcileAutonomousControl(run, { now: 40 });
    expect(reconciled.autonomousControl.repeatedRouteDetected).toBe(true);
    expect(reconciled.autonomousControl.currentDecision.selectedAction.kind).toBe('switch_route');
  });

  it('does not manufacture new decisions for timestamp-only updates', () => {
    const first = reconcileAutonomousControl(makeRun(), { now: 200 });
    const second = reconcileAutonomousControl({ ...first, updatedAt: 999 }, { now: 999 });
    expect(second.autonomousControl.currentDecision.decisionId).toBe(first.autonomousControl.currentDecision.decisionId);
    expect(second.autonomousControl.decisionHistory).toHaveLength(1);
  });

  it('publishes audit summaries without hidden reasoning fields', () => {
    const control = reconcileAutonomousControl(makeRun(), { now: 200 }).autonomousControl;
    const serialized = JSON.stringify(control).toLowerCase();
    expect(control.publicSummary.currentGoal).toBe('Build a knowledge base client');
    expect(serialized).not.toContain('chainofthought');
    expect(serialized).not.toContain('hiddenreasoning');
    expect(serialized).not.toContain('思维链');
  });
});
