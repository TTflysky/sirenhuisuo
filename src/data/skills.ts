import type { Skill, SkillReference } from '../types';

export async function listSkills(): Promise<Skill[]> {
  if (!window.electronAPI?.skillsList) return [];
  const result = await window.electronAPI.skillsList();
  if (!result.ok) throw new Error(result.error ?? '技能扫描失败');
  return result.skills ?? [];
}

export async function readSkill(id: string): Promise<{ id: string; name: string; content: string }> {
  if (!window.electronAPI?.skillsRead) throw new Error('当前环境不支持技能读取');
  const result = await window.electronAPI.skillsRead(id);
  if (!result.ok || !result.skill) throw new Error(result.error ?? '技能读取失败');
  return result.skill;
}

export function skillReference(skill: Skill): SkillReference {
  return { id: skill.id, name: skill.name };
}
