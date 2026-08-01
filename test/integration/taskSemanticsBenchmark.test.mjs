import { describe, expect, it } from 'vitest';
import { createFallbackTaskDecision } from '../../src/engine/taskDecisionKernel.mjs';
import { taskSemanticCases } from '../fixtures/taskSemanticCases.mjs';

describe('task semantics benchmark', () => {
  it('keeps goal, turn relation, and route accuracy at or above 98% across 400 trajectories', () => {
    const failures = [];
    for (const item of taskSemanticCases) {
      const decision = createFallbackTaskDecision(item);
      const expected = item.expected;
      const passed = decision.mode === expected.mode
        && decision.turnRelation === expected.relation
        && (!expected.route || decision.primaryRoute === expected.route);
      if (!passed) failures.push({ id: item.id, expected, actual: { mode: decision.mode, relation: decision.turnRelation, route: decision.primaryRoute } });
    }
    const accuracy = (taskSemanticCases.length - failures.length) / taskSemanticCases.length;
    expect(taskSemanticCases.length).toBeGreaterThanOrEqual(400);
    expect(accuracy, JSON.stringify(failures.slice(0, 12), null, 2)).toBeGreaterThanOrEqual(0.98);
  });
});
