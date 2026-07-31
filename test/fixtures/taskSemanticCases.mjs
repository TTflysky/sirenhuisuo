const tools = ['read_web_page', 'web_search', 'read_file', 'list_files', 'write_file', 'run_command', 'search_skills', 'install_skill', 'inspect_connectors'];

function cases(count, category, build) {
  return Array.from({ length: count }, (_, index) => ({ id: `${category}-${index + 1}`, category, availableTools: tools, ...build(index + 1) }));
}

export const taskSemanticCases = [
  ...cases(20, 'explicit-web', (index) => ({
    latestMessage: `请读取 https://example.com/article/${index} 并总结这个网页的正文内容。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'read_web_page' },
  })),
  ...cases(20, 'fresh-research', (index) => ({
    latestMessage: `请查一下 2026 年 7 月 ${index} 日上海天气的最新情况。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'web_search' },
  })),
  ...cases(20, 'local-file', (index) => ({
    latestMessage: `请读取工作区文件 report-${index}.md 并总结内容。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'read_file' },
  })),
  ...cases(20, 'skill-discovery', (index) => ({
    latestMessage: `帮我搜索一个用于第 ${index} 类视频拆解的技能，先列出候选。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'search_skills' },
  })),
  ...cases(20, 'skill-install', (index) => ({
    latestMessage: `请安装这个 Skill：https://github.com/example/skills/tree/main/skill-${index}`,
    expected: { mode: 'execute', relation: 'new_task', route: 'install_skill' },
  })),
  ...cases(20, 'team-dispatch', (index) => ({
    latestMessage: `请拉一个团队完成客户端第 ${index} 个功能，安排产品、UI 和开发一起做。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'team_dispatch' },
  })),
  ...cases(20, 'independent-goal', (index) => ({
    latestMessage: `另外请创建一份第 ${index} 期项目计划 Markdown 文件。`,
    activeTaskGoal: '正在分析上一份需求',
    expected: { mode: 'execute', relation: 'new_task', route: 'write_file' },
  })),
  ...cases(20, 'follow-up-question', (index) => ({
    latestMessage: `你刚才的回答为什么没有说明第 ${index} 项依据？`,
    activeTaskGoal: '正在整理项目资料',
    expected: { mode: 'answer', relation: 'question', route: 'direct_answer' },
  })),
  ...cases(20, 'correction', (index) => ({
    latestMessage: `不是叫你搜索，我是让你读取刚才那个文件并总结第 ${index} 章。`,
    previousUserMessage: '请处理工作区里的方案文件。',
    activeTaskGoal: '搜索相关资料',
    expected: { mode: 'execute', relation: 'correction', route: 'read_file' },
  })),
  ...cases(10, 'resume-control', () => ({
    latestMessage: '继续执行刚才暂停的任务。',
    activeTaskGoal: '生成客户端演示文件',
    expected: { mode: 'execute', relation: 'control' },
  })),
  ...cases(5, 'pause-control', () => ({
    latestMessage: '先暂停这个任务。',
    activeTaskGoal: '生成客户端演示文件',
    expected: { mode: 'conversation', relation: 'control', route: 'direct_answer' },
  })),
  ...cases(5, 'stop-control', () => ({
    latestMessage: '停止执行，不要再继续。',
    activeTaskGoal: '生成客户端演示文件',
    expected: { mode: 'conversation', relation: 'control', route: 'direct_answer' },
  })),
];

if (taskSemanticCases.length !== 200) throw new Error(`Expected 200 semantic cases, got ${taskSemanticCases.length}`);
