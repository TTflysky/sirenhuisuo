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

export function requiresFreshWebResearch(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;
  if (/(?:为什么|为何|怎么|是否|有没有).{0,18}(?:搜索|查询|联网).{0,18}(?:失败|没调用|不能用|不可用|没反应)/u.test(text)) return false;
  const explicitInternetSearch = /(?:^|帮我|给我|请|去|需要|重新|直接|现在|先).{0,12}(?:联网搜索|上网搜索|网络搜索|搜索互联网|网上查|上网查)/u.test(text);
  const explicitResearch = /(?:^|帮我|给我|请|去|需要|重新|直接|现在|先).{0,12}(?:搜索|搜一下|搜集|查找|查询|检索).{0,30}(?:资料|文档|新闻|资讯|消息|行情|价格|来源|官网|政策|数据|进展)/u.test(text);
  const freshInformation = /(?:今天|今日|本周|本月|最新|实时|当前).{0,24}(?:新闻|资讯|消息|热点|行情|价格|股价|汇率|天气|政策|数据|进展|动态|资料|信息)/u.test(text);
  return explicitInternetSearch || explicitResearch || freshInformation;
}

export function buildFreshWebQuery(message) {
  const original = String(message ?? '').trim().slice(0, 300);
  if (!original) return '';
  const withoutCommand = original
    .replace(/^(?:请|麻烦|现在|先|直接)?(?:你)?(?:帮我|给我|替我)?(?:去)?(?:联网搜索|上网搜索|网络搜索|搜索互联网|网上查|上网查|搜索|搜一下|搜集|查找|查询|检索)(?:一下|一下子)?[：:，,\s]*/u, '')
    .replace(/^(?:那|那么)?(?:你)?(?:帮我|给我|替我)?(?:提炼|整理|总结|汇总|介绍|说说)(?:一下)?[：:，,\s]*/u, '')
    .replace(/(?:然后|并且|之后|再)[，,\s]*(?:帮我|给我)?(?:做|整理|生成|写|制作|汇总).{0,80}$/u, '')
    .replace(/[，,]\s*\d{1,2}\s*(?:条|个|则|项|篇).{0,80}$/u, '')
    .replace(/[，,]\s*(?:帮我|给我)?(?:总结|汇总|整理|做成|写成).{0,80}$/u, '')
    .replace(/(?:然后)?(?:跟我说|告诉我|直接给我(?:内容|结果)|直接说).{0,40}$/u, '')
    .replace(/[“”"'。！？!?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[，,：:\s]+$/u, '')
    .trim();
  return (withoutCommand || original).slice(0, 300);
}

export function isResearchOnlyRequest(message) {
  const text = String(message ?? '').trim();
  if (!requiresFreshWebResearch(text)) return false;
  const needsAnotherDeliverable = /(?:安装|部署|开发|编程|写代码|修改|修复|更新项目|升级程序|创建文件|生成文件|保存文件|下载|上传|提交|打包|运行|执行命令|接入|连接|配置)|(?:Excel|Word|PPT|PDF|表格|脚本|代码|程序|项目文件).{0,16}(?:制作|生成|修改|写|保存)/iu.test(text);
  return !needsAnotherDeliverable;
}

function parsedResearchRows(searchOutput) {
  return [...String(searchOutput ?? '').matchAll(/(?:^|\n\n)(\d+)\.\s+([^\n]+)\n(https?:\/\/[^\s]+)\n([\s\S]*?)(?=\n\n\d+\.\s|$)/gu)].map((match) => ({
    title: match[2].trim(),
    url: match[3].trim(),
    snippet: match[4].replace(/\s+/g, ' ').trim(),
  }));
}

export function extractResearchSources(searchOutput, limit = 5) {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 5, 8));
  return parsedResearchRows(searchOutput).slice(0, safeLimit);
}

export function isResearchDeliveryDeflection(content) {
  const text = String(content ?? '').trim();
  if (!text) return true;
  return /(?:只|仅).{0,12}(?:拿到|获得|找到).{0,16}(?:资讯入口|信息入口|搜索入口|链接)/u.test(text)
    || /(?:没有|未能|无法|不能).{0,20}(?:拿到|获得|提取|读取).{0,16}(?:具体新闻|新闻标题|正文|完整内容)/u.test(text)
    || /(?:把|将|请).{0,24}(?:链接|截图|新闻原文|正文).{0,16}(?:发给我|发过来|贴给我|提供给我|重新上传)/u.test(text)
    || /(?:需要你|请你).{0,16}(?:打开|查看|阅读).{0,16}(?:来源|链接|网页)/u.test(text);
}

function requestedResearchCount(userText, available) {
  const requested = Number(/(?:^|\D)(\d{1,2})\s*(?:条|个|则|项|篇)/u.exec(String(userText ?? ''))?.[1] ?? 5);
  return Math.max(1, Math.min(Number.isFinite(requested) ? requested : 5, available, 10));
}

export function buildResearchFallback(userText, searchOutput, modelError = '') {
  const rows = parsedResearchRows(searchOutput);
  const count = requestedResearchCount(userText, rows.length);
  if (rows.length === 0) {
    return `搜索已经完成，但整理模型暂时没有回应。以下是搜索服务返回的原始资料：\n\n${String(searchOutput ?? '').slice(0, 10000)}`;
  }
  const items = rows.slice(0, count).map((row, index) => {
    const summary = row.snippet || '该来源未返回可核验摘要，当前仅确认标题与来源，不补写未经证实的细节。';
    return `**${index + 1}. ${row.title}**\n${summary}\n[查看来源](${row.url})`;
  });
  const note = modelError ? '整理模型连续重试后仍未回应，已直接根据搜索标题、摘要和链接生成结果。' : '已根据真实搜索结果整理。';
  return `搜索完成。${note}\n\n${items.join('\n\n')}`;
}

export function ensureResearchSourceLinks(content, userText, searchOutput) {
  const rows = parsedResearchRows(searchOutput);
  if (rows.length === 0) return content;
  const count = requestedResearchCount(userText, rows.length);
  const selected = rows.slice(0, count);
  const missing = selected.filter((row) => !String(content ?? '').includes(row.url));
  if (missing.length === 0) return content;
  const links = selected.map((row, index) => `${index + 1}. [${row.title}](${row.url})`).join('\n');
  return `${String(content ?? '').trim()}\n\n**来源链接**\n${links}`.trim();
}

export function isConversationOnlyMessage(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;
  if (isExplicitResumeSteering([text]) || isExplicitNewWork(text) || requiresFreshWebResearch(text)) return false;
  const executionControl = isExplicitPauseSteering([text]) || isExplicitStopSteering([text]);
  const statusQuestion = /(?:做到哪|进行到哪|什么状态|现在怎样|卡在哪里|需要帮助吗|为什么还在|怎么还在|到底在做什么)/u.test(text);
  const feedbackSubject = /(?:你|助手|员工|团队|刚才|这次|当前任务|这个任务|执行过程|操作|回答|内核|逻辑)/u.test(text);
  const feedback = /(?:没有意义|浪费|重复|循环|答非所问|没理解|不对|有问题|出问题|太机械|太死板|没有自主|为什么|怎么回事|让我烦|让人烦|体验很差)/u.test(text);
  if (executionControl || statusQuestion || (feedbackSubject && feedback)) return true;
  // 默认把不含明确行动目标的消息当作对话。这样旧任务上下文不会因为一句
  // 普通追问、反馈或闲聊而重新获得工具权限。
  return true;
}
