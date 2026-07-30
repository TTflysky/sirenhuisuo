import { chatCompletion, getDiagnosticModel, getExecutionPolicy, loadSettings, saveExecutionPolicy } from '../data/hermesClient';
import { listSkills, repairSkill } from '../data/skills';
import { runSystemDiagnostics, type DiagnosticArea, type SystemDiagnosticReport } from './systemDiagnostics';

export type DiagnosticOptimizationStatus = 'fixed' | 'needs_user' | 'failed' | 'unchanged';

export interface DiagnosticOptimizationAction {
  area: DiagnosticArea;
  title: string;
  status: DiagnosticOptimizationStatus;
  detail: string;
}

export interface DiagnosticOptimizationResult {
  modelLabel: string;
  summary: string;
  actions: DiagnosticOptimizationAction[];
  report: SystemDiagnosticReport;
}

interface ModelOptimizationPlan {
  summary?: string;
  autoFixAreas?: DiagnosticArea[];
}

function parsePlan(content: string | null): ModelOptimizationPlan {
  const source = String(content ?? '').replace(/^```(?:json)?\s*/iu, '').replace(/```\s*$/u, '').trim();
  const json = source.match(/\{[\s\S]*\}/u)?.[0];
  if (!json) throw new Error('诊断模型没有返回结构化优化方案');
  const parsed = JSON.parse(json) as ModelOptimizationPlan;
  const allowed = new Set<DiagnosticArea>(['skill', 'permission']);
  return {
    summary: String(parsed.summary ?? '').trim().slice(0, 800),
    autoFixAreas: Array.isArray(parsed.autoFixAreas) ? parsed.autoFixAreas.filter((area) => allowed.has(area)) : [],
  };
}

async function requestModelPlan(report: SystemDiagnosticReport): Promise<{ plan: ModelOptimizationPlan; modelLabel: string }> {
  const settings = loadSettings();
  const modelEntry = settings.modelLibrary?.find((entry) => entry.id === settings.diagnosticModelId);
  const model = getDiagnosticModel();
  if (!modelEntry || !model) throw new Error('还没有指定诊断优化模型，请先在本页选择一个模型');
  const material = report.items.map((item) => ({
    area: item.area,
    status: item.status,
    title: item.title,
    summary: item.summary,
    detail: item.detail,
    suggestedAction: item.action,
  }));
  const response = await chatCompletion([
    {
      role: 'system',
      content: [
        '你是太极诊断优化模型。根据结构化诊断报告选择最小、可验证、可逆的处理动作。',
        '只输出 JSON：{"summary":"面向普通用户的总体判断","autoFixAreas":["skill","permission"]}。',
        'autoFixAreas 只允许 skill 和 permission。skill 表示修复已有来源且属于用户安装的损坏/缺文件 Skill；permission 表示恢复“沙盒开启、低风险替我审核”的推荐安全策略。',
        '模型、连接器、账号、API Key、外部软件、工作区路径、代码或系统运行时故障都不能猜测或伪造修复，不要把它们放进 autoFixAreas。',
        '不要声称已经修复，真正执行和复检由客户端完成。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({ checkedAt: report.checkedAt, items: material }) },
  ], 'diagnostic-optimizer', '诊断优化模型', undefined, model, undefined, undefined, undefined, {
    toolChoice: 'none',
    timeoutMs: 90000,
    injectUserContext: false,
  });
  return { plan: parsePlan(response.content), modelLabel: `${modelEntry.label} · ${response.model}` };
}

async function repairUnhealthySkills(): Promise<DiagnosticOptimizationAction> {
  const skills = await listSkills();
  const repairable = skills.filter((skill) => skill.scope === 'mine' && (skill.health === 'broken' || skill.health === 'limited'));
  const protectedSkills = skills.filter((skill) => skill.scope !== 'mine' && (skill.health === 'broken' || skill.health === 'limited'));
  if (!repairable.length) {
    return {
      area: 'skill', title: 'Skill 健康', status: protectedSkills.length ? 'needs_user' : 'unchanged',
      detail: protectedSkills.length ? `${protectedSkills.length} 个内置 Skill 需要随客户端更新修复，未覆盖内置文件。` : '没有可自动修复的自装 Skill。',
    };
  }
  const repaired: string[] = [];
  const failed: string[] = [];
  for (const skill of repairable) {
    try { await repairSkill(skill.id); repaired.push(skill.name); }
    catch (error) { failed.push(`${skill.name}：${error instanceof Error ? error.message : String(error)}`); }
  }
  return {
    area: 'skill', title: 'Skill 健康', status: failed.length ? 'failed' : 'fixed',
    detail: `${repaired.length ? `已修复 ${repaired.join('、')}` : '没有完成修复'}${failed.length ? `；失败：${failed.join('；')}` : ''}`,
  };
}

function optimizePermissionPolicy(): DiagnosticOptimizationAction {
  const before = getExecutionPolicy();
  if (before.sandboxEnabled && before.approvalMode === 'delegate' && before.connectorApprovalMode === 'delegate') {
    return { area: 'permission', title: '安全与审批', status: 'unchanged', detail: '当前已经是推荐的日常安全策略。' };
  }
  saveExecutionPolicy({ sandboxEnabled: true, approvalMode: 'delegate', connectorApprovalMode: 'delegate' });
  return { area: 'permission', title: '安全与审批', status: 'fixed', detail: '已开启工作区沙盒，并将命令和连接器设为“替我审核”；高风险操作仍会向你确认。' };
}

export async function optimizeSystemDiagnostics(initialReport?: SystemDiagnosticReport): Promise<DiagnosticOptimizationResult> {
  const before = initialReport ?? await runSystemDiagnostics();
  const { plan, modelLabel } = await requestModelPlan(before);
  const requested = new Set(plan.autoFixAreas ?? []);
  const actions: DiagnosticOptimizationAction[] = [];
  if (requested.has('skill')) actions.push(await repairUnhealthySkills());
  if (requested.has('permission')) actions.push(optimizePermissionPolicy());
  const report = await runSystemDiagnostics();
  const handled = new Set(actions.map((action) => action.area));
  for (const item of report.items.filter((item) => item.status !== 'ready' && !handled.has(item.area))) {
    actions.push({ area: item.area, title: item.title, status: 'needs_user', detail: `${item.summary}。${item.action}` });
  }
  if (!actions.length) actions.push({ area: 'runtime', title: '系统状态', status: 'unchanged', detail: '复检后没有需要处理的项目。' });
  return {
    modelLabel,
    summary: plan.summary || `模型完成了诊断决策，复检结果为 ${report.ready} 项可用、${report.warning} 项提醒、${report.blocked} 项缺失。`,
    actions,
    report,
  };
}

