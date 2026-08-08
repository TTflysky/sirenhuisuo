import type { Employee, Project } from '../types';
import { conversationProjectId, projectDocumentPath, projectWorkspaceId } from '../utils/projectContext';
import { buildProfessionalProjectBrief } from './expertOrchestration';
import { matchProjectMembers } from './taskMatcher';

export interface ProjectDraftInput {
  title: string;
  request: string;
  conversationId?: string;
  steps?: string[];
  expectedOutputs?: string[];
  requiredCapabilities?: string[];
  decisionReason?: string;
  deliverables?: Project['deliverables'];
  acceptanceCriteria?: string[];
  constraints?: string[];
}

export function buildProjectDraft(input: ProjectDraftInput, employees: Employee[], now = Date.now()): Project {
  const requiredCapabilities = [...new Set([
    ...(input.requiredCapabilities ?? []),
    ...(input.deliverables ?? []).filter((deliverable) => deliverable.required !== false).flatMap((deliverable) => deliverable.requiredCapabilities ?? []),
  ].filter(Boolean))];
  const members = matchProjectMembers(employees, [input.request, ...requiredCapabilities].filter(Boolean).join('\n所需能力：'));
  const proposalId = `proposal-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const id = `project-${now}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id, title: input.title.trim() || '未命名项目', request: input.request.trim(), conversationId: input.conversationId,
    steps: input.steps?.filter(Boolean) ?? [], expectedOutputs: input.expectedOutputs?.filter(Boolean) ?? [],
    deliverables: input.deliverables, acceptanceCriteria: input.acceptanceCriteria?.filter(Boolean), constraints: input.constraints?.filter(Boolean), members,
    brief: buildProfessionalProjectBrief({ request: input.request, members, deliverables: input.deliverables, expectedOutputs: input.expectedOutputs, acceptanceCriteria: input.acceptanceCriteria, requiredCapabilities }),
    requiredCapabilities, decisionReason: input.decisionReason?.trim(), proposalId, proposalRevision: 1, proposalStatus: 'pending',
    proposalHistory: [{ id: proposalId, revision: 1, status: 'pending', members, reason: '初始需求生成团队提案', createdAt: now }],
    conversationProjectId: input.conversationId ? conversationProjectId(input.conversationId) : undefined,
    status: 'awaiting_approval', rosterRevision: 1, createdAt: now, updatedAt: now,
    workspaceId: projectWorkspaceId(id), documentPath: projectDocumentPath(id),
  };
}
