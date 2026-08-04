import { describe, expect, it } from 'vitest';
import {
  buildPinnedSkillInstruction,
  getUserActionForFailure,
  isAllowedPinnedSkillSource,
  isPinnedSkillRuleDocument,
} from '../../src/data/agentLoopPolicy';

describe('agent loop policy', () => {
  it('keeps explicit Skill installation inside the pinned repository', () => {
    const source = 'https://github.com/example/skills/tree/main/my-skill';
    expect(isAllowedPinnedSkillSource('https://raw.githubusercontent.com/example/skills/main/my-skill/SKILL.md', source)).toBe(true);
    expect(isAllowedPinnedSkillSource('https://skillhub.cn/example/my-skill', source)).toBe(false);
    expect(isPinnedSkillRuleDocument('https://raw.githubusercontent.com/example/skills/main/my-skill/SKILL.md', source)).toBe(true);
    expect(buildPinnedSkillInstruction(source)).toContain('禁止搜索 SkillsMP、SkillHub');
  });

  it('turns technical failure classes into a concrete user action', () => {
    expect(getUserActionForFailure('401 unauthorized')).toContain('设置 → 模型');
    expect(getUserActionForFailure('Obsidian 目录未配置')).toContain('连接器配置窗口');
  });
});
