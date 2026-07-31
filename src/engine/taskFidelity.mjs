import { resolveSkillInstallRequest } from './skillInstallRouting.mjs';
import { createExplicitResourceContract } from './explicitResourceContract.mjs';

const TOPIC_DEFINITIONS = [
  {
    id: 'weather',
    goal: /天气|气温|温度|降雨|下雨|湿度|风力|空气质量|紫外线/u,
    evidence: /天气|气温|温度|降雨|降水|湿度|风力|风速|体感|摄氏|℃|uv|紫外线|weather|temperature|humidity|precipitation/iu,
    label: '主题：天气情况',
  },
  {
    id: 'finance',
    goal: /股价|股票|汇率|金价|价格|行情|市值|指数/u,
    evidence: /股价|股票|汇率|金价|价格|行情|市值|指数|涨|跌|成交|人民币|美元|港元/u,
    label: '主题：实时行情或价格',
  },
  {
    id: 'news',
    goal: /新闻|资讯|热点|热搜|动态|进展/u,
    evidence: /新闻|资讯|消息|报道|发布|宣布|进展|动态|发生/u,
    label: '主题：新闻或最新进展',
  },
  {
    id: 'image_generation',
    goal: /生图工具|图像生成工具|图片生成(?:工具|模型)|ai\s*(?:绘图|生图)|文生图/iu,
    evidence: /生图工具|图像生成|图片生成|文生图|image.?generation|generate.?image|模型生成/iu,
    label: '方式：必须使用图片生成工具或模型',
  },
];

const ARTIFACT_DEFINITIONS = [
  { id: 'docx', goal: /(?:word|docx)(?:文件|文档)?/iu, extensions: ['.docx'], label: '交付格式：Word 文档（.docx）' },
  { id: 'xlsx', goal: /(?:excel|xlsx)(?:文件|表格)?/iu, extensions: ['.xlsx'], label: '交付格式：Excel 工作簿（.xlsx）' },
  { id: 'pptx', goal: /(?:ppt|pptx|powerpoint)(?:文件|演示文稿)?/iu, extensions: ['.pptx'], label: '交付格式：PowerPoint 演示文稿（.pptx）' },
  { id: 'pdf', goal: /pdf(?:文件|文档)?/iu, extensions: ['.pdf'], label: '交付格式：PDF（.pdf）' },
  { id: 'raster_image', goal: /(?:图片|图像|照片).{0,12}(?:png|jpe?g)|(?:png|jpe?g)(?:图片|图像|文件)?/iu, extensions: ['.png', '.jpg', '.jpeg'], label: '交付格式：位图图片' },
];

