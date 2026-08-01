import { createFallbackTaskDecision } from '../src/engine/taskDecisionKernel.mjs';
import { taskSemanticCases } from '../test/fixtures/taskSemanticCases.mjs';

const failures = [];
for (const item of taskSemanticCases) {
  const decision = createFallbackTaskDecision(item);
  const expected = item.expected;
  if (decision.mode !== expected.mode || decision.turnRelation !== expected.relation || (expected.route && decision.primaryRoute !== expected.route)) {
    failures.push({ id: item.id, expected, actual: { mode: decision.mode, relation: decision.turnRelation, route: decision.primaryRoute } });
  }
}
const passed = taskSemanticCases.length - failures.length;
const accuracy = passed / taskSemanticCases.length;
if (taskSemanticCases.length < 400) throw new Error(`Task semantics benchmark requires at least 400 cases, got ${taskSemanticCases.length}`);
if (accuracy < 0.98) throw new Error(`Task semantics benchmark failed: ${passed}/${taskSemanticCases.length}\n${JSON.stringify(failures.slice(0, 20), null, 2)}`);
console.log(JSON.stringify({ passed: true, cases: taskSemanticCases.length, successful: passed, accuracy }, null, 2));
