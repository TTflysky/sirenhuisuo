const PREPARATION_ONLY_TOOLS = new Set([
  'inspect_connectors',
  'list_files',
  'read_file',
  'read_skill',
  'read_web_page',
  'search_skills',
  'web_search',
]);

const CONNECTOR_LIMITS = {
  inspect_connectors: 2,
  install_skill: 2,
  prepare_connector: 2,
  read_file: 4,
  read_skill: 3,
  read_web_page: 3,
  run_command: 6,
  search_skills: 3,
  test_connector: 3,
  web_search: 3,
};

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/\s+/g, ' ').toLowerCase();
}

function parseArgs(argumentsText) {
  try {
    const value = JSON.parse(argumentsText || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? normalizeText(value) : value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function canonicalToolCallKey(name, argumentsText) {
  const args = parseArgs(argumentsText);
  const tool = normalizeText(name);
  if (tool === 'read_skill') return `${tool}:${normalizeText(args.id ?? args.skillId ?? args.name ?? args.path)}`;
  if (tool === 'read_file') return `${tool}:${normalizeText(args.path ?? args.filename)}:${normalizeText(args.offset ?? '0')}:${normalizeText(args.limit ?? '')}`;
  if (tool === 'search_skills' || tool === 'web_search') return `${tool}:${normalizeText(args.query)}`;
  if (tool === 'inspect_connectors') return `${tool}:${normalizeText(args.query ?? args.preset ?? args.name)}`;
  if (tool === 'prepare_connector' || tool === 'test_connector') return `${tool}:${normalizeText(args.connector ?? args.connectorId ?? args.id ?? args.preset)}`;
  if (tool === 'run_command') {
    return `${tool}:${normalizeText(args.command)}:${normalizeText(args.connector ?? args.connectorId)}:${Boolean(args.verification)}`;
  }
  return `${tool}:${JSON.stringify(stableValue(args))}`;
}

export function toolResourceKey(name, argumentsText) {
  const args = parseArgs(argumentsText);
  const tool = normalizeText(name);
  if (tool === 'read_skill') return `skill:${normalizeText(args.id ?? args.skillId ?? args.name ?? args.path)}`;
  if (tool === 'read_file') return `file:${normalizeText(args.path ?? args.filename)}`;
  if (tool === 'read_web_page') return `web:${normalizeText(args.url ?? args.href)}`;
  return '';
}

export function isPreparationOnlyTool(name) {
  return PREPARATION_ONLY_TOOLS.has(normalizeText(name));
}

export function getToolCallLimit(name, connectorTask) {
  const tool = normalizeText(name);
  if (connectorTask && Object.prototype.hasOwnProperty.call(CONNECTOR_LIMITS, tool)) return CONNECTOR_LIMITS[tool];
  if (tool === 'read_skill') return 4;
  if (tool === 'search_skills') return 5;
  if (tool === 'read_file' || tool === 'read_web_page') return 12;
  return connectorTask ? 8 : 24;
}

export function isExplicitStopSteering(messages) {
  const text = messages.join('\n').trim();
  if (!text || /(?:不要|别|无需).{0,4}(?:停止|停下|取消)/u.test(text)) return false;
  return /(?:停止|停下|取消|别做了|不用做了|不要继续|无需继续|先到这里)/u.test(text);
}

export function isExplicitPauseSteering(messages) {
  const text = messages.join('\n').trim();
  if (!text || /(?:不要|别|无需).{0,4}(?:暂停|先停)/u.test(text)) return false;
  return /(?:暂停|先停一下|先等一下|先别继续|等我一下)/u.test(text);
}

export function isExplicitResumeSteering(messages) {
  const text = messages.join('\n').trim();
  if (!text || /(?:不要|别|无需).{0,6}(?:继续|恢复|接着)/u.test(text)) return false;
  return /^(?:请)?(?:继续|恢复|接着)(?:任务|执行|操作|工作|处理|刚才的任务)?(?:吧|一下|了)?(?:[，,：:]?.{0,30})?[。！!\s]*$/u.test(text);
}

export function getDirectExecutionControl(message) {
  const text = String(message ?? '').trim();
  if (/^(?:请|先)?(?:停止|停下|取消)(?:任务|执行|操作|工作|处理)?(?:吧|一下|了)?[。！!\s]*$/u.test(text)
      || /^(?:别做了|不用做了|不要继续|无需继续|先到这里)[。！!\s]*$/u.test(text)) return 'stop';
  if (/^(?:请|先)?(?:暂停|先停一下|先等一下|等我一下)(?:任务|执行|操作|工作|处理)?(?:吧|了)?[。！!\s]*$/u.test(text)) return 'pause';
  if (/^(?:请)?(?:继续|恢复|接着)(?:任务|执行|操作|工作|处理|刚才的任务)?(?:吧|一下|了)?[。！!\s]*$/u.test(text)
      || /^(?:继续|恢复|接着)[，,](?:刚刚|刚才).{0,12}(?:掉线|断线|中断|暂停)(?:了)?[。！!\s]*$/u.test(text)) return 'resume';
  return null;
}

export function shouldHoldTaskForFeedback(message) {
  const text = String(message ?? '').trim();
  if (!text || isExplicitResumeSteering([text])) return false;
  return /(?:没有任何?意义|毫无意义|浪费(?:时间|算力|额度)|纯属浪费)|(?:一直|不断|反复).{0,12}(?:重复|循环)|(?:重复|循环).{0,12}(?:读取|调用|执行|尝试|操作)|(?:先别再|不要再).{0,20}(?:重复|调用|读取|执行|尝试)|(?:我|用户)?已(?:经)?(?:暂停|停止).{0,8}(?:任务|执行)/u.test(text);
}

function isExplicitNewWork(text) {
  const action = '(?:配置|安装|创建|生成|编写|写|修改|改掉|改好|修复|修好|优化|测试|验证|下载|上传|部署|发布|打包|搜索|查找|查询|检查|核对|读取|打开|执行|完成|删除|移除|覆盖|同步|提交|整理|分析|设计|制作|接入|连接|关联|调用|更新|升级|添加|补齐|恢复)';
  return new RegExp(`(?:帮我|请你|给我|替我|麻烦|现在|接下来|然后|顺便|一并|直接).{0,16}${action}`, 'u').test(text)
    || new RegExp(`(?:把|将).{1,100}${action}`, 'u').test(text)
    || new RegExp(`^(?:先|再|重新|继续)?${action}`, 'u').test(text)
    || new RegExp(`(?:问题|逻辑|内核|界面|功能|文件|项目|任务|连接器|技能|Skill).{0,18}${action}`, 'iu').test(text)
    || /(?:今天|明天|最新|实时).{0,20}(?:天气|新闻|价格|股价|汇率|资料|信息)/u.test(text);
}

export function isConversationOnlyMessage(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;
  if (isExplicitResumeSteering([text]) || isExplicitNewWork(text)) return false;
  const executionControl = isExplicitPauseSteering([text]) || isExplicitStopSteering([text]);
  const statusQuestion = /(?:做到哪|进行到哪|什么状态|现在怎样|卡在哪里|需要帮助吗|为什么还在|怎么还在|到底在做什么)/u.test(text);
  const feedbackSubject = /(?:你|助手|员工|团队|刚才|这次|当前任务|这个任务|执行过程|操作|回答|内核|逻辑)/u.test(text);
  const feedback = /(?:没有意义|浪费|重复|循环|答非所问|没理解|不对|有问题|出问题|太机械|太死板|没有自主|为什么|怎么回事|让我烦|让人烦|体验很差)/u.test(text);
  if (executionControl || statusQuestion || (feedbackSubject && feedback)) return true;
  // 默认把不含明确行动目标的消息当作对话。这样旧任务上下文不会因为一句
  // 普通追问、反馈或闲聊而重新获得工具权限。
  return true;
}
