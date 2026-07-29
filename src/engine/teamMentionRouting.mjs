const CONTROL_RE = /(?:暂停|停止|先停|停下|不要继续|继续任务|恢复任务|恢复执行|汇报|报告|报数|报个数|什么模型|哪个模型|在线情况|当前状态)/u;
const TASK_RE = /(?:帮我|请你|麻烦你|请|负责|接手|完成|编写|写一份|重新起草|起草|修改|改写|修复|实现|制作|生成|创建|删除|检查并修复|执行|测试|验证|整理|调研|搜索资料|查资料|查一下|查询|检索|安装|配置|更新|优化|设计|开发|打包|提交)/u;
const STATUS_RE = /(?:在吗|看到了吗|收到吗|做到哪|进展|进行到哪|什么状态|现在怎样|卡在哪里|需要我补充|能不能|可以吗|为什么没|怎么没|有没有回复|回复我|说一下|说明一下|确认一下|告诉我|跟我说|汇报一下|模型|状态)/u;

/**
 * Classify a direct employee mention before the general conversation guardrail.
 * A mention is a lightweight conversation by default; only an explicit action
 * becomes a formal task. This keeps follow-up questions alive after a task ends.
 */
export function classifyTeamMention(text, options = {}) {
  const value = String(text ?? '').trim();
  if (!value) return 'reply';
  if (options.assistantRelay && /@[^@\s，。！？!?：:；;、]+\s*(?:请|麻烦|需要|先|继续)?\s*(?:回复|说明|确认|看看|检查|汇报|告诉|报告)/u.test(value)) return 'reply';
  if (CONTROL_RE.test(value)) return 'control';
  if (STATUS_RE.test(value) && !/(?:重新起草|写一份|修改|修复|完成|执行|制作|生成|创建)/u.test(value)) return 'reply';
  if (TASK_RE.test(value)) return 'task';
  return 'reply';
}

export function isTeamMentionTask(text) {
  return classifyTeamMention(text) === 'task';
}
