export const BEGINNER_RESPONSE_GUIDE = `## 面向普通用户的回答规则（必须遵守）
用户不需要懂编程、命令行或接口。回答时把用户当作第一次使用电脑工具的新手。

1. 第一行必须直接回答结果：已经完成就说“已经弄好了”；没有完成就说“还没有弄好”；仍在处理就说“还在处理中”。
2. 用户问“安装好了吗”时，必须明确说“已经安装好了”或“还没有安装好”，不能只说执行了多少步骤。
3. 失败时用通俗中文说明卡在哪个用户能理解的环节，例如“下载文件时”“安装软件时”“连接账号时”“保存文件时”，再说明下一步怎么办。
4. 最终回答禁止重复展示工具名、命令、参数、退出码、STDOUT、STDERR、原始日志、长路径或操作编号。这些技术记录只放在界面下方折叠的“执行过程”里。
5. 成功回答通常只需要三部分：结果、保存或安装位置、用户接下来在哪里打开或使用。
6. 只有用户明确要求查看技术细节时，才解释命令和日志。
7. 没有真实验证结果时不能说成功；要明确说“目前还不能确认”，并说明还差哪项检查。`;

const TOOL_ACTIONS: Record<string, { active: string; stage: string }> = {
  search_skills: { active: '正在查找合适的技能…', stage: '查找技能' },
  read_skill: { active: '正在读取技能说明…', stage: '读取技能说明' },
  write_file: { active: '正在保存文件…', stage: '保存文件' },
  read_file: { active: '正在读取文件…', stage: '读取文件' },
  list_files: { active: '正在检查文件…', stage: '检查文件' },
  web_search: { active: '正在查询最新资料…', stage: '查询资料' },
  run_command: { active: '正在执行安装或检查…', stage: '安装或检查' },
};

export function getToolActivity(name: string): string {
  if (name.startsWith('connector_')) return '正在连接外部服务…';
  return TOOL_ACTIONS[name]?.active ?? '正在处理下一步…';
}

export function getToolStage(name: string): string {
  if (name.startsWith('connector_')) return '连接外部服务';
  return TOOL_ACTIONS[name]?.stage ?? '处理任务';
}

export function isToolResultSuccessful(result: string, explicitSuccess?: boolean): boolean {
  if (explicitSuccess !== undefined) return explicitSuccess;
  return !/(?:^|\n)(?:工具执行错误|未知工具|连接器调用失败|API 返回错误)|(?:退出码|exit\s*code)\s*[:：]?\s*[1-9]\d*|\b(?:error|failed|failure)\b|❌|失败|异常/iu.test(result);
}

export function humanizeExecutionError(raw: string): string {
  if (/401|403|unauthorized|forbidden|api\s*key|鉴权|密钥/iu.test(raw)) return '账号验证没有通过，请检查模型或服务的账号设置。';
  if (/timeout|timed out|超时/iu.test(raw)) return '等待时间太久，服务没有及时回应。请稍后重试。';
  if (/network|fetch|ECONN|ENOTFOUND|网络|连接失败/iu.test(raw)) return '网络连接没有成功，请检查网络后重试。';
  if (/ENOENT|not found|not recognized|找不到|不存在/iu.test(raw)) return '需要的程序或文件没有找到，需要换一种安装方式。';
  if (/EACCES|EPERM|permission|权限|拒绝访问/iu.test(raw)) return '系统不允许这一步操作，需要确认安装权限。';
  if (/(?:退出码|exit\s*code)\s*[:：]?\s*[1-9]\d*/iu.test(raw)) return '这一步没有顺利完成，需要换一种方法重试。';
  return '这一步没有顺利完成，详细记录已放在下方“执行过程”中。';
}

export function simplifyLegacyAssistantContent(content: string): string {
  if (!/^已执行\s+\d+\s+个操作。详细过程已收纳在下方“执行过程”中/iu.test(content.trim())) return content;
  const failures = content.match(/❌\s*失败/gu)?.length ?? 0;
  const statuses = [...content.matchAll(/→\s*(✅\s*成功|❌\s*失败)/gu)].map((match) => match[1]);
  const lastSucceeded = statuses.at(-1)?.includes('成功') ?? false;
  if (failures === 0) return '已经处理好了。所有步骤都已完成，详细记录可以在下方“执行过程”中查看。';
  if (lastSucceeded) return `本轮处理已经结束。中途有 ${failures} 步没有成功，后来换了方法继续完成了最后一步。详细记录可以在下方“执行过程”中查看。`;
  return `还没有处理好。中途有 ${failures} 步没有成功，最后一步也没有完成。详细原因可以在下方“执行过程”中查看。`;
}