function clean(value, maxLength = 4000) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function localDateTerms() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return [String(year), `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, `${year}年${month}月${day}日`, `${month}月${day}日`];
}

function extractSpecificLocation(goal) {
  const text = clean(goal);
  const suffix = /[县区旗镇乡]/gu;
  const matches = [...text.matchAll(suffix)];
  const match = matches.at(-1);
  if (!match || match.index == null) return '';
  const suffixIndex = match.index;
  let start = Math.max(0, suffixIndex - 6);
  for (let index = suffixIndex - 1; index >= Math.max(0, suffixIndex - 8); index -= 1) {
    if (/[省市州盟，,。；;、\s]/u.test(text[index])) {
      start = index + 1;
      break;
    }
  }
  const candidate = text.slice(start, suffixIndex + 1).replace(/^(?:今天|今日|明天|后天|现在|当前)/u, '').trim();
  return /^(?:工作区|设置区|聊天区|图片区|文件区|产出物区|区域|专区)$/u.test(candidate) ? '' : candidate;
}

function extractLocationChain(goal) {
  const segments = clean(goal).split(/[，,。；;、\s]/u).filter(Boolean);
  const locationSegment = [...segments].reverse().find((part) => /(?:省|自治区|特别行政区|市|州|盟).*(?:县|区|旗|市)|(?:县|区|旗|镇|乡)$/u.test(part));
  if (!locationSegment) return '';
  return locationSegment
    .replace(/^(?:查看|查询|查找|搜索|了解|获取|看一下|查一下|今天|今日|明天|后天|现在|当前)+/u, '')
    .replace(/(?:今天|今日|明天|后天|现在|当前|的)?(?:天气|气温|温度|情况|预报).*$/u, '')
    .trim();
}

export function extractTaskRequirements(goal) {
  const text = clean(goal);
  const requirements = [];
  const explicitResource = createExplicitResourceContract(text);
  explicitResource?.urls.forEach((url, index) => requirements.push({
    id: `explicit-web-${index}`,
    kind: 'resource',
    label: `指定网页：${url}`,
    terms: [url],
  }));
  const timeMatch = text.match(/今天|今日|明天|后天|本周|本月|最近|最新|实时|当前|现在|\d{4}[年/-]\d{1,2}(?:[月/-]\d{1,2}日?)?/u)?.[0];
  if (timeMatch) {
    const terms = /今天|今日|当前|现在|实时|最新|最近/u.test(timeMatch) ? unique([timeMatch, '今天', '今日', '最新', ...localDateTerms()]) : [timeMatch];
    requirements.push({ id: 'time', kind: 'time', label: `时间：${timeMatch}`, terms });
  }
  const location = extractLocationChain(text);
  const specificLocation = extractSpecificLocation(text);
  if (location || specificLocation) {
    const exact = location || specificLocation;
    const short = specificLocation.replace(/[县区旗镇乡]$/u, '');
    requirements.push({ id: 'location', kind: 'location', label: `地点：${exact}`, terms: unique([exact, specificLocation, short]) });
  }
  for (const topic of TOPIC_DEFINITIONS) {
    if (topic.goal.test(text)) requirements.push({ id: topic.id, kind: 'topic', label: topic.label, terms: [], evidencePattern: topic.evidence });
  }
  for (const artifact of ARTIFACT_DEFINITIONS) {
    if (artifact.goal.test(text)) requirements.push({ id: artifact.id, kind: 'artifact', label: artifact.label, terms: artifact.extensions });
  }
  const quoted = [...text.matchAll(/[“"']([^”"']{2,80})[”"']/gu)].map((match) => match[1].trim());
  quoted.slice(0, 4).forEach((value, index) => requirements.push({ id: `quoted-${index}`, kind: 'entity', label: `指定对象：${value}`, terms: [value] }));
  return requirements;
}

export function taskRequirementLabels(goal) {
  return extractTaskRequirements(goal).map((item) => item.label);
}

function containsAny(text, terms) {
  const normalized = clean(text).toLowerCase();
  return terms.some((term) => term && normalized.includes(String(term).toLowerCase()));
}

export function validateSearchQueryAgainstGoal(goal, query) {
  const requirements = extractTaskRequirements(goal);
  const issues = [];
  const queryText = clean(query);
  for (const requirement of requirements) {
    if (requirement.kind === 'location' && !containsAny(queryText, requirement.terms)) issues.push(`搜索词丢失了${requirement.label}`);
    if (requirement.kind === 'topic' && !requirement.evidencePattern.test(queryText)) issues.push(`搜索词丢失了${requirement.label}`);
    if (requirement.kind === 'time' && !containsAny(queryText, requirement.terms)) issues.push(`搜索词丢失了${requirement.label}`);
    if (requirement.kind === 'entity' && !containsAny(queryText, requirement.terms)) issues.push(`搜索词丢失了${requirement.label}`);
    if (requirement.kind === 'resource' && !containsAny(queryText, requirement.terms)) issues.push(`搜索词丢失了${requirement.label}`);
  }
  return { passed: issues.length === 0, issues, requirements };
}

export function validateToolCallAgainstGoal(goal, toolName, argumentsText) {
  let args = {};
  try { args = JSON.parse(argumentsText || '{}'); } catch {}
  if (toolName === 'web_search') {
    const assessment = validateSearchQueryAgainstGoal(goal, args.query ?? '');
    return { allowed: assessment.passed, reason: assessment.issues.join('；') };
  }
  const requirements = extractTaskRequirements(goal);
  const imageMethod = requirements.some((item) => item.id === 'image_generation');
  if (imageMethod && toolName === 'write_file' && /\.svg\b/iu.test(String(args.path ?? args.filename ?? ''))) {
    return { allowed: false, reason: '用户明确要求使用生图工具，直接编写 SVG 不满足指定方式。' };
  }
  const artifact = requirements.find((item) => item.kind === 'artifact');
  if (artifact && toolName === 'write_file') {
    const path = String(args.path ?? args.filename ?? '').toLowerCase();
    if (path && !artifact.terms.some((extension) => path.endsWith(extension))) {
      return { allowed: false, reason: `输出文件格式不符合要求：${artifact.label}` };
    }
  }
  return { allowed: true, reason: '' };
}

export function assessEvidenceAlignment(goal, evidence, options = {}) {
  const requirements = extractTaskRequirements(goal);
  const text = clean(evidence, 50000);
  const issues = [];
  for (const requirement of requirements) {
    if (requirement.kind === 'location' && !containsAny(text, requirement.terms)) issues.push(`证据没有对应${requirement.label}`);
    if (requirement.kind === 'topic' && !requirement.evidencePattern.test(text)) issues.push(`证据没有包含${requirement.label}所需的数据`);
    if (requirement.kind === 'entity' && !containsAny(text, requirement.terms)) issues.push(`证据没有对应${requirement.label}`);
    if (requirement.kind === 'resource' && !containsAny(text, requirement.terms)) issues.push(`证据没有对应${requirement.label}`);
    if (requirement.kind === 'time' && options.requireTime === true && !containsAny(text, requirement.terms)) issues.push(`证据没有对应${requirement.label}`);
  }
  return { passed: issues.length === 0, issues, requirements };
}

export function assessTaskCompletion(goal, finalContent, callLog = []) {
  const requirements = extractTaskRequirements(goal);
  const combinedEvidence = callLog.map((call) => `${call.name}\n${call.args}\n${call.result}`).join('\n\n');
  const issues = [];
  const skillInstall = resolveSkillInstallRequest(goal);
  if (skillInstall?.sourceUrl) {
    const target = String(skillInstall.slug || skillInstall.name || '').toLocaleLowerCase();
    const installed = callLog.find((call) => call.name === 'install_skill'
      && call.success
      && (!target || `${call.args}\n${call.result}`.toLocaleLowerCase().includes(target)));
    if (!installed) {
      issues.push(`没有真实安装目标 Skill${target ? `“${target}”` : ''}`);
    } else {
      const readBackVerified = /自动回读验证|完整包回读验证|manifestReadable|回读(?:规则)?文档|已核验源文件|verified.{0,8}true/iu.test(installed.result)
        || callLog.some((call) => call.name === 'read_skill' && call.success
          && (!target || `${call.args}\n${call.result}`.toLocaleLowerCase().includes(target)));
      if (!readBackVerified) issues.push('Skill 写入后没有完成 SKILL.md 回读与完整性验证');
    }
  }
  const hasResearch = callLog.some((call) => call.name === 'web_search' && call.success);
  if (hasResearch) {
    const requireTime = requirements.some((item) => item.kind === 'time');
    const evidenceAligned = assessEvidenceAlignment(goal, combinedEvidence, { requireTime });
    const answerAligned = assessEvidenceAlignment(goal, finalContent, { requireTime });
    issues.push(...evidenceAligned.issues, ...answerAligned.issues.map((issue) => `最终回答${issue}`));
  }
  const imageMethod = requirements.some((item) => item.id === 'image_generation');
  if (imageMethod) {
    const usedImageTool = callLog.some((call) => /image|生图|绘图/iu.test(call.name) && !/^write_file$/u.test(call.name));
    if (!usedImageTool) issues.push('没有真实调用用户指定的图片生成工具或模型');
  }
  const artifact = requirements.find((item) => item.kind === 'artifact');
  if (artifact) {
    const matchingFile = callLog.some((call) => call.name === 'write_file' && artifact.terms.some((extension) => `${call.args}\n${call.result}`.toLowerCase().includes(extension)) && call.success);
    if (!matchingFile) issues.push(`没有生成并验证${artifact.label}`);
  }
  return { passed: issues.length === 0, issues, requirements };
}
