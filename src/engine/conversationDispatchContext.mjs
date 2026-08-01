import { inferCapabilityIds } from './capabilityGraph.mjs';

const EXPLICIT_DELIVERABLE_RE = /做|制作|开发|设计|编写|写|生成|实现|创建|完成|修复|优化|重写|起草|改造|搭建|构建|研发/u;
const SPECIALIST_DOMAIN_RE = /软件|应用|app|客户端|平台|系统|前端|后端|全栈|网页|网站|安卓|android|移动端|移动应用|UI|界面|视觉|代码|开发|编程|脚本|模型|接口|服务|文案|视频|分镜|报告|方案/iu;
const CONTEXTUAL_REFERENCE_RE = /(?:这个|那个|刚才|刚刚|上面|前面|之前|第一次|第二次|新的|最新)(?:的)?(?:任务|需求|事情|项目|方案|配置|提议|名单|人员|团队)?|按(?:这个|那个|刚才|上面|之前|第一次|第二次|新的|最新)|继续(?:刚才|上面|之前)/u;
const PROPOSAL_RE = /(?:成员|团队|配置|方案|建议|不够|至少|负责)/u;
const PRODUCT_GOAL_RE = /(?:做|制作|开发|设计|实现|创建|搭建|构建|研发).{0,48}(?:软件|应用|app|客户端|平台|系统|网站|网页|安卓|android|移动端|图片生成器)/iu;
const CORRECTION_RE = /(?:不够|不对|错了|少了|漏了|还要|也要|必须补|重新|为什么没有|为什么不)/u;

function text(value) {
  return String(value ?? '').trim();
}

/**
 * Reconstructs a contextual dispatch request from the current turn and the
 * recent dialogue. It preserves the assistant's latest structured proposal as
 * conversation evidence instead of asking the roster matcher to infer a team
 * from a short phrase such as “按第二次提议”。
 */
export function resolveDispatchContinuity(current, recentMessages = []) {
  const currentText = text(current);
  const messages = Array.isArray(recentMessages)
    ? recentMessages.filter((message) => message && (message.role === 'user' || message.role === 'assistant') && text(message.content)).slice(-24)
    : [];
  const refersToPreviousGoal = CONTEXTUAL_REFERENCE_RE.test(currentText);
  const hasConcreteCurrentGoal = EXPLICIT_DELIVERABLE_RE.test(currentText) && (SPECIALIST_DOMAIN_RE.test(currentText) || currentText.length >= 16);
  if (!refersToPreviousGoal || hasConcreteCurrentGoal) {
    return {
      contextual: false,
      request: currentText,
      originalGoal: '',
      proposal: '',
      requiredCapabilities: inferCapabilityIds(currentText),
    };
  }

  const previous = messages
    .map((message, index) => {
      const content = text(message.content);
      const score = message.role !== 'user' || content === currentText || !EXPLICIT_DELIVERABLE_RE.test(content)
        ? -1
        : (PRODUCT_GOAL_RE.test(content) ? 140 : 0)
          + (SPECIALIST_DOMAIN_RE.test(content) ? 30 : 0)
          + Math.min(content.length, 120) / 12
          - (CORRECTION_RE.test(content) ? 90 : 0)
          + index / 100;
      return { message, score };
    })
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.message;
  const proposalCandidates = messages
    .filter((message) => message.role === 'assistant' && PROPOSAL_RE.test(text(message.content)))
    .map((message, index) => ({
      message,
      capabilities: inferCapabilityIds(text(message.content)),
      score: inferCapabilityIds(text(message.content)).length * 100
        + (/(?:建议|配置|至少|不够)/u.test(text(message.content)) ? 8 : 0)
        + index,
    }))
    .filter((candidate) => candidate.capabilities.length >= 2);
  const wantsLatestRevision = /(?:第二次|新的|最新|重新|后面|最后)/u.test(currentText);
  const proposal = (wantsLatestRevision
    ? proposalCandidates.at(-1)
    : [...proposalCandidates].sort((left, right) => right.score - left.score)[0])?.message.content;
  const request = [
    previous?.content,
    proposal ? `上一轮助理明确提出的团队方案（这是当前对话事实，不要重新猜测）：\n${proposal}` : '',
    `老板最新调度要求：${currentText}`,
  ].filter(Boolean).join('\n\n');
  return {
    contextual: true,
    request: request || currentText,
    originalGoal: previous?.content ?? '',
    proposal: proposal ?? '',
    requiredCapabilities: inferCapabilityIds([previous?.content, proposal].filter(Boolean).join('\n')),
  };
}

export function resolveDispatchRequest(current, recentMessages = []) {
  return resolveDispatchContinuity(current, recentMessages).request;
}

export const TAIJI_DISPATCH_CONTEXT_VERSION = 1;
