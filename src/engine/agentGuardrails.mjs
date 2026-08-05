import { assessEvidenceAlignment, extractTaskRequirements } from './taskFidelity.mjs';

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
    return `${tool}:${normalizeText(args.command ?? args.cmd)}:${normalizeText(args.connector ?? args.connectorId)}:${Boolean(args.verification)}`;
  }
  return `${tool}:${JSON.stringify(stableValue(args))}`;
}

export function compactToolArgumentsForHistory(name, argumentsText, success = false) {
  const tool = normalizeText(name);
  if (!success || tool !== 'write_file') return String(argumentsText ?? '');
  const args = parseArgs(argumentsText);
  if (typeof args.content !== 'string') return String(argumentsText ?? '');
  return JSON.stringify({
    ...args,
    content: `[content omitted after successful write: ${args.content.length} characters; use read_file when the contents are needed]`,
  });
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
  if (tool === 'verify_web_artifact') return 6;
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
  if (/^(?:请|先)?(?:停止|停下|取消)(?:(?:这个|当前)?(?:任务|执行|操作|工作|处理))?(?:吧|一下|了)?(?:[，,：:].*)?[。！!\s]*$/u.test(text)
      || /^(?:请|先)?(?:停止|停下|取消)[^。！？!?]{0,80}[。！？!?\s]*$/u.test(text)
      || /^(?:别做了|不用做了|不要继续|无需继续|先到这里)[。！!\s]*$/u.test(text)) return 'stop';
  if (/^(?:请|先)?(?:暂停|先停一下|先等一下|等我一下)(?:(?:这个|当前)?(?:任务|执行|操作|工作|处理))?(?:吧|了)?(?:[，,：:].*)?[。！!\s]*$/u.test(text)
      || /^(?:请|先)?暂停[^。！？!?]{0,80}[。！？!?\s]*$/u.test(text)) return 'pause';
  if (isExplicitResumeSteering([text])) return 'resume';
  return null;
}

export function shouldHoldTaskForFeedback(message) {
  const text = String(message ?? '').trim();
  if (!text || isExplicitResumeSteering([text])) return false;
  return /(?:没有任何?意义|毫无意义|浪费(?:时间|算力|额度)|纯属浪费)|(?:一直|不断|反复).{0,12}(?:重复|循环)|(?:重复|循环).{0,12}(?:读取|调用|执行|尝试|操作)|(?:先别再|不要再).{0,20}(?:重复|调用|读取|执行|尝试)|(?:我|用户)?已(?:经)?(?:暂停|停止).{0,8}(?:任务|执行)/u.test(text);
}

function isExplicitNewWork(text) {
  const action = '(?:配置|安装|创建|生成|编写|写|修改|改掉|改好|修复|修好|解决|实现|落地|优化|测试|验证|下载|上传|部署|发布|打包|搜索|搜(?:一下|集)?|查(?:一下|查看)?|查找|查询|检索|找(?:一下)?|看看|浏览|了解|获取|列出|统计|对比|检查|核对|读取|打开|执行|完成|删除|移除|覆盖|同步|提交|整理|分析|设计|制作|接入|连接|关联|调用|更新|升级|添加|补齐|恢复|组建|拉|安排|调度)';
  return new RegExp(`(?:帮我|请你|请|给我|替我|麻烦|现在|接下来|然后|顺便|一并|直接).{0,16}${action}`, 'u').test(text)
    || new RegExp(`(?:把|将).{1,100}${action}`, 'u').test(text)
    || new RegExp(`^(?:先|再|重新|继续)?${action}`, 'u').test(text)
    || new RegExp(`(?:不是|不对|而不是).{0,36}(?:我是让你|是让你|我要你|需要你|应该).{0,16}${action}`, 'u').test(text)
    || new RegExp(`(?:问题|逻辑|内核|界面|功能|文件|项目|任务|连接器|技能|Skill).{0,18}${action}`, 'iu').test(text)
    || /(?:今天|今日|明天|最近|最新|实时|当前).{0,24}(?:天气|新闻|价格|股价|汇率|资料|信息|热点|热度|热搜|榜单|排行|排名|趋势|动态)/u.test(text);
}

