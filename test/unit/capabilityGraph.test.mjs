import { describe, expect, it } from 'vitest';
import { inferCapabilityIds, selectCapabilityTeam } from '../../src/engine/capabilityGraph.mjs';

const employees = [
  { id: 'pm', name: '产品协调', title: '产品经理', role: 'pm', stationIndex: 1, isOnline: true },
  { id: 'architect', name: '系统架构', title: '软件架构师', role: 'planner', stationIndex: 2, isOnline: true },
  { id: 'designer', name: '界面体验', title: 'UI/UX 设计师', role: 'custom', stationIndex: 3, isOnline: true },
  { id: 'mobile', name: '移动开发', title: 'Android 移动应用开发工程师', role: 'coder', stationIndex: 4, isOnline: true },
  { id: 'ai', name: '模型接入', title: 'AI 模型接入与连接器工程师', role: 'coder', capabilities: ['backend', 'connector'], stationIndex: 5, isOnline: true },
  { id: 'qa', name: '质量审查', title: 'QA 测试工程师', role: 'checker', stationIndex: 6, isOnline: true },
];

describe('capability graph for a mobile AI product', () => {
  it('infers the complete delivery chain for an Android image-generation app', () => {
    const required = inferCapabilityIds('开发一个安卓端图片生成 APP，需要模型接入、服务接口、完整 UI 和最终验收。');
    expect(required).toEqual(expect.arrayContaining([
      'coordination', 'architecture', 'ui_ux', 'frontend', 'backend', 'coding', 'review', 'connector',
    ]));
  });

  it('selects real mobile, AI, design, architecture, coordination, and QA specialists', () => {
    const result = selectCapabilityTeam(employees, {
      request: '开发一个安卓端图片生成 APP，需要模型接入、服务接口、完整 UI 和最终验收。',
      requiresTeam: true,
      requiresReview: true,
    });
    expect(result.complete).toBe(true);
    expect(result.selected.map((member) => member.employeeId)).toEqual(expect.arrayContaining([
      'pm', 'architect', 'designer', 'mobile', 'ai', 'qa',
    ]));
  });
});
