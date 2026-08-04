import { describe, expect, it } from 'vitest';
import {
  createAutonomousDecisionProposal,
  selectAutonomousDecision,
  validateAutonomousDecisionProposal,
} from '../../src/engine/autonomousDecisionAuthority.mjs';

function makeRun(overrides = {}) {
  return {
    goalState: { goalId: 'goal-one' },
    adaptivePlanGraph: {
      revision: 2,
      nodes: [
        { id: 'brief', status: 'completed', dependsOn: [] },
        { id: 'build', status: 'queued', dependsOn: ['brief'] },
      ],
    },
    situationModel: { blockedBy: [] },
    ...overrides,
  };
}

describe('autonomous decision authority', () => {
  it('accepts a current model action whose dependencies are satisfied', () => {
    const run = makeRun();
    const proposal = createAutonomousDecisionProposal({
      proposalId: 'proposal-current', source: 'model', goalId: 'goal-one', planRevision: 2,
      selectedAction: { kind: 'start_step', stepId: 'build', summary: '开始实现并收集运行证据。' },
      publicRationale: '产品简报已经完成。',
    }, run);
    const selected = selectAutonomousDecision(run, { kind: 'observe', summary: 'fallback' }, proposal);
    expect(selected.authority).toMatchObject({ accepted: true, source: 'model', proposalId: 'proposal-current' });
    expect(selected.action).toMatchObject({ kind: 'start_step', stepId: 'build' });
  });

  it('rejects stale goals, stale plans and unsatisfied dependencies', () => {
    const run = makeRun({
      adaptivePlanGraph: {
        revision: 3,
        nodes: [
          { id: 'brief', status: 'queued', dependsOn: [] },
          { id: 'build', status: 'queued', dependsOn: ['brief'] },
        ],
      },
    });
    const validation = validateAutonomousDecisionProposal(run, {
      source: 'model', goalId: 'old-goal', planRevision: 2,
      selectedAction: { kind: 'start_step', stepId: 'build', summary: '开始实现。' },
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toMatch(/当前目标|过期计划|等待依赖/u);
  });

  it('does not reuse an already consumed proposal', () => {
    const run = makeRun();
    const selected = selectAutonomousDecision(run, { kind: 'observe', summary: '重新观察现场。' }, {
      proposalId: 'proposal-used', source: 'runtime', goalId: 'goal-one', planRevision: 2,
      selectedAction: { kind: 'use_tool', toolName: 'write_file', summary: '写入真实文件。' },
    }, { consumedProposalId: 'proposal-used' });
    expect(selected.authority.accepted).toBe(false);
    expect(selected.action.kind).toBe('observe');
  });

  it('requires a concrete missing condition before waiting for the user', () => {
    const validation = validateAutonomousDecisionProposal(makeRun(), {
      source: 'model', goalId: 'goal-one', planRevision: 2,
      selectedAction: { kind: 'await_user', summary: '等待用户。' },
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toMatch(/具体条件/u);
  });
});
