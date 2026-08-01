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
  ...cases(10, 'pronoun-explicit-web', (index) => ({
    latestMessage: `请读取 https://example.com/brief/${index}，把它的正文重点总结给我。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'read_web_page' },
  })),
  ...cases(10, 'pronoun-local-file', (index) => ({
    latestMessage: `请读取工作区文件 report-${index}.md，整理上面这个文件的重点。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'read_file' },
  })),
  ...cases(10, 'directory-list', (index) => ({
    latestMessage: `请列出工作区第 ${index} 个输出目录里的文件清单。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'list_files' },
  })),
  ...cases(10, 'explicit-skill-source', (index) => ({
    latestMessage: `请安装这个技能：https://github.com/example/skills/tree/main/skill-${index}`,
    expected: { mode: 'execute', relation: 'new_task', route: 'install_skill' },
  })),
  ...cases(10, 'correction-explicit-web', (index) => ({
    latestMessage: `不是搜索，直接读取 https://example.com/correction/${index} 的正文并总结。`,
    previousUserMessage: '请处理刚才的网页。',
    activeTaskGoal: '搜索相关资料',
    expected: { mode: 'execute', relation: 'correction', route: 'read_web_page' },
  })),
  ...cases(10, 'correction-local-file', (index) => ({
    latestMessage: `不是让我找资料，我是让你读取工作区的 report-${index}.md 并总结。`,
    previousUserMessage: '请处理工作区里的方案文件。',
    activeTaskGoal: '搜索相关资料',
    expected: { mode: 'execute', relation: 'correction', route: 'read_file' },
  })),
  ...cases(10, 'independent-file', (index) => ({
    latestMessage: `另外请把第 ${index} 项整理成 Markdown 文件并保存到工作区。`,
    activeTaskGoal: '正在分析上一份需求',
    expected: { mode: 'execute', relation: 'new_task', route: 'write_file' },
  })),
  ...cases(10, 'independent-web', (index) => ({
    latestMessage: `另外请查询第 ${index} 项主题的最新公开资料。`,
    activeTaskGoal: '正在分析上一份需求',
    expected: { mode: 'execute', relation: 'new_task', route: 'web_search' },
  })),
  ...cases(10, 'team-dispatch-expanded', (index) => ({
    latestMessage: `请组建一个团队完成第 ${index} 个软件功能，安排产品、设计、开发和测试协作。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'team_dispatch' },
  })),
  ...cases(10, 'pause-control-expanded', (index) => ({
    latestMessage: `暂停执行，等我确认第 ${index} 项。`,
    activeTaskGoal: '生成客户端演示文件',
    expected: { mode: 'conversation', relation: 'control', route: 'direct_answer' },
  })),
  ...cases(10, 'resume-control-expanded', (index) => ({
    latestMessage: `继续执行刚才暂停的第 ${index} 个任务。`,
    activeTaskGoal: '生成客户端演示文件',
    expected: { mode: 'execute', relation: 'control' },
  })),
  ...cases(10, 'stop-control-expanded', (index) => ({
    latestMessage: `停止执行第 ${index} 个任务，不要再继续。`,
    activeTaskGoal: '生成客户端演示文件',
    expected: { mode: 'conversation', relation: 'control', route: 'direct_answer' },
  })),
  ...cases(10, 'conversational-skill', (index) => ({
    latestMessage: `你说的第 ${index} 个 Skill 是什么意思？`,
    activeTaskGoal: '正在整理技能安装结果',
    expected: { mode: 'answer', relation: 'question', route: 'direct_answer' },
  })),
  ...cases(10, 'multi-goal-explicit-resource', (index) => ({
    latestMessage: `请先读取 https://example.com/multi/${index}，再把网页摘要写入报告。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'read_web_page' },
  })),
  ...cases(10, 'attachment-analysis', (index) => ({
    latestMessage: `请根据我上传的第 ${index} 张图片分析设计问题并给出结论。`,
    attachments: [{ name: `design-${index}.png`, kind: 'image', size: 1024 }],
    expected: { mode: 'execute', relation: 'new_task', route: 'general_tools' },
  })),
  ...cases(10, 'status-question-expanded', (index) => ({
    latestMessage: `当前第 ${index} 项任务做到哪一步了？`,
    activeTaskGoal: '正在整理项目资料',
    expected: { mode: 'answer', relation: 'question', route: 'direct_answer' },
  })),
  ...cases(10, 'fresh-research-expanded', (index) => ({
    latestMessage: `帮我查第 ${index} 个主题的最新公开信息，并保留来源。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'web_search' },
  })),
  ...cases(10, 'file-output-expanded', (index) => ({
    latestMessage: `生成第 ${index} 份 Markdown 报告文件并保存到工作区。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'write_file' },
  })),
  ...cases(10, 'connector-verification-expanded', (index) => ({
    latestMessage: `检查并测试第 ${index} 个 Obsidian 知识库连接是否可用。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'inspect_connectors' },
  })),
  ...cases(10, 'knowledge-directory-expanded', (index) => ({
    latestMessage: `查看 Obsidian 知识库目录里的第 ${index} 个条目清单。`,
    expected: { mode: 'execute', relation: 'new_task', route: 'run_command' },
  })),
];

if (taskSemanticCases.length !== 400) throw new Error(`Expected 400 semantic cases, got ${taskSemanticCases.length}`);