export function isActionableCapabilityCorrection(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;
  const capability = /(?:工具|技能|skill|联网|网络|搜索|查询|检索|连接器|命令|浏览器)/iu.test(text);
  const correction = /(?:应该|应当|需要|必须|直接|主动|自己|赶紧|重新|继续|难道不会|不会用|别只|不要只|不能只)/u.test(text);
  const action = /(?:用|使用|调用|搜索|搜|查询|查|检索|执行|行动|完成)/u.test(text);
  return capability && correction && action;
}

export function resolveActionableUserGoal(message, previousUserMessage) {
  const current = String(message ?? '').trim();
  const previous = String(previousUserMessage ?? '').trim();
  // A correction only inherits a previous goal when it actually refers back to
  // that goal. A complete new request must start from fresh observations.
  const refersToPreviousWork = /(?:\u4e0a\u6b21|\u4e0a\u9762|\u4e4b\u524d|\u521a\u624d|\u7ee7\u7eed|\u539f\u4efb\u52a1|\u8fd9\u4e2a\u4efb\u52a1|\u6309\u521a\u624d|\u5b83|\u8be5\u4efb\u52a1)|\b(?:continue|resume|previous|above|prior|same task)\b/iu.test(current);
  const introducesNewTarget = /(?:\u672c\u5730|\u5f53\u524d|\u6570\u91cf|\u591a\u5c11|\u6e05\u5355|\u76ee\u5f55|\u6587\u4ef6|\u8fde\u63a5\u5668|\u6a21\u578b|\u5458\u5de5|\u56e2\u961f|\u5de5\u4f5c\u533a|\u6280\u80fd\u5e93|\u4ea7\u51fa\u7269|\u72b6\u6001)/u.test(current);
  const capabilityCorrection = isActionableCapabilityCorrection(current);
  const correctiveFraming = /(?:不对|不要|别(?:只|再|用)|应该|应当|而不是|难道|为什么|怎么(?:不|还)|没有|没(?:有|做|查|用)|只读)/u.test(current);
  const acceptanceFailure = /(?:没有|未|缺少|看不到|不存在|只有).{0,48}(?:通过|完成|显示|可见|框架|外壳|标题|按钮|内容|结果|产物|功能)|(?:框架|外壳).{0,24}(?:没有|缺少|看不到)/u.test(current);
  // A route correction often names the failed route (for example "本地" or
  // "连接器").  That is not a new task target, so decide correction status
  // before applying the self-contained-request isolation rule.
  if (!refersToPreviousWork && introducesNewTarget && (!capabilityCorrection || !correctiveFraming) && !acceptanceFailure) return current;
  if (acceptanceFailure && previous && !isConversationOnlyMessage(previous)) return `${previous}\n验收反馈：${current}`;
  if (!capabilityCorrection || !previous || isConversationOnlyMessage(previous)) return current;
  const addsHardConstraint = /(?:我)?(?:需要|要求|必须|只能|务必|改用|换成|不能|不要).{0,48}(?:工具|方式|格式|文件|模型|路线)|而不是/u.test(current);
  return addsHardConstraint ? `${previous}\n新增约束：${current}` : previous;
}

export function requiresObservableExecutionEvidence(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;
  if (requiresFreshWebResearch(text) || /连接器|知识库|MCP|Obsidian|Vault/iu.test(text) && /配置|验证|测试|接入|连接|关联/iu.test(text)) return true;
  const concreteTarget = /文件|代码|脚本|项目|仓库|程序|应用|安装包|构建|界面|UI|功能|逻辑|内核|连接器|知识库|数据库|Skill|技能|接口|API|配置|工作区/iu.test(text);
  const concreteAction = /安装|部署|创建|生成|编写|写入|保存|修改|修复|优化|改进|调整|完善|更新|升级|删除|移除|覆盖|同步|提交|打包|下载|上传|运行|执行|测试|验证|接入|连接|关联|配置|补齐|恢复/iu.test(text);
  const explicitCommand = /执行命令|运行命令|打开(?:设置|文件|页面|程序)|真正(?:写入|保存|安装|连接|执行)|落盘/iu.test(text);
  return explicitCommand || (concreteTarget && concreteAction);
}

