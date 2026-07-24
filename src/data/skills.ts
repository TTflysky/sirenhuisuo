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

export async function deleteSkill(id: string): Promise<void> {
  if (!window.electronAPI?.skillsDelete) throw new Error('当前环境不支持技能删除');
  const result = await window.electronAPI.skillsDelete(id);
  if (!result.ok) throw new Error(result.error ?? '技能删除失败');
}

export async function installSkill(sourceUrl: string, name?: string): Promise<Skill> {
  if (!window.electronAPI?.skillsInstall) throw new Error('当前环境不支持技能安装');
  const result = await window.electronAPI.skillsInstall({ sourceUrl, name });
  if (!result.ok || !result.skill) throw new Error(result.error ?? '技能安装失败');
  return result.skill;
}

export function skillReference(skill: Skill): SkillReference {
  return { id: skill.id, name: skill.name };
}

function skillScore(skill: Skill, request: string): number {
  const query = request.toLowerCase();
  const name = skill.name.toLowerCase();
  const description = skill.description.toLowerCase();
  let score = query.includes(name) ? 20 : 0;
  const aliases: Array<[RegExp, RegExp]> = [
    [/content|copy|script|marketing|humanizer/i, /内容|文案|脚本|剧本|视频|营销|润色|写作/u],
    [/image|photo|visual/i, /图片|图像|照片|海报|封面|修图|视觉/u],
    [/memory/i, /记住|记忆|回忆|之前|习惯/u],
    [/mail|email/i, /邮件|邮箱|收件箱/u],
    [/ima|knowledge|notes?/i, /知识库|资料库|笔记|备忘|记录/u],
    [/android|mobile/i, /安卓|Android|移动端|手机应用/ui],
    [/github/i, /GitHub|开源|趋势|仓库/ui],
    [/search|research/i, /搜索|检索|调研|查资料/u],
  ];
  for (const [skillPattern, requestPattern] of aliases) if (skillPattern.test(`${name} ${description}`) && requestPattern.test(request)) score += 12;
  const terms = [...new Set(query.match(/[\p{Script=Han}]{2,6}|[a-z][a-z0-9_-]{2,}/gu) ?? [])].slice(0, 50);
  for (const term of terms) {
    if (name.includes(term)) score += 5;
    if (description.includes(term)) score += 2;
  }
  return score;
}

export async function matchSkills(request: string, limit = 3): Promise<SkillReference[]> {
  try {
    const skills = await listSkills();
    return skills.map((skill) => ({ skill, score: skillScore(skill, request) }))
      .filter((item) => item.score >= 2).sort((a, b) => b.score - a.score).slice(0, limit)
      .map((item) => skillReference(item.skill));
  } catch { return []; }
}

export async function buildSkillContext(refs: SkillReference[]): Promise<string> {
  const unique = refs.filter((ref, index) => refs.findIndex((item) => item.id === ref.id) === index).slice(0, 5);
  const bodies = await Promise.all(unique.map(async (ref) => { try { return await readSkill(ref.id); } catch { return null; } }));
  const content = bodies.filter((item): item is NonNullable<typeof item> => !!item).map((item) => `## Skill: ${item.name}\n${item.content.slice(0, 12000)}`);
  return content.length ? `以下 Skill 已由调度器自动匹配并授权用于当前任务。按需执行，不要声称无法访问：\n\n${content.join('\n\n')}` : '';
}
