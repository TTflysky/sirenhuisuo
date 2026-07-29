import type { SkillReference, SkillUsageEvidence } from '../types';
import { readSkill, skillInstructionText } from '../data/skills';

export async function resolveSkillContextWithEvidence(refs: SkillReference[]): Promise<{
  context: string;
  evidence: SkillUsageEvidence[];
}> {
  const chosen = refs.slice(0, 5);
  const evidence: SkillUsageEvidence[] = chosen.map((ref) => ({
    ts: Date.now(), skillId: ref.id, skillName: ref.name, action: 'matched', stage: 'selection',
    reason: '用户通过 @ 明确选择了这个 Skill', verified: true, source: 'chat',
  }));
  const bodies = await Promise.all(chosen.map(async (ref) => {
    try {
      const skill = await readSkill(ref.id);
      evidence.push({
        ts: Date.now(), skillId: ref.id, skillName: skill.name, action: 'read', stage: 'readback',
        reason: '客户端已读取 Skill 主规则和引用文档', verified: true, source: 'chat',
      });
      return skill;
    } catch (error) {
      evidence.push({
        ts: Date.now(), skillId: ref.id, skillName: ref.name, action: 'read-failed', stage: 'readback',
        reason: '客户端读取 Skill 失败', detail: String(error).slice(0, 240), verified: false, source: 'chat',
      });
      return null;
    }
  }));
  return {
    context: bodies.filter(Boolean).map((skill) => `--- SKILL ${skill!.name} (${skill!.id}) ---\n${skillInstructionText(skill!, 60000)}\n--- END SKILL ---`).join('\n'),
    evidence,
  };
}

export async function resolveSkillContext(refs: SkillReference[]): Promise<string> {
  return (await resolveSkillContextWithEvidence(refs)).context;
}
