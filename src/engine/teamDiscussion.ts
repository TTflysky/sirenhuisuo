import type { Employee, Team, ChatMessage, TeamTask, TaskLane } from '../types';
import { runAgentLoop, resolveApiBase, extractUserInsights, type ChatTurn } from '../data/hermesClient';
import { TOOLS } from './tools';

// ===== 讨论回调 =====
export interface DiscussionHandlers {
  onMessage: (emp: Employee, content: string, mentions: string[], tokens?: number) => void;
  onToolCall: (emp: Employee, toolName: string, toolArgs: string, result: string) => void;
  onTaskAdvance: (taskId: string, lane: TaskLane) => void;
  onStatus: (text: string) => void;
  onDone: () => void;
}

// 角色在讨论中的职责描述（系统提示词扩展）
const ROLE_DUTY: Record<string, string> = {
  pm: `你是团队协调者（PM）。你的工具：write_file(输出文档)、read_file(读已有文件)、list_files(查看产出物)、web_search(搜索资料)。
使用方式：需要产出文件时调 write_file，需要查资料时调 web_search。
典型流程：接到任务 → web_search 查资料 → write_file 输出需求文档/PRD → @相关成员。
发言简洁，像真实同事对话。每次工具调用后会立刻得到结果供你参考。`,
  planner: `你是规划者（Planner/架构师）。你的工具：read_file(读PM的需求文档)、web_search(查技术方案)、write_file(输出架构方案)。
使用方式：先 read_file 看有没有已有文档，再 write_file 输出技术方案（.md文件）、架构图说明或接口定义。
发言务实，给出清晰的实现步骤，让编码者能直接照着写。`,
  coder: `你是编码者（Coder/实现工程师）。你的工具：write_file(写代码文件)、read_file(读方案文档)、list_files(查看项目目录)、web_search(查API文档)。
使用方式：read_file 读方案 → write_file 输出代码文件（.html/.js/.tsx等）→ 告知审查者验收。
代码文件是真正可运行的，写完整、可执行。`,
  checker: `你是审查者（Checker/QA）。你的工具：read_file(读代码审查)、list_files(查看文件)、web_search(查安全标准)。
使用方式：read_file 读代码 → 审查正确性/安全/性能 → 给出验收结论。严谨、具体。`,
  custom: '你是团队的一员。可用工具包括 write_file/read_file/list_files/web_search。根据自己的身份牌职责参与协作。',
};

// 成员发言的本地兜底剧本（无 API 时用）
const FALLBACK_LINES: Record<string, string[]> = {
  pm: ['收到，我来拆解一下需求，拉大家对齐目标。', '这个任务我来协调，先请规划者出方案。'],
  planner: ['我出个方案：先搭框架，再填核心逻辑，最后联调。', '方案有了，分三步走，编码者可以照着实现。'],
  coder: ['方案明白，我开始实现核心部分，写完同步进度。', '代码写好了，自测通过，请审查者把关。'],
  checker: ['我审查了一遍，逻辑没问题，边界情况也覆盖了，可以交付。', '审查通过，符合验收标准。'],
  custom: ['收到，我看一下。', '明白，我来跟进。'],
};

let _seq = 0;
const pick = (arr: string[]) => arr[_seq++ % arr.length];

function memberByRole(team: Team, employees: Employee[], role: string): Employee | undefined {
  return team.memberIds
    .map((id) => employees.find((e) => e.id === id))
    .find((e): e is Employee => !!e && e.role === role);
}

