import type { ScriptStep } from './simulationEngine';

// 「主动型」演示剧本：一个任务走完完整 OPC 流程，角色主动发言 + 互相 @ + 推进任务。
// message 文本中内嵌 @姓名，配合 mentions 实现高亮与联动。
export const PROACTIVE_SCRIPT: ScriptStep[] = [
  {
    role: 'pm',
    message: '收到需求 🎯 拉个短会，先让 @规划者 出方案。',
    mentions: ['planner'],
  },
  {
    role: 'planner',
    message: '@编码者 方案：三栏布局 + 表单校验 + OAuth 按钮，你来实现。',
    mentions: ['coder'],
    advanceTaskTo: 'CODING',
  },
  {
    role: 'coder',
    message: '开干 💻 表单和校验写完了，@审查者 帮忙审一下。',
    mentions: ['checker'],
    advanceTaskTo: 'REVIEW',
  },
  {
    role: 'checker',
    message: '审查通过 ✅ 无 XSS、校验齐全，@协调者 可交付。',
    mentions: ['pm'],
    advanceTaskTo: 'DONE',
  },
  {
    role: 'pm',
    message: '验收交付 🎉 大家辛苦。@老汤 看下效果？',
    mentions: ['human'],
  },
];
