import {
  buildFreshWebQuery,
  getDirectExecutionControl,
  isActionableCapabilityCorrection,
  isConversationOnlyMessage,
  isExplicitPauseSteering,
  isExplicitStopSteering,
  requiresFreshWebResearch,
  requiresObservableExecutionEvidence,
  resolveActionableUserGoal,
  shouldHoldTaskForFeedback,
} from './agentGuardrails.mjs';
import { taskRequirementLabels } from './taskFidelity.mjs';
import { resolveSkillInstallRequest } from './skillInstallRouting.mjs';
import { isSkillDiscoveryRequest } from './skillHubSearch.mjs';
import { inferCapabilityIds } from './capabilityGraph.mjs';

export const TASK_DECISION_TOOL_NAME = 'compile_task_decision';
const TURN_RELATIONS = new Set(['new_task', 'continuation', 'correction', 'control', 'question']);

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
        'turnRelation',
        'goal',
        'primaryRoute',
        'acceptanceCriteria',
        'deliverableType',
        'requiresEvidence',
        'needsUser',
        'missingUserCondition',
        'searchQuery',
        'decisionReason',
        'confidence',
      ],
      properties: {
        mode: { type: 'string', enum: ['conversation', 'answer', 'execute'] },
        turnRelation: {
          type: 'string',
          enum: ['new_task', 'continuation', 'correction', 'control', 'question'],
          description: '最新消息相对当前任务的关系。没有当前任务时使用 new_task。',
        },
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
            'install_skill',
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
        deliverableType: { type: 'string', enum: ['answer', 'file', 'connection', 'operation', 'decision', 'mixed'] },
        requiredConstraints: {
          type: 'array',
          maxItems: 8,
          items: { type: 'string' },
          description: '从用户原话中识别的不可丢失条件，例如对象、地点、时间、指定工具和交付格式。',
        },
        deliverables: {
          type: 'array', maxItems: 12,
          items: { type: 'object', additionalProperties: false, required: ['label'], properties: {
            label: { type: 'string' }, format: { type: 'string' }, type: { type: 'string', enum: ['answer', 'file', 'connection', 'operation', 'decision', 'mixed'] }, category: { type: 'string', enum: ['final', 'working', 'reference'] }, required: { type: 'boolean' },
          } },
        },
        requiredCapabilities: { type: 'array', maxItems: 12, items: { type: 'string' } },
        riskLevel: { type: 'string', enum: ['low', 'normal', 'high'] },
        teamPolicy: { type: 'object', additionalProperties: false, properties: {
          requiresTeam: { type: 'boolean' }, explicitMemberIds: { type: 'array', items: { type: 'string' } }, allowDynamicDelegation: { type: 'boolean' },
        } },
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

function hasExplicitIndependentGoal(message) {
  const value = clean(message, 1200);
  if (!value || /(?:继续|恢复|暂停|停止|上面|刚才|之前|原任务|当前任务|这个任务|这件事)/u.test(value)) return false;
  if (/^(?:另外|新任务|换个任务|先做这个|还有一件事|顺便)/u.test(value)) return true;
  return /^(?:请|帮我|我要|我需要|麻烦你|替我).{0,16}(?:查看|查询|检查|安装|创建|生成|编写|搜索|查找|配置|测试|分析|整理|删除|导出)/u.test(value)
    || /^(?:查看|查询|检查|安装|创建|生成|编写|搜索|查找|配置|测试|分析|整理|删除|导出)/u.test(value);
}

function isTaskCorrection(message) {
  return isActionableCapabilityCorrection(message)
    || /(?:不对|错了|不是这个|理解错|偏题|没有意义|别再重复|重新理解|重新看(?:一下)?需求|重新选人|胡说)/u.test(clean(message, 1200));
}

function isTaskStatusQuestion(message) {
  const value = clean(message, 1200);
  return /(?:现在|当前|目前|进度|做到哪|哪一步|为什么|怎么回事|卡住|还在做).{0,16}(?:吗|呢|了|\?|？)?$/u.test(value)
    || /[？?]$/u.test(value);
}

function fallbackTurnRelation(input = {}) {
  const latestMessage = clean(input.latestMessage);
  const activeTaskGoal = clean(input.activeTaskGoal);
  const control = getDirectExecutionControl(latestMessage);
  if (control) return 'control';
  if (!activeTaskGoal) return 'new_task';
  if (isTaskCorrection(latestMessage)) return 'correction';
  if (isTaskStatusQuestion(latestMessage)) return 'question';
  const turnIntent = classifyTaskTurnIntent(latestMessage);
  if (turnIntent === 'follow_up_question' || turnIntent === 'answer') return 'question';
  if (hasExplicitIndependentGoal(latestMessage)) return 'new_task';
  return 'continuation';
}

/**
 * This is a turn-level gate, not a capability router.  Its sole job is to
 * distinguish a request to act from a question about the conversation that
 * has already happened.  The latter must never inherit tool authority from
 * the previous task.
 */
export function classifyTaskTurnIntent(message) {
  const text = clean(message, 4000);
  if (!text) return 'conversation';
  const control = getDirectExecutionControl(text);
  if (control) return 'resume_control';

  const asksQuestion = /[？?]|(?:为什么|为何|怎么|怎样|是不是|对不对|能不能|可以吗|什么意思|理解了吗|看懂了吗|判断一下)/u.test(text);
  const refersToConversation = /(?:这句话|这次的话|我的意思|刚才(?:那)?句|上一句|上面(?:的)?(?:回答|回复|结果)|之前(?:的)?(?:回答|回复|结果)|基于(?:上面|之前|刚才)|针对(?:上面|之前|刚才)|你(?:到底)?理解|你自己判断|你说的|你的(?:回答|回复|判断))/u.test(text);
  // A question about the meaning, scope, or correctness of the current
  // exchange is an answer turn even when it repeats verbs from the old task.
  if (asksQuestion && refersToConversation) return 'follow_up_question';

  if (isActionableCapabilityCorrection(text)) return 'execute_request';
  if (requiresFreshWebResearch(text) || requiresObservableExecutionEvidence(text) || !isConversationOnlyMessage(text)) return 'execute_request';
  if (shouldHoldTaskForFeedback(text) || isExplicitPauseSteering([text]) || isExplicitStopSteering([text])) return 'feedback_or_correction';
  if (asksQuestion) return 'answer';
  return 'conversation';
}

function defaultAcceptance(route, goal) {
  if (route === 'web_search') return [`查询结果必须直接对应“${clean(goal, 160)}”中的对象、地点、时间和主题`, '取得当前可核验的外部资料，偏题结果不得交付', '直接回答用户问题并保留来源链接'];
  if (route === 'inspect_connectors') return ['识别真实接入方式和缺失条件', '完成保存并通过真实连接测试后才宣布可用'];
  if (route === 'read_file' || route === 'list_files') return ['读取真实目标内容', '根据读取结果回答，不凭空猜测'];
  if (route === 'write_file') return ['生成真实文件并登记为产出物', '验证文件可以打开且内容符合要求'];
  if (route === 'run_command') return ['执行实际操作', '根据运行或测试结果验收，不把命令发出等同于完成'];
  if (route === 'search_skills') return ['找到适用能力或确认无需 Skill', '继续完成原始目标，不停在搜索步骤'];
  if (route === 'install_skill') return ['通过客户端原生安装器写入正确的技能目录', '重新读取已安装 Skill 并确认规则完整'];
  if (route === 'team_dispatch') return ['选择真实存在且合适的成员', '成员产出经过汇总和验收'];
  if (route === 'direct_answer') return ['直接回应当前问题', '结论清楚且不虚构事实'];
  return [`围绕“${clean(goal, 120)}”产生可验证结果`, '对照原始目标复核后再宣布完成'];
}

function routeForGoal(goal, availableTools) {
  const tools = new Set(availableTools ?? []);
  if (resolveSkillInstallRequest(goal)?.sourceUrl && tools.has('install_skill')) return 'install_skill';
  if (isSkillDiscoveryRequest(goal) && tools.has('search_skills')) return 'search_skills';
  if (requiresFreshWebResearch(goal) && tools.has('web_search')) return 'web_search';
  // Reading a knowledge directory is a query, not a connector setup request.
  // Keep the execution route local so the final answer can report the directory
  // contents instead of demanding an unrelated connection verification.
  if (isKnowledgeDirectoryReadRequest(goal) && tools.has('run_command')) return 'run_command';
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

export function isKnowledgeDirectoryReadRequest(goal) {
  return /(?:查看|读取|列出|浏览|统计|查询|查找).{0,12}(?:obsidian|知识库|vault).{0,24}(?:目录|文件夹|笔记|条目|清单|列表|多少)/iu.test(goal);
}

function deliverableTypeForGoal(goal, route, provided) {
  if (/(?:连接|接入|连通|知识库|mcp|ima|connector)/iu.test(goal)
    && /(?:能否|能不能|可不可以|是否可以|能不能够|评估|可行性|方案|判断)/u.test(goal)) return 'decision';
  if (route === 'write_file') return 'file';
  if (route === 'inspect_connectors' || route === 'connector') return 'connection';
  if (['install_skill', 'run_command'].includes(route)) return 'operation';
  if (route === 'direct_answer' || route === 'web_search' || route === 'read_file' || route === 'list_files') return 'answer';
  if (['answer', 'file', 'connection', 'operation', 'decision', 'mixed'].includes(provided)) return provided;
  if (/(?:文件|文档|代码|网页|word|excel|ppt|pdf|markdown|安装包)/iu.test(goal)) return 'file';
  if (/选择|判断|比较|建议|分析|规划/u.test(goal)) return 'decision';
  return 'mixed';
}

function normalizedDeliverables(candidate, route, deliverableType) {
  const fixedLabels = {
    install_skill: '已安装并完成回读验证的 Skill',
    inspect_connectors: '已保存并通过真实测试的连接',
    write_file: '已落盘并验证可打开的文件',
  };
  if (fixedLabels[route]) {
    return [{ label: fixedLabels[route], format: deliverableType, type: deliverableType, category: 'final', required: true }];
  }
  if (!Array.isArray(candidate)) return undefined;
  return candidate.slice(0, 12).map((item) => ({
    ...item,
    type: ['answer', 'file', 'connection', 'operation', 'decision', 'mixed'].includes(item?.type) ? item.type : deliverableType,
  }));
}

export function createFallbackTaskDecision(input = {}) {
  const latestMessage = clean(input.latestMessage);
  const previousUserMessage = clean(input.previousUserMessage);
  const control = getDirectExecutionControl(latestMessage);
  const turnIntent = classifyTaskTurnIntent(latestMessage);
  const capabilityCorrection = isActionableCapabilityCorrection(latestMessage);
  const goal = clean(resolveActionableUserGoal(latestMessage, previousUserMessage)) || latestMessage;
  const feedbackOnly = shouldHoldTaskForFeedback(latestMessage) && isConversationOnlyMessage(latestMessage);
  const requiredConstraints = taskRequirementLabels(goal);
  const turnRelation = fallbackTurnRelation(input);
  const mustExecute = turnIntent === 'execute_request' && (capabilityCorrection
    || requiresFreshWebResearch(goal)
    || requiresObservableExecutionEvidence(goal)
    || !isConversationOnlyMessage(latestMessage));

  if (control === 'stop' || control === 'pause' || feedbackOnly || turnIntent === 'follow_up_question' || turnIntent === 'feedback_or_correction') {
    return {
      mode: 'conversation', goal: latestMessage, primaryRoute: 'direct_answer',
      turnRelation,
      deliverableType: 'answer',
      acceptanceCriteria: ['回应用户当前控制指令、追问或反馈，不偷跑旧任务'],
      requiredConstraints,
      requiresEvidence: false, needsUser: false, missingUserCondition: '', searchQuery: '',
      decisionReason: '这是对当前对话的控制、追问或反馈，应先回应用户。', confidence: 1, source: 'rules',
    };
  }

  if (mustExecute || control === 'resume') {
    const primaryRoute = routeForGoal(goal, input.availableTools);
    return {
      mode: 'execute', goal, primaryRoute,
      turnRelation,
      deliverableType: deliverableTypeForGoal(goal, primaryRoute),
      acceptanceCriteria: defaultAcceptance(primaryRoute, goal),
      requiredCapabilities: inferCapabilityIds(goal),
      requiredConstraints,
      requiresEvidence: requiresObservableExecutionEvidence(goal) || primaryRoute !== 'direct_answer',
      needsUser: false, missingUserCondition: '',
      searchQuery: primaryRoute === 'web_search' ? buildFreshWebQuery(goal) : '',
      decisionReason: capabilityCorrection ? '用户在纠正未行动的问题，应恢复真实目标并立即执行。' : '消息包含需要实际完成的目标。',
      confidence: 0.9, source: 'rules',
    };
  }

  return {
    mode: /[？?]|为什么|怎么|是什么|能否|可以吗|对么/u.test(latestMessage) ? 'answer' : 'conversation',
    turnRelation,
    goal: latestMessage,
    primaryRoute: 'direct_answer',
    deliverableType: 'answer',
    acceptanceCriteria: defaultAcceptance('direct_answer', latestMessage),
    requiredCapabilities: inferCapabilityIds(latestMessage),
    requiredConstraints,
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
  const control = getDirectExecutionControl(latestMessage);
  const turnIntent = classifyTaskTurnIntent(latestMessage);
  const capabilityCorrection = isActionableCapabilityCorrection(latestMessage);
  const taskCorrection = isTaskCorrection(latestMessage);
  const fallbackRelation = fallback.turnRelation;
  const hardExecute = capabilityCorrection || requiresFreshWebResearch(fallback.goal) || requiresObservableExecutionEvidence(fallback.goal);
  const hardHold = turnIntent === 'follow_up_question' || turnIntent === 'feedback_or_correction'
    || control === 'stop' || control === 'pause'
    || (shouldHoldTaskForFeedback(latestMessage) && isConversationOnlyMessage(latestMessage));
  const proposedMode = ['conversation', 'answer', 'execute'].includes(candidate.mode) ? candidate.mode : fallback.mode;
  const mode = hardHold ? 'conversation' : hardExecute ? 'execute' : proposedMode;
  const proposedRelation = TURN_RELATIONS.has(candidate.turnRelation) ? candidate.turnRelation : fallbackRelation;
  const turnRelation = control ? 'control'
    : taskCorrection ? 'correction'
      : (turnIntent === 'follow_up_question' || turnIntent === 'answer') ? 'question'
        : !clean(input.activeTaskGoal) ? 'new_task'
          : proposedRelation;
  // The model may classify and plan the request, but it cannot rewrite away parts
  // of the user's authoritative goal. Capability corrections are already restored
  // by createFallbackTaskDecision.
  const goal = fallback.goal;
  let primaryRoute = ROUTES.has(candidate.primaryRoute) ? candidate.primaryRoute : fallback.primaryRoute;
  if (mode !== 'execute') primaryRoute = 'direct_answer';
  if (capabilityCorrection && mode === 'execute') primaryRoute = fallback.primaryRoute;
  if (mode === 'execute' && isKnowledgeDirectoryReadRequest(goal) && (input.availableTools ?? []).includes('run_command')) {
    primaryRoute = 'run_command';
  }
  // An explicit Skill package or repository is a typed install operation. Keep
  // the model in charge of deciding whether installation is needed, while the
  // runtime guarantees that an accepted source uses the atomic native installer
  // instead of an improvised shell command.
  const explicitSkillInstall = mode === 'execute' ? resolveSkillInstallRequest(goal) : undefined;
  if (explicitSkillInstall?.sourceUrl && (input.availableTools ?? []).includes('install_skill')) {
    primaryRoute = 'install_skill';
  }
  const criteria = Array.isArray(candidate.acceptanceCriteria)
    ? candidate.acceptanceCriteria.map((item) => clean(item, 240)).filter(Boolean).slice(0, 6)
    : [];
  const requiredConstraints = taskRequirementLabels(goal);
  const protectedCriteria = defaultAcceptance(primaryRoute, goal);
  const acceptanceCriteria = [...new Set([...protectedCriteria, ...criteria])].slice(0, 8);
  const deliverableType = deliverableTypeForGoal(goal, primaryRoute, candidate.deliverableType);
  const missingUserCondition = clean(candidate.missingUserCondition, 300);
  const genuinelyNeedsUser = mode === 'execute'
    && Boolean(candidate.needsUser)
    && Boolean(missingUserCondition)
    && /账号|密码|密钥|api.?key|验证码|登录|授权|批准|付费|业务选择|文件|目录位置/iu.test(missingUserCondition);
  return {
    mode,
    turnRelation,
    goal,
    primaryRoute,
    deliverableType,
    acceptanceCriteria,
    requiredConstraints,
    deliverables: normalizedDeliverables(candidate.deliverables, primaryRoute, deliverableType) ?? fallback.deliverables,
    // The model may add specialty requirements, but it cannot remove the
    // deterministic baseline implied by a complete software product request.
    requiredCapabilities: inferCapabilityIds(goal, Array.isArray(candidate.requiredCapabilities)
      ? candidate.requiredCapabilities.map((item) => clean(item, 120)).filter(Boolean).slice(0, 12)
      : fallback.requiredCapabilities),
    riskLevel: ['low', 'normal', 'high'].includes(candidate.riskLevel) ? candidate.riskLevel : fallback.riskLevel,
    teamPolicy: candidate.teamPolicy && typeof candidate.teamPolicy === 'object' ? candidate.teamPolicy : fallback.teamPolicy,
    requiresEvidence: mode === 'execute' && (Boolean(candidate.requiresEvidence) || fallback.requiresEvidence),
    needsUser: genuinelyNeedsUser,
    missingUserCondition: genuinelyNeedsUser ? missingUserCondition : '',
    // Preserve the model's semantic query. The runtime validates it but never
    // replaces it with the full user request; a failed result is observed and
    // the model chooses the next query.
    searchQuery: primaryRoute === 'web_search' ? clean(candidate.searchQuery, 1200) || fallback.searchQuery : '',
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
- 先判断 turnRelation：当前没有任务时为 new_task；明确新的独立目标为 new_task；针对当前目标的补充为 continuation；指出理解或路线错误为 correction；暂停、继续、停止为 control；状态或含义询问为 question。它决定新消息是进入当前任务还是独立排队，不能把新任务混进旧任务。
- conversation 用于闲聊、情绪、状态询问、暂停/停止和单纯反馈；answer 用于不需要外部行动即可可靠回答的问题；execute 用于查询外部或本地事实、配置、安装、创建、修改、运行、验证、调度等任务。
- 先判断本轮说话意图，再决定是否允许工具：用户问“我这句话是什么意思”“你理解的是不是对的”“基于刚才回答……”是在追问现有对话，即使复用了“查找、技能、安装”等词，也必须选 conversation 或 answer，禁止调用工具、重放旧任务或继承旧任务的工具权限。
- 用户纠正“为什么不调用工具/不会搜索”时，要恢复最近尚未完成的真实目标，而不是把纠正句当作新目标。
- 不得因为尚未检查就假定缺少 API、账号或文件。只有明确缺少且客户端无法自行取得的凭据、授权、批准或业务选择，needsUser 才能为 true。
- acceptanceCriteria 描述最终可验收结果，不能把“调用了工具”“尝试了”当作完成。
- requiredConstraints 必须保留用户原话中的对象、地点、时间、指定工具和交付格式，不得为了缩短任务而删除条件。
- primaryRoute 只选第一条最有效路线；Skill 是可选能力，不是所有任务的必经步骤。
- deliverableType 必须按最终结果选择：普通回答 answer、真实文件 file、连接验证 connection、实际动作 operation、方案判断 decision，混合任务 mixed。不要把所有执行任务都标记成 file。
- decisionReason 只写一句可展示依据，不输出隐藏思维过程。`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        latestMessage: clean(input.latestMessage, 4000),
        previousUserMessage: clean(input.previousUserMessage, 2400),
        activeTaskGoal: clean(input.activeTaskGoal, 2400),
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
  const constraints = (decision.requiredConstraints ?? []).map((item, index) => `${index + 1}. ${item}`).join('\n');
  const deliverables = (decision.deliverables ?? []).map((item, index) => `${index + 1}. ${typeof item === 'string' ? item : item.label}`).join('\n');
  const capabilities = (decision.requiredCapabilities ?? []).join('、');
  return `## 太极任务合同
模式：${decision.mode}
真实目标：${decision.goal}
首选路线：${decision.primaryRoute}
交付类型：${decision.deliverableType || 'mixed'}
不可丢失条件：
${constraints || '1. 以用户原始请求的完整语义为准'}
完成标准：
${criteria || '1. 直接、准确地满足用户当前目标'}
预期交付物：
${deliverables || '1. 与原始目标一致的可验证结果'}
所需能力：${capabilities || '由执行器根据目标选择'}
风险等级：${decision.riskLevel || 'normal'}
是否必须有真实证据：${decision.requiresEvidence ? '是' : '否'}
${decision.needsUser ? `已确认缺少的用户条件：${decision.missingUserCondition}` : '当前不应先向用户索要条件；先自行检查并行动。'}
决策依据：${decision.decisionReason}

执行要求：每一步都要推进上述目标。工具结果只是观察，不是自动完成；失败后先分类原因，再重试瞬时错误或切换本质不同的路线。只有逐项满足完成标准才能宣布完成。${taskExperience ? `\n\n## 相似任务经验\n${taskExperience}\n经验只用于避免重复犯错，当前真实证据优先。` : ''}`;
}
