import { describe, expect, it } from 'vitest';
import { getExecutionFailureStage, humanizeExecutionError } from '../../src/data/assistantPresentation';

describe('assistant execution failure presentation', () => {
  it('does not mislabel a blocked native Skill installer as an AI model failure', () => {
    const error = 'Tool install_skill requires unavailable capability skillhub';
    expect(getExecutionFailureStage(error, '连接 AI 模型')).toBe('检查技能安装能力');
    expect(humanizeExecutionError(error)).toContain('工具能力检查');
  });
});