export function requiresFreshWebResearch(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;
  if (/(?:为什么|为何|怎么|是否|有没有).{0,18}(?:搜索|查询|联网).{0,18}(?:失败|没调用|不能用|不可用|没反应)/u.test(text)) return false;
  const explicitInternetSearch = /(?:^|帮我|给我|请|去|需要|重新|直接|现在|先).{0,12}(?:联网搜索|上网搜索|网络搜索|搜索互联网|网上查|上网查)/u.test(text);
  const lookupAction = /(?:搜索|搜(?:一下|集)?|查(?:一下|查看)?|查找|查询|检索|找(?:一下)?|调研|了解|获取)/u.test(text);
  const directLookupRequest = /^(?:请|麻烦|现在|先|直接)?(?:你)?(?:帮我|给我|替我)?(?:去)?(?:搜索|搜(?:一下|集)?|查(?:一下|查看)?|查找|查询|检索|找(?:一下)?|调研|了解|获取)/u.test(text);
  const explicitResearch = lookupAction && /(?:资料|文档|新闻|资讯|消息|行情|价格|来源|官网|政策|数据|进展|动态|热点|热度|热搜|榜单|排行|排名|趋势|话题)/u.test(text);
  const freshInformation = /(?:今天|今日|本周|本月|最近|刚刚|最新|实时|当前|现在).{0,32}(?:新闻|资讯|消息|热点|热度|热搜|榜单|排行|排名|趋势|话题|行情|价格|股价|汇率|天气|政策|数据|进展|动态|资料|信息)/u.test(text);
  const externalPlatform = /(?:抖音|微博|小红书|快手|哔哩哔哩|B站|知乎|今日头条|微信公众号|百度|淘宝|京东|拼多多|闲鱼|雪球|东方财富|社交平台|短视频平台)/iu.test(text);
  const localOrConnectorTarget = /(?:本地|工作区|文件|目录|代码|项目|仓库|产出物|聊天记录|员工|团队|设置|配置|连接器|知识库|obsidian|(?:^|[^a-z])ima(?:[^a-z]|$)|github)/iu.test(text);
  return explicitInternetSearch
    || freshInformation
    || ((directLookupRequest || explicitResearch || (lookupAction && externalPlatform)) && !localOrConnectorTarget);
}

export function buildFreshWebQuery(message) {
  const original = String(message ?? '').trim().slice(0, 300);
  if (!original) return '';
  const withoutCommand = original
    .replace(/^(?:请|麻烦|现在|先|直接)?(?:你)?(?:帮我|给我|替我)?(?:去)?(?:联网搜索|上网搜索|网络搜索|搜索互联网|网上查|上网查|查看|搜索|搜(?:一下|集)?|查询|查找|查(?:一下)?|检索|找(?:一下)?|看(?:一下)?|调研|了解|获取)(?:一下|一下子)?[：:，,\s]*/u, '')
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

function relevantResearchRows(userText, searchOutput) {
  const rows = parsedResearchRows(searchOutput);
  if (!String(userText ?? '').trim()) return rows;
  const requireTime = extractTaskRequirements(userText).some((item) => item.kind === 'time');
  return rows.filter((row) => assessEvidenceAlignment(userText, `${row.title}\n${row.url}\n${row.snippet}`, { requireTime }).passed);
}

export function extractRelevantResearchSources(userText, searchOutput, limit = 5) {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 5, 8));
  return relevantResearchRows(userText, searchOutput).slice(0, safeLimit);
}

export function isResearchEvidenceRelevant(userText, searchOutput) {
  return relevantResearchRows(userText, searchOutput).length > 0;
}

