const MOA_RUNTIME_VERSION = 2;

function text(value, max = 8000) { return String(value ?? '').trim().slice(0, max); }

export function buildAdvisorMessages(input = {}) {
  const evidence = Array.isArray(input.evidence) ? input.evidence.slice(-12) : [];
  return [
    {
      role: 'system',
      content: '你是太极 MoA 的参考顾问。你不能调用工具、运行命令、访问文件或声称完成任务。只根据提供的目标和证据指出风险、遗漏、可行路线与验收方法。你的内容是给行动主模型的私有建议，不直接回复用户。不要输出思维链。',
    },
    {
      role: 'user',
      content: [
        `目标：${text(input.goal, 5000)}`,
        input.assignment ? `当前责任步骤：${text(input.assignment, 3000)}` : '',
        evidence.length ? `已有证据：\n${evidence.map((item) => `- ${text(item.summary || item.result || item, 900)}`).join('\n')}` : '已有证据：暂无',
        '请给出不超过 5 条可执行建议，重点检查是否偏离目标、是否缺少验证、是否存在更直接路线。',
      ].filter(Boolean).join('\n\n'),
    },
  ];
}

export function aggregateAdvisorGuidance(results = []) {
  const useful = (Array.isArray(results) ? results : []).filter((item) => item?.success !== false && text(item?.content));
  if (!useful.length) return { runtimeVersion: MOA_RUNTIME_VERSION, used: 0, guidance: '', skipped: true };
  const guidance = [
    '## 太极 MoA 私有顾问建议',
    '以下内容仅供行动主模型参考。顾问没有调用工具，也没有完成任务；必须由你结合真实证据自行判断、行动和验收。',
    ...useful.map((item, index) => `顾问 ${index + 1}${item.label ? `（${text(item.label, 120)}）` : ''}：\n${text(item.content, 5000)}`),
  ].join('\n\n').slice(0, 18000);
  return { runtimeVersion: MOA_RUNTIME_VERSION, used: useful.length, guidance, skipped: false };
}

export function shouldConsultAdvisors(input = {}) {
  if (input.disabled === true) return false;
  const memberCount = Number(input.memberCount) || 0;
  if (memberCount < 2) return false;
  if (input.riskLevel === 'high' || input.stepKind === 'review') return true;
  return Array.isArray(input.requiredCapabilities) && input.requiredCapabilities.length >= 2;
}

export const TAIJI_MOA_RUNTIME_VERSION = MOA_RUNTIME_VERSION;
