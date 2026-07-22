import type { Team } from '../types';
import { seedEmployees } from './defaultEmployees';

const now = Date.now();

export const seedTeams: Team[] = [
  {
    id: 'team-opc',
    name: 'OPC 协作组',
    icon: '🏢',
    memberIds: seedEmployees.map((e) => e.id),
    chatMessages: [
      {
        id: 'msg-welcome',
        authorId: 'emp-pm',
        roleId: 'pm',
        content:
          '各位早上好！🏢 OPC 协作组已就位，等待任务分配。@planner @coder @checker 请确认在线状态。',
        mentions: ['emp-planner', 'emp-coder', 'emp-checker'],
        timestamp: now - 60000,
        kind: 'text',
      },
      {
        id: 'msg-p-ok',
        authorId: 'emp-planner',
        roleId: 'planner',
        content: '@pm 规划者在线 ✅ 方案随时待命。',
        mentions: ['emp-pm'],
        timestamp: now - 50000,
        kind: 'text',
      },
      {
        id: 'msg-c-ok',
        authorId: 'emp-coder',
        roleId: 'coder',
        content: '@pm 编码者在线 ✅ 代码已热好。',
        mentions: ['emp-pm'],
        timestamp: now - 40000,
        kind: 'text',
      },
      {
        id: 'msg-ch-ok',
        authorId: 'emp-checker',
        roleId: 'checker',
        content: '@pm 审查者在线 ✅ 放心交给我。',
        mentions: ['emp-pm'],
        timestamp: now - 30000,
        kind: 'text',
      },
    ],
    tasks: [
      {
        id: 'task-1',
        title: '搭建 Hermes 可视化办公室',
        lane: 'DONE',
        assigneeId: 'emp-coder',
        description: '基于 BV1QbVE6GE9a 视频做 Hermes agent 可视化办公界面',
        acceptance: 'dev server 启动、四角色卡渲染、看板可拖拽',
        claimedBy: 'emp-coder',
      },
      {
        id: 'task-2',
        title: 'Coze×Marvis AI 办公室桌面应用',
        lane: 'CODING',
        description: '仿 Coze 员工栏+群聊 + Marvis 等距办公室视角',
        acceptance: 'Electron 启动、等距办公室可见、4角色坐工位、浮窗聊天可用',
      },
    ],
  },
];