export function isResearchDeliveryDeflection(content) {
  const text = String(content ?? '').trim();
  if (!text) return true;
  return /(?:只|仅).{0,12}(?:拿到|获得|找到).{0,16}(?:资讯入口|信息入口|搜索入口|链接)/u.test(text)
    || /(?:没有|未能|无法|不能).{0,20}(?:拿到|获得|提取|读取).{0,16}(?:具体新闻|新闻标题|正文|完整内容)/u.test(text)
    || /(?:没有|未能|无法|不能).{0,20}(?:直接)?(?:访问|读取|获取|查询).{0,24}(?:实时|榜单|排行|热度|热搜|平台内容)/u.test(text)
    || /(?:截图|页面链接|榜单链接).{0,16}(?:发给我|发过来|贴给我|提供给我)/u.test(text)
    || /(?:把|将|请).{0,24}(?:链接|截图|新闻原文|正文).{0,16}(?:发给我|发过来|贴给我|提供给我|重新上传)/u.test(text)
    || /(?:需要你|请你).{0,16}(?:打开|查看|阅读).{0,16}(?:来源|链接|网页)/u.test(text);
}

function requestedResearchCount(userText, available) {
  const requested = Number(/(?:^|\D)(\d{1,2})\s*(?:条|个|则|项|篇)/u.exec(String(userText ?? ''))?.[1] ?? 5);
  return Math.max(1, Math.min(Number.isFinite(requested) ? requested : 5, available, 10));
}

export function buildResearchFallback(userText, searchOutput, modelError = '') {
  const rows = relevantResearchRows(userText, searchOutput);
  const count = requestedResearchCount(userText, rows.length);
  if (rows.length === 0) {
    return `这次没有查到能直接回答“${String(userText ?? '').trim().slice(0, 160)}”的可靠结果。搜索服务虽然返回了内容，但没有覆盖原问题中的关键对象、地点、时间或主题，因此太极已拦截这些偏题结果，没有把它们冒充答案。`;
  }
  const items = rows.slice(0, count).map((row, index) => {
    const summary = row.snippet || '该来源未返回可核验摘要，当前仅确认标题与来源，不补写未经证实的细节。';
    return `**${index + 1}. ${row.title}**\n${summary}\n[查看来源](${row.url})`;
  });
  const note = modelError ? '整理模型连续重试后仍未回应，已直接根据搜索标题、摘要和链接生成结果。' : '已根据真实搜索结果整理。';
  return `搜索完成。${note}\n\n${items.join('\n\n')}`;
}

export function ensureResearchSourceLinks(content, userText, searchOutput) {
  const rows = relevantResearchRows(userText, searchOutput);
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
  if (/(?:没有|未|缺少|看不到|不存在|只有).{0,48}(?:通过|完成|显示|可见|框架|外壳|标题|按钮|内容|结果|产物|功能|蛇|果子)|(?:框架|外壳).{0,24}(?:没有|缺少|看不到)/u.test(text)) return false;
  const executionControl = isExplicitPauseSteering([text]) || isExplicitStopSteering([text]);
  const statusQuestion = /(?:做到哪|进行到哪|什么状态|现在怎样|卡在哪里|需要帮助吗|为什么还在|怎么还在|到底在做什么)/u.test(text);
  const feedbackSubject = /(?:你|助手|员工|团队|刚才|这次|当前任务|这个任务|执行过程|操作|回答|内核|逻辑)/u.test(text);
  const feedback = /(?:没有意义|浪费|重复|循环|答非所问|没理解|不对|有问题|出问题|太机械|太死板|没有自主|为什么|怎么回事|让我烦|让人烦|体验很差)/u.test(text);
  if (executionControl || statusQuestion || (feedbackSubject && feedback)) return true;
  // 默认把不含明确行动目标的消息当作对话。这样旧任务上下文不会因为一句
  // 普通追问、反馈或闲聊而重新获得工具权限。
  return true;
}
