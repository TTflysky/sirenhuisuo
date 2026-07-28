import assert from 'node:assert/strict';
import {
  assertValidPlan,
  createPlan,
  createTaskContract,
  parsePlan,
  serializePlan,
  validatePlan,
  validateTaskContract,
} from '../src/engine/taskPlan.mjs';

const contract = createTaskContract({
  contractId: 'contract-test-1',
  scope: 'team:test',
  decision: {
    mode: 'execute',
    goal: '查询销售数据并生成报告',
    primaryRoute: 'connector',
    acceptanceCriteria: ['查询结果真实可读', '报告文件可以打开'],
    requiredConstraints: ['只读查询', '生成 PDF'],
    requiresEvidence: true,
    needsUser: false,
    source: 'rules',
    confidence: 1,
  },
});
assert.equal(validateTaskContract(contract).valid, true);

const plan = createPlan({
  planId: 'plan-test-1',
  contract,
  steps: [
    {
      stepId: 'query', type: 'connector', connector: 'postgres_reader', input: { query: 'sales' },
      expectedOutputSchema: { type: 'array' }, sideEffect: false,
    },
    {
      stepId: 'report', type: 'tool', connector: 'write_file', input: { path: 'report.pdf' },
      expectedOutputSchema: { type: 'object' }, dependsOn: ['query'], sideEffect: true,
      idempotencyKey: 'contract-test-1-report', compensateStepId: 'cleanup',
    },
    {
      stepId: 'cleanup', type: 'tool', connector: 'run_command', input: { command: 'cleanup' },
      expectedOutputSchema: { type: 'object' }, sideEffect: true, idempotencyKey: 'contract-test-1-cleanup',
    },
  ],
});
assert.equal(validatePlan(plan).valid, true);
assert.deepEqual(parsePlan(serializePlan(plan)), plan);
assert.equal(validatePlan({ ...plan, steps: [{ ...plan.steps[0], stepId: 'query' }, { ...plan.steps[1], stepId: 'query' }] }).valid, false);
assert.equal(validatePlan({ ...plan, steps: [{ ...plan.steps[0], dependsOn: ['missing'] }, ...plan.steps.slice(1)] }).valid, false);
assert.equal(validatePlan({ ...plan, steps: [{ ...plan.steps[0], sideEffect: true, idempotencyKey: '' }, ...plan.steps.slice(1)] }).valid, false);
assert.equal(validatePlan({ ...plan, steps: [{ ...plan.steps[0], dependsOn: ['report'] }, ...plan.steps.slice(1)] }).valid, false);
assert.throws(() => assertValidPlan({ ...plan, steps: [] }), /Invalid task plan/);

console.log(JSON.stringify({ passed: true, contractVersion: contract.contractVersion, planVersion: plan.planVersion, steps: plan.steps.length }));
