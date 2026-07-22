import type { Employee, OpcRoleId } from '../types';
import { ROLE_SCARF } from '../types';

// ===== 4 个 OPC 种子员工（Marvis 风黑色剪影，围巾色区分角色）=====
export const seedEmployees: Employee[] = [
  {
    id: 'emp-pm',
    name: '铁柱',
    title: '协调者',
    role: 'pm' as OpcRoleId,
    avatar: 'a01',       // 红围巾
    avatarKind: 'preset',
    statusColor: ROLE_SCARF.pm,
    stationIndex: 0,
    isOnline: true,
    isWorking: false,
  },
  {
    id: 'emp-planner',
    name: '规划者',
    title: '架构师',
    role: 'planner' as OpcRoleId,
    avatar: 'a02',      // 青围巾
    avatarKind: 'preset',
    statusColor: ROLE_SCARF.planner,
    stationIndex: 1,
    isOnline: true,
    isWorking: false,
  },
  {
    id: 'emp-coder',
    name: '编码者',
    title: '实现工程师',
    role: 'coder' as OpcRoleId,
    avatar: 'a03',     // 绿围巾
    avatarKind: 'preset',
    statusColor: ROLE_SCARF.coder,
    stationIndex: 2,
    isOnline: true,
    isWorking: false,
  },
  {
    id: 'emp-checker',
    name: '审查者',
    title: 'QA 工程师',
    role: 'checker' as OpcRoleId,
    avatar: 'a04',    // 紫围巾
    avatarKind: 'preset',
    statusColor: ROLE_SCARF.checker,
    stationIndex: 3,
    isOnline: true,
    isWorking: false,
  },
];

// ===== 真人（用户）=====
export const humanEmployee: Employee = {
  id: 'emp-me',
  name: '老汤',
  title: '老板',
  role: 'custom' as OpcRoleId,
  avatar: 'a05',
  avatarKind: 'preset',
  statusColor: '#f59e0b', // 金色
  stationIndex: -1, // 不坐工位
  isOnline: true,
  isWorking: false,
};
