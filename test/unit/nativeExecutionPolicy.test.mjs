import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { supportsDynamicDelegation, toolAvailableForStep, structuredReviewCompletesStep, substantiveDecisionCompletesStep, requiresLongModelRequest, shouldExtendModelRoundBudget, verifiedFileStepCompletesStep } = require('../../electron/nativeExecutionPolicy.cjs');

describe('native execution completion policy', () => {
  it('keeps a fixed coding DAG from duplicating planned work through delegation', () => {
    expect(supportsDynamicDelegation({})).toBe(true);
    expect(supportsDynamicDelegation({ codingProject: { codingProjectVersion: 2 } })).toBe(false);
    expect(toolAvailableForStep('delegate_subtask', { codingProject: { codingProjectVersion: 2 } }, { kind: 'work' })).toBe(false);
  });

  it('exposes review submission only to formal review steps', () => {
    expect(toolAvailableForStep('submit_review', {}, { kind: 'work' })).toBe(false);
    expect(toolAvailableForStep('submit_review', {}, { kind: 'review' })).toBe(true);
    expect(structuredReviewCompletesStep({ kind: 'work' }, 'decision', { decision: 'pass' })).toBe(false);
    expect(structuredReviewCompletesStep({ kind: 'review' }, 'decision', { decision: 'reject' })).toBe(true);
    expect(structuredReviewCompletesStep({ kind: 'review', deliverableType: 'mixed' }, 'mixed', { decision: 'reject' })).toBe(true);
  });

  it('lets substantive decision steps finish without weakening file or review gates', () => {
    const decision = '产品范围包括离线原型、文生图与图生图交互、尺寸和像素档位、Mock 生成链路、密钥安全边界、验收标准及后续真实 API 联调限制。该结论可直接交给架构与设计步骤继续执行。';
    expect(substantiveDecisionCompletesStep({ kind: 'work' }, 'decision', decision)).toBe(true);
    expect(substantiveDecisionCompletesStep({ kind: 'work' }, 'decision', '收到，我会继续处理。')).toBe(false);
    expect(substantiveDecisionCompletesStep({ kind: 'review' }, 'decision', decision)).toBe(false);
    expect(substantiveDecisionCompletesStep({ kind: 'work' }, 'file', decision)).toBe(false);
  });

  it('reserves the long model window for code and file generation', () => {
    expect(requiresLongModelRequest({ codingRole: 'frontend' }, 'file')).toBe(true);
    expect(requiresLongModelRequest({ codingRole: 'backend' }, 'answer')).toBe(true);
    expect(requiresLongModelRequest({ codingRole: 'product' }, 'decision')).toBe(false);
    expect(requiresLongModelRequest({ kind: 'review' }, 'decision')).toBe(false);
  });

  it('extends a long step only after material tool progress', () => {
    const frontend = { codingRole: 'frontend' };
    expect(shouldExtendModelRoundBudget(frontend, 'file', [
      { name: 'list_files', success: true },
      { name: 'read_file', success: true },
    ])).toBe(false);
    expect(shouldExtendModelRoundBudget(frontend, 'file', [
      { name: 'write_file', success: true },
    ])).toBe(true);
    expect(shouldExtendModelRoundBudget({ codingRole: 'product' }, 'decision', [
      { name: 'run_command', success: true },
    ])).toBe(false);
  });

  it('finishes file steps from verified disk and command evidence before text fidelity checks', () => {
    const verification = { name: 'run_command', success: true, args: '{"cmd":"node --check app.js","verification":true}' };
    const file = { kind: 'file', verified: true };
    expect(verifiedFileStepCompletesStep({ kind: 'work' }, 'file', [verification], [file])).toBe(true);
    expect(verifiedFileStepCompletesStep({ kind: 'work' }, 'file', [], [file])).toBe(false);
    expect(verifiedFileStepCompletesStep({ kind: 'work' }, 'file', [verification], [])).toBe(false);
    expect(verifiedFileStepCompletesStep({ kind: 'review' }, 'file', [verification], [file])).toBe(false);
  });
});