function buildContext(msgs: ChatMessage[], employees: Employee[]): ChatTurn[] {
  return msgs.slice(-12).map((m) => ({
    role: (m.roleId === 'human' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `${(employees.find((e) => e.id === m.authorId)?.name ?? m.roleId)}: ${m.content}`,
  }));
}

// 有 API 时用 agentLoop（可调工具），无 API 回落下本地剧本
async function memberSpeak(
  emp: Employee,
  team: Team,
  employees: Employee[],
  extraInstruction: string,
  onToolCall: (toolName: string, toolArgs: string, result: string) => void,
  attachments?: import('../data/hermesClient').Attachment[]
): Promise<{ text: string; tokens?: number }> {
  if (!resolveApiBase()) return { text: '' }; // 外部处理兜底

  const duty = ROLE_DUTY[emp.role] ?? ROLE_DUTY.custom;
  const persona = emp.prompt?.trim() || `你是「${emp.name}」，${emp.title}。`;
  const system = `${persona}\n\n${duty}\n\n你正在团队群聊中协作。如果需要产出实际文件或查阅资料，调用工具（不要只是说"我来写"，直接调 write_file）。完成后用简短的文字总结你做了什么事，便于队友接着工作。`;

  // 多模态：把图片附件拼到用户指令上
  const imageParts = (attachments ?? [])
    .filter((a) => a.kind === 'image' && a.dataUrl)
    .map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl! } }));
  const userTurn: ChatTurn = imageParts.length > 0
    ? { role: 'user', content: [{ type: 'text', text: `[指令] ${extraInstruction}` }, ...imageParts] }
    : { role: 'user', content: `[指令] ${extraInstruction}` };

  try {
    const r = await runAgentLoop({
      turns: [
        { role: 'system', content: system },
        ...buildContext(team.chatMessages, employees),
        userTurn,
      ],
      tools: TOOLS,
      scene: 'team',
      label: `${team.name}/${emp.name}`,
      modelConfig: emp.modelConfig,
      extraSystemContext: emp.soul,
      scope: `team:${team.id}` as any,
      onToolCall(name, args) {
        onToolCall(name, args, '');
      },
    });
    return { text: r.content, tokens: r.usage.totalTokens };
  } catch (e: any) {
    return { text: `⚠️ ${emp.name} 无法响应（${e?.message ?? '模型错误'}）` };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runTeamDiscussion(
  team: Team,
  employees: Employee[],
  opts: { task?: TeamTask; userText?: string; attachments?: import('../data/hermesClient').Attachment[] },
  handlers: DiscussionHandlers
): Promise<void> {
  const useAI = !!resolveApiBase();
  const roles = ['pm', 'planner', 'coder', 'checker'] as const;
  const task = opts.task;

  const laneOf: Record<string, TaskLane | null> = {
    pm: null, planner: 'PLANNING', coder: 'CODING', checker: 'REVIEW',
  };

  for (const role of roles) {
    const emp = memberByRole(team, employees, role);
    if (!emp) continue;

    handlers.onStatus(`${emp.name} 正在思考…`);
    let content = '';
    let tokens: number | undefined;

    if (useAI) {
      const r = await memberSpeak(emp, team, employees,
        task
          ? `团队接到新任务「${task.title}」${task.description ? `：${task.description}` : ''}。如有必要，可调工具产出文件或用 web_search 查资料。`
          : `老板在群里说：「${opts.userText ?? ''}」。如需产出或查资料可调工具。`,
        (toolName, toolArgs) => {
          // 先发工具调用消息
          const argsStr = toolArgs ? (toolArgs.length > 80 ? toolArgs.slice(0, 80) + '…' : toolArgs) : '';
          handlers.onToolCall(emp, toolName, argsStr, '🔄 执行中…');
        },
        // 仅首轮（PM）携带用户上传的图片附件
        role === 'pm' ? opts.attachments : undefined
      );
      content = r.text;
      tokens = r.tokens;
    } else {
      await sleep(700 + Math.random() * 600);
      content = pick(FALLBACK_LINES[role] ?? FALLBACK_LINES.custom);
    }

    handlers.onMessage(emp, content, [], tokens);

    if (task) {
      const lane = laneOf[role];
      if (lane) handlers.onTaskAdvance(task.id, lane);
    }
    await sleep(useAI ? 300 : 500);
  }

  // 任务收尾
  if (task) {
    const pm = memberByRole(team, employees, 'pm');
    if (pm) {
      handlers.onStatus(`${pm.name} 验收中…`);
      let closing = '';
      let pmTokens: number | undefined;
      if (useAI) {
        const r = await memberSpeak(pm, team, employees,
          `任务「${task.title}」已完成开发与审查，请做验收总结。如果代码或文档已产出，可直接 read_file 检查。`,
          (toolName, toolArgs) => handlers.onToolCall(pm, toolName, toolArgs, '🔄 执行中…')
        );
        closing = r.text;
        pmTokens = r.tokens;
      } else {
        await sleep(600);
        closing = '验收通过，任务交付 🎉 大家辛苦。';
      }
      handlers.onMessage(pm, closing, [], pmTokens);
      handlers.onTaskAdvance(task.id, 'DONE');
    }
  }

  // 从讨论中提炼用户洞察（如果讨论由用户发起且有有效内容）
  if (opts.userText && opts.userText.trim().length > 5 && resolveApiBase()) {
    const discussionText = team.chatMessages.slice(-20).map(m => {
      const emp = employees.find(e => e.id === m.authorId);
      return `${emp?.name ?? m.roleId}: ${m.content.slice(0, 150)}`;
    }).join('\n');
    if (discussionText.length > 200) {
      extractUserInsights(
        `用户说：${opts.userText}\n\n团队讨论：\n${discussionText}`,
        `团队讨论-${team.name}`
      ).catch(() => {});
    }
  }

  handlers.onStatus('');
  handlers.onDone();
}
