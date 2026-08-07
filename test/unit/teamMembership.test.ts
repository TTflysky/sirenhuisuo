import { describe, expect, it } from 'vitest';
import {
  isProjectRosterRematchRequest,
  projectBelongsToConversation,
  resolveLatestRejectedProject,
  resolveTargetProject,
} from '../../src/engine/teamMembership';
import type { Project } from '../../src/types';

const project = (id: string, conversationId: string | undefined, status: Project['status'] = 'awaiting_approval'): Project => ({
  id,
  title: id,
  request: id,
  conversationId,
  members: [],
  status,
  rosterRevision: 1,
  createdAt: 1,
  updatedAt: id === 'current' ? 10 : 20,
});

describe('project conversation isolation', () => {
  it('does not mistake a complete new software project for a roster correction', () => {
    expect(isProjectRosterRematchRequest('请建立一个全新的手机生图 APP 测试项目。必须包含项目管理、系统架构、UI 设计、前端、后端和 QA。缺少真实生图 API 密钥时，用 Mock 链路完成可离线验收。')).toBe(false);
  });

  it('keeps explicit roster corrections on the existing project path', () => {
    expect(isProjectRosterRematchRequest('人员不对，重新看一下我的需求然后从员工里面挑选。')).toBe(true);
    expect(isProjectRosterRematchRequest('连个框架设计都没有吗，谁写代码、谁负责 UI、谁审核？重新选人。')).toBe(true);
  });

  it('keeps approval cards in their owning assistant conversation', () => {
    expect(projectBelongsToConversation(project('current', 'conversation-assistant-new'), 'conversation-assistant-new')).toBe(true);
    expect(projectBelongsToConversation(project('other', 'conversation-assistant-old'), 'conversation-assistant-new')).toBe(false);
  });

  it('shows unscoped historical projects only in the legacy assistant conversation', () => {
    expect(projectBelongsToConversation(project('legacy', undefined), 'conversation-legacy-assistant')).toBe(true);
    expect(projectBelongsToConversation(project('legacy', undefined), 'conversation-assistant-new')).toBe(false);
  });

  it('does not resolve active or rejected projects from another conversation', () => {
    const projects = [
      project('other', 'conversation-assistant-old'),
      project('current', 'conversation-assistant-new'),
      { ...project('rejected-other', 'conversation-assistant-old', 'archived'), rejectionReason: 'no' },
      { ...project('rejected-current', 'conversation-assistant-new', 'archived'), rejectionReason: 'revise' },
    ];
    expect(resolveTargetProject('继续', projects, 'conversation-assistant-new')?.id).toBe('current');
    expect(resolveLatestRejectedProject(projects, 'conversation-assistant-new')?.id).toBe('rejected-current');
  });

  it('does not silently attach an unspecified request to one of several current projects', () => {
    const projects = [
      project('calculator', 'conversation-assistant-new', 'running'),
      project('novel-tool', 'conversation-assistant-new', 'awaiting_approval'),
    ];
    expect(resolveTargetProject('\u5e2e\u6211\u505a\u4e2a\u65b0\u7684\u4e2a\u4eba\u53d1\u5e03\u5e73\u53f0\u5ba2\u6237\u7aef', projects, 'conversation-assistant-new')).toBeUndefined();
    expect(resolveTargetProject('\u7ee7\u7eed\u8fd9\u4e2a\u9879\u76ee', projects, 'conversation-assistant-new')).toBeUndefined();
    expect(resolveTargetProject('\u7ee7\u7eed calculator', projects, 'conversation-assistant-new')?.id).toBe('calculator');
  });
});
