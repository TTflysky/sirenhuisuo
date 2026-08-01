import { describe, expect, it } from 'vitest';
import { resolveDispatchContinuity, resolveDispatchRequest } from '../../src/engine/conversationDispatchContext.mjs';

describe('conversation dispatch continuity', () => {
  it('carries the prior assistant proposal into a contextual dispatch request', () => {
    const result = resolveDispatchRequest('按第二次提议拉群把项目做完', [
      { role: 'user', content: '给我做一个安卓端的图片生成器，风格和功能板块都在图片里，你叫人把这个项目做一下。' },
      { role: 'assistant', content: '建议配置 UI 设计师、移动应用开发者、AI 工程师和审查者。' },
    ]);
    expect(result).toContain('安卓端的图片生成器');
    expect(result).toContain('移动应用开发者');
    expect(result).toContain('老板最新调度要求');
  });

  it('does not replace a complete current goal with old dialogue', () => {
    const result = resolveDispatchRequest('开发一个安卓图片生成 APP', [
      { role: 'user', content: '做一个网页' },
      { role: 'assistant', content: '建议只安排网页设计师。' },
    ]);
    expect(result).toBe('开发一个安卓图片生成 APP');
  });

  it('recovers the original mobile product goal and the full specialist proposal', () => {
    const result = resolveDispatchContinuity('可以，按第二次提议拉群', [
      { role: 'user', content: '我要做一个安卓端图片生成 APP，参考附件里的界面与功能。' },
      { role: 'assistant', content: '第一次建议只安排 UI 设计师。' },
      { role: 'user', content: '这不够，开发、模型接入和验收也要有人负责。' },
      { role: 'assistant', content: '第二次建议配置产品协调、软件架构、UI/UX、移动应用开发、AI 模型接入、后端服务和 QA 审查人员。' },
    ]);
    expect(result.contextual).toBe(true);
    expect(result.originalGoal).toContain('安卓端图片生成 APP');
    expect(result.proposal).toContain('移动应用开发');
    expect(result.requiredCapabilities).toEqual(expect.arrayContaining([
      'coordination', 'architecture', 'ui_ux', 'frontend', 'backend', 'coding', 'review', 'connector',
    ]));
  });
});
