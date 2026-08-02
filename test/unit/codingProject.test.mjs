import { describe, expect, it } from 'vitest';
import { compileCodingProject } from '../../src/engine/codingProject.mjs';

const approvedTeam = [
  { id: 'qa', name: '审查者', title: 'QA 工程师', role: 'checker' },
  { id: 'pm', name: '实验追踪员', title: '项目管理部', role: 'pm', capabilities: ['ui_ux', 'research', 'coordination'] },
  { id: 'architect', name: '多智能体系统架构师', title: '工程部', role: 'coder', capabilities: ['ui_ux', 'coordination', 'architecture'] },
  { id: 'designer', name: 'UI 设计师', title: '设计部', role: 'planner', capabilities: ['ui_ux'] },
  { id: 'frontend', name: '前端开发者', title: '工程部', role: 'coder', capabilities: ['ui_ux', 'frontend', 'coding'] },
  { id: 'backend', name: '后端架构师', title: '工程部', role: 'coder', capabilities: ['ui_ux', 'backend', 'research', 'coding'] },
];

describe('coding project ownership', () => {
  it('does not let broad migrated labels take product or UI ownership from specialists', () => {
    const project = compileCodingProject({
      goal: '开发一个支持上传照片、文生图和图生图的手机 APP 客户端，包含 API 配置界面并完成运行验证',
      members: approvedTeam,
    });
    expect(project.status).toBe('ready');
    expect(Object.fromEntries(project.stages.map((stage) => [stage.id, stage.ownerEmployeeId]))).toEqual({
      'product-brief': 'pm',
      architecture: 'architect',
      'ux-ui': 'designer',
      frontend: 'frontend',
      backend: 'backend',
      verification: 'qa',
      review: 'qa',
      delivery: 'pm',
    });
  });
});
