import {
  buildFreshWebQuery,
  getDirectExecutionControl,
  isActionableCapabilityCorrection,
  isConversationOnlyMessage,
  requiresFreshWebResearch,
  requiresObservableExecutionEvidence,
  resolveActionableUserGoal,
  shouldHoldTaskForFeedback,
} from './agentGuardrails.mjs';

export const TASK_DECISION_TOOL_NAME = 'compile_task_decision';

export const TASK_DECISION_TOOL = {
  type: 'function',
  function: {
    name: TASK_DECISION_TOOL_NAME,
    description: '把用户最新消息编译成可执行的任务合同。只做决策，不执行任务。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [
        'mode',
        'goal',
        'primaryRoute',
        'acceptanceCriteria',
        'requiresEvidence',
        'needsUser',
        'missingUserCondition',
        'searchQuery',
        'decisionReason',
        'confidence',
      ],
      properties: {
        mode: { type: 'string', enum: ['conversation', 'answer', 'execute'] },
        goal: { type: 'string', description: '去掉抱怨、纠正措辞后的真实目标。' },
        primaryRoute: {
          type: 'string',
          enum: [
            'direct_answer',
            'web_search',
            'inspect_connectors',
            'read_file',
            'list_files',
            'search_skills',
            'write_file',
            'run_command',
            'team_dispatch',
            'general_tools',
          ],
        },
        acceptanceCriteria: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: { type: 'string' },
        },
        requiresEvidence: { type: 'boolean' },
        needsUser: { type: 'boolean' },
        missingUserCondition: { type: 'string' },
        searchQuery: { type: 'string' },
        decisionReason: { type: 'string', description: '一句可展示的决策理由，不输出思维链。' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

const ROUTES = new Set(TASK_DECISION_TOOL.function.parameters.properties.primaryRoute.enum);

function clean(value, maxLength = 2000) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function defaultAcceptance(route, goal) {
  if (route === 'web_search') return ['取得当前可核验的外部资料', '直接回答用户问题并保留来源链接'];
  if (route === 'inspect_connectors') return ['识别真实接入方式和缺失条件', '完成保存并通过真实连接测试后才宣布可用'];
  if (route === 'read_file' || route === 'list_files') return ['读取真实目标内容', '根据读取结果回答，不凭空猜测'];
  if (route === 'write_file') return ['生成真实文件并登记为产出物', '验证文件可以打开且内容符合要求'];
  if (route === 'run_command') return ['执行实际操作', '根据运行或测试结果验收，不把命令发出等同于完成'];
  if (route === 'search_skills') return ['找到适用能力或确认无需 Skill', '继续完成原始目标，不停在搜索步骤'];
  if (route === 'team_dispatch') return ['选择真实存在且合适的成员', '成员产出经过汇总和验收'];
  if (route === 'direct_answer') return ['直接回应当前问题', '结论清楚且不虚构事实'];
  return [`围绕“${clean(goal, 120)}”产生可验证结果`, '对照原始目标复核后再宣布完成'];
}

function routeForGoal(goal, availableTools) {
  const tools = new Set(availableTools ?? []);
  if (requiresFreshWebResearch(goal) && tools.has('web_search')) return 'web_search';
  if (/连接器|知识库|MCP|Obsidian|Vault|(?:^|[^a-z])ima(?:[^a-z]|$)/iu.test(goal)
      && /配置|安装|接入|连接|关联|验证|测试|检查|诊断/iu.test(goal)
      && tools.has('inspect_connectors')) return 'inspect_connectors';
  if (/读取|查看|检查|分析|打开/u.test(goal) && /文件|文档|代码|附件|工作区/u.test(goal) && tools.has('read_file')) return 'read_file';
  if (/列出|有哪些|目录|清单/u.test(goal) && /文件|产出物|工作区/u.test(goal) && tools.has('list_files')) return 'list_files';
  if (/skill|技能/iu.test(goal) && /搜索|查找|安装|更新|修复|恢复|找/u.test(goal) && tools.has('search_skills')) return 'search_skills';
  if (/创建|生成|编写|写入|保存|制作/u.test(goal) && /文件|文档|代码|脚本|表格|报告|方案|word|excel|ppt|pdf/iu.test(goal) && tools.has('write_file')) return 'write_file';
  if (/运行|执行|构建|打包|安装|部署|测试|验证|修复/u.test(goal) && tools.has('run_command')) return 'run_command';
  if (/团队|员工|成员|调度|分工|协作/u.test(goal)) return 'team_dispatch';
  return 'general_tools';
}

export function createFallbackTaskDecision(input = {}) {
  const latestMessage = clean(input.latestMessage);
  const previousUserMessage = clean(input.previousUserMessage);
  const control = getDirectExecutionControl(latestMessage);
  const capabilityCorrection = isActionableCapabilityCorrection(latestMessage);
  const goal = clean(resolveActionableUserGoal(latestMessage, previousUserMessage)) || latestMessage;
  const feedbackOnly = shouldHoldTaskForFeedback(latestMessage) && isConversationOnlyMessage(latestMessage);
  const mustExecute = capabilityCorrection
    || requiresFreshWebResearch(goal)
    || requiresObservableExecutionEvidence(goal)
    || !isConversationOnlyMessage(latestMessage);

  if (control === 'stop' || control === 'pause' || feedbackOnly) {
    return {
      mode: 'conversation', goal: latestMessage, primaryRoute: 'direct_answer',
      acceptanceCriteria: ['回应用户当前控制指令或反馈，不偷跑旧任务'],
      requiresEvidence: false, needsUser: false, missingUserCondition: '', searchQuery: '',
      decisionReason: '这是对当前执行的控制或反馈，应先回应用户。', confidence: 1, source: 'rules',
    };
  }

  if (mustExecute || control === 'resume') {
    const primaryRoute = routeForGoal(goal, input.availableTools);
    return {
      mode: 'execute', goal, primaryRoute,
      acceptanceCriteria: defaultAcceptance(primaryRoute, goal),
      requiresEvidence: requiresObservableExecutionEvidence(goal) || primaryRoute !== 'direct_answer',
      needsUser: false, missingUserCondition: '',
      searchQuery: primaryRoute === 'web_search' ? buildFreshWebQuery(goal) : '',
      decisionReason: capabilityCorrection ? '用户在纠正未行动的问题，应恢复真实目标并立即执行。' : '消息包含需要实际完成的目标。',
      confidence: 0.9, source: 'rules',
    };
  }

  return {
    mode: /[？?]|为什么|怎么|是什么|能否|可以吗|对么/u.test(latestMessage) ? 'answer' : 'conversation',
    goal: latestMessage,
    primaryRoute: 'direct_answer',
    acceptanceCriteria: defaultAcceptance('direct_answer', latestMessage),
    requiresEvidence: false, needsUser: false, missingUserCondition: '', searchQuery: '',
    decisionReason: '当前消息没有明确要求执行外部操作。', confidence: 0.72, source: 'rules',
  };
}

export function parseTaskDecisionToolCall(toolCalls = []) {
  const call = toolCalls.find((item) => item?.name === TASK_DECISION_TOOL_NAME);
  if (!call) return undefined;
  try {
    const parsed = JSON.parse(call.arguments || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeTaskDecision(candidate, input = {}) {
  const fallback = createFallbackTaskDecision(input);
  if (!candidate || typeof candidate !== 'object') return fallback;
  const latestMessage = clean(input.latestMessage);
  const previousUserMessage = clean(input.previousUserMessage);
  const control = getDirectExecutionControl(latestMessage);
  const capabilityCorrection = isActionableCapabilityCorrection(latestMessage);
  const hardExecute = capabilityCorrection || requiresFreshWebResearch(fallback.goal) || requiresObservableExecutionEvidence(fallback.goal);
  const hardHold = control === 'stop' || control === 'pause'
    || (shouldHoldTaskForFeedback(latestMessage) && isConversationOnlyMessage(latestMessage));
  const proposedMode = ['conversation', 'answer', 'execute'].includes(candidate.mode) ? candidate.mode : fallback.mode;
  const mode = hardHold ? 'conversation' : hardExecute ? 'execute' : proposedMode;
  const restoredGoal = capabilityCorrection ? resolveActionableUserGoal(latestMessage, previousUserMessage) : candidate.goal;
  const goal = clean(restoredGoal) || fallback.goal;
  let primaryRoute = ROUTES.has(candidate.primaryRoute) ? candidate.primaryRoute : fallback.primaryRoute;
  if (mode !== 'execute') primaryRoute = 'direct_answer';
  if (requiresFreshWebResearch(goal)) primaryRoute = 'web_search';
  if (fallback.primaryRoute === 'inspect_connectors') primaryRoute = 'inspect_connectors';
  const criteria = Array.isArray(candidate.acceptanceCriteria)
    ? candidate.acceptanceCriteria.map((item) => clean(item, 240)).filter(Boolean).slice(0, 6)
    : [];
  const missingUserCondition = clean(candidate.missingUserCondition, 300);
  const genuinelyNeedsUser = mode === 'execute'
    && Boolean(candidate.needsUser)
    && Boolean(missingUserCondition)
    && /账号|密码|密钥|api.?key|验证码|登录|授权|批准|付费|业务选择|文件|目录位置/iu.test(missingUserCondition);
  return {
    mode,
    goal,
    primaryRoute,
    acceptanceCriteria: criteria.length ? criteria : defaultAcceptance(primaryRoute, goal),
    requiresEvidence: mode === 'execute' && (Boolean(candidate.requiresEvidence) || fallback.requiresEvidence),
    needsUser: genuinelyNeedsUser,
    missingUserCondition: genuinelyNeedsUser ? missingUserCondition : '',
    searchQuery: primaryRoute === 'web_search' ? clean(candidate.searchQuery, 300) || buildFreshWebQuery(goal) : '',
    decisionReason: clean(candidate.decisionReason, 240) || fallback.decisionReason,
    confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || fallback.confidence)),
    source: 'model',
  };
}

export function buildTaskDecisionMessages(input = {}) {
  const history = Array.isArray(input.recentHistory) ? input.recentHistory : [];
  return [
    {
      role: 'system',
      content: `你是太极的任务决策内核。你的工作不是回答用户，而是把最新消息编译成任务合同，并且必须调用 compile_task_decision 返回结构化结果。

判断原则：
- 先理解完整语义、最近上下文和用户真正想达到的结果，不靠单个关键词分类。
- conversation 用于闲聊、情绪、状态询问、暂停/停止和单纯反馈；answer 用于不需要外部行动即可可靠回答的问题；execute 用于查询外部或本地事实、配置、安装、创建、修改、运行、验证、调度等任务。
- 用户纠正“为什么不调用工具/不会搜索”时，要恢复最近尚未完成的真实目标，而不是把纠正句当作新目标。
- 不得因为尚未检查就假定缺少 API、账号或文件。只有明确缺少且客户端无法自行取得的凭据、授权、批准或业务选择，needsUser 才能为 true。
- acceptanceCriteria 描述最终可验收结果，不能把“调用了工具”“尝试了”当作完成。
- primaryRoute 只选第一条最有效路线；Skill 是可选能力，不是所有任务的必经步骤。
- decisionReason 只写一句可展示依据，不输出隐藏思维过程。`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        latestMessage: clean(input.latestMessage, 4000),
        previousUserMessage: clean(input.previousUserMessage, 2400),
        recentHistory: history.slice(-8).map((item) => ({ role: item.role, content: clean(item.content, 900) })),
        availableTools: input.availableTools ?? [],
        relevantUserContext: clean(input.relevantUserContext, 3000),
        relevantTaskExperience: clean(input.relevantTaskExperience, 3000),
      }),
    },
  ];
}

export function buildTaskContract(decision, taskExperience = '') {
  const criteria = (decision.acceptanceCriteria ?? []).map((item, index) => `${index + 1}. ${item}`).join('\n');
  return `## 太极任务合同
模式：${decision.mode}
真实目标：${decision.goal}
首选路线：${decision.primaryRoute}
完成标准：
${criteria || '1. 直接、准确地满足用户当前目标'}
是否必须有真实证据：${decision.requiresEvidence ? '是' : '否'}
${decision.needsUser ? `已确认缺少的用户条件：${decision.missingUserCondition}` : '当前不应先向用户索要条件；先自行检查并行动。'}
决策依据：${decision.decisionReason}

执行要求：每一步都要推进上述目标。工具结果只是观察，不是自动完成；失败后先分类原因，再重试瞬时错误或切换本质不同的路线。只有逐项满足完成标准才能宣布完成。${taskExperience ? `\n\n## 相似任务经验\n${taskExperience}\n经验只用于避免重复犯错，当前真实证据优先。` : ''}`;
}
