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

const EXPLICIT_FILE_PATTERN = /(?:^|[\s，、：:；;（(])([\p{L}\p{N}_-]+\.(?:html?|css|m?js|cjs|tsx?|jsx?|json|md|markdown|txt|csv|ya?ml|xml|svg|png|jpe?g|webp|pdf|docx?|pptx?|xlsx?|py|java|go|rs|vue|svelte))/giu;

function explicitRequestDeliverables(request: string): NonNullable<Project['deliverables']> {
  const found = new Map<string, NonNullable<Project['deliverables']>[number]>();
  for (const match of request.matchAll(EXPLICIT_FILE_PATTERN)) {
    const label = match[1];
    const key = label.toLocaleLowerCase();
    if (found.has(key)) continue;
    const format = label.split('.').at(-1)?.toLocaleLowerCase() || 'file';
    const frontend = ['html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'svg'].includes(format);
    const review = /(?:test|spec|report|测试|验收|报告)/iu.test(label);
    found.set(key, {
      id: `explicit-file-${found.size + 1}`,
      label,
      format,
      type: 'file',
      category: 'final',
      required: true,
      objective: `生成并验证用户明确要求的文件 ${label}。`,
      acceptanceCriteria: [`${label} 必须真实存在、内容非空并可被对应工具回读或运行`],
      requiredCapabilities: review ? ['review'] : frontend ? ['frontend', 'coding'] : [],
      outputPath: label,
      verification: frontend ? ['回读文件内容', '在目标运行环境中打开或执行验证'] : ['回读文件内容并核对用途'],
    });
  }
  if (/测试报告/u.test(request) && ![...found.values()].some((item) => /测试|test|spec/iu.test(item.label))) {
    found.set('测试报告', {
      id: `explicit-file-${found.size + 1}`,
      label: '测试报告',
      type: 'file',
      category: 'final',
      required: true,
      objective: '记录真实运行、功能检查、失败项和最终验收结论。',
      acceptanceCriteria: ['测试报告必须引用真实运行或检查证据，不能只声明通过'],
      requiredCapabilities: ['review'],
      verification: ['回读测试报告并核对其中引用的验证证据'],
    });
  }
  return [...found.values()];
}

function resolvedDeliverables(input: ProjectDraftInput): NonNullable<Project['deliverables']> | undefined {
  const explicit = explicitRequestDeliverables(input.request);
  const declared = (input.deliverables ?? []).filter((item) => item?.label?.trim());
  const usefulDeclared = explicit.length > 0
    ? declared.filter((item) => !/(?:与原始目标一致|可验证结果|最终结果)/u.test(item.label))
    : declared;
  const merged = new Map<string, NonNullable<Project['deliverables']>[number]>();
  for (const item of [...usefulDeclared, ...explicit]) {
    const key = (item.outputPath || item.label).trim().toLocaleLowerCase();
    merged.set(key, { ...merged.get(key), ...item });
  }
  return merged.size ? [...merged.values()] : undefined;
}

export function buildProjectDraft(input: ProjectDraftInput, employees: Employee[], now = Date.now()): Project {
  const deliverables = resolvedDeliverables(input);
  const requiredCapabilities = [...new Set([
    ...(input.requiredCapabilities ?? []),
    ...(deliverables ?? []).filter((deliverable) => deliverable.required !== false).flatMap((deliverable) => deliverable.requiredCapabilities ?? []),
  ].filter(Boolean))];
  const members = matchProjectMembers(employees, [input.request, ...requiredCapabilities].filter(Boolean).join('\n所需能力：'));
  const proposalId = `proposal-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const id = `project-${now}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id, title: input.title.trim() || '未命名项目', request: input.request.trim(), conversationId: input.conversationId,
    steps: input.steps?.filter(Boolean) ?? [], expectedOutputs: [...new Set([...(input.expectedOutputs ?? []).filter(Boolean), ...(deliverables ?? []).map((item) => item.label)])],
    deliverables, acceptanceCriteria: input.acceptanceCriteria?.filter(Boolean), constraints: input.constraints?.filter(Boolean), members,
    brief: buildProfessionalProjectBrief({ request: input.request, members, deliverables, expectedOutputs: input.expectedOutputs, acceptanceCriteria: input.acceptanceCriteria, requiredCapabilities }),
    requiredCapabilities, decisionReason: input.decisionReason?.trim(), proposalId, proposalRevision: 1, proposalStatus: 'pending',
    proposalHistory: [{ id: proposalId, revision: 1, status: 'pending', members, reason: '初始需求生成团队提案', createdAt: now }],
    conversationProjectId: input.conversationId ? conversationProjectId(input.conversationId) : undefined,
    status: 'awaiting_approval', rosterRevision: 1, createdAt: now, updatedAt: now,
    workspaceId: projectWorkspaceId(id), documentPath: projectDocumentPath(id),
  };
}
