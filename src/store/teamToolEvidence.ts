import type { Employee, SkillUsageEvidence, TaskRun } from '../types';
import type { AppStateAction } from './appStateReducer';
import type { ConnectorProtocolResult } from '../engine/connectorProtocol.mjs';
import { isToolResultSuccessful } from '../data/assistantPresentation';
import { appendTaskRunContext } from '../data/taskRuns';
import type { ToolExecutionEvidence } from '../engine/executionEvidence.mjs';

interface TeamToolEvidenceInput {
  dispatch: (action: AppStateAction) => void;
  updateRun: (mutate: (run: TaskRun) => void) => void;
  employee: Employee;
  toolName: string;
  toolArgs: string;
  result: string;
  stepId?: string;
  success?: boolean;
  protocolEvidence?: ConnectorProtocolResult;
  structuredEvidence?: ToolExecutionEvidence;
}

/** Persist tool output as structured evidence; chat only gets a later step summary. */
export function recordTeamToolEvidence({
  dispatch,
  updateRun,
  employee,
  toolName,
  toolArgs,
  result,
  stepId,
  success,
  protocolEvidence,
  structuredEvidence,
}: TeamToolEvidenceInput) {
  const runtimeInvocations: Array<{ skillId: string; taskId: string; ok: boolean; evidence: string }> = [];
  dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { isWorking: true, currentTask: `正在调用 ${toolName}` } });
  updateRun((run) => {
    const step = run.steps.find((item) => item.id === stepId) ?? run.steps.find((item) => item.employeeId === employee.id && item.status === 'running');
    if (!step) return;
    step.events.push({ ts: Date.now(), type: 'tool', detail: `${toolName} ${toolArgs}${result && result !== '🔄 执行中…' ? ` → ${result}` : ''}`.slice(0, 360) });
    if (!result || result === '🔄 执行中…') return;
    const artifact = toolName === 'write_file' ? structuredEvidence?.artifacts?.[0] : undefined;
    const review = structuredEvidence?.review;
    const verified = artifact ? artifact.verified : review ? review.decision === 'pass' : protocolEvidence
      ? protocolEvidence.ok && protocolEvidence.stage === 'completed'
      : isToolResultSuccessful(result, success);
    const kind = artifact ? 'file' as const
      : review ? 'review' as const
      : toolName === 'write_file' ? 'file' as const
      : toolName === 'run_command' ? 'run' as const
        : /connector|obsidian|knowledge/iu.test(toolName) ? 'connection' as const : 'progress' as const;
    const evidenceSummary = artifact
      ? `${artifact.filename} · ${artifact.category} · ${artifact.bytes ?? 0} 字节 · ${artifact.verified ? '已重新验证' : '仅登记'}`
      : review
        ? `${review.decision === 'pass' ? '审查通过' : '审查退回'}：${review.reason}`
      : protocolEvidence
        ? `${protocolEvidence.connectorLabel} · ${protocolEvidence.action}：${protocolEvidence.ok ? '客户端验证通过' : `失败于 ${protocolEvidence.stage}`} · ${protocolEvidence.latencyMs}ms${protocolEvidence.idempotencyHit ? ' · 幂等复用' : ''}`
        : `${toolName}：${result}`.slice(0, 260);
    const evidence = { ts: Date.now(), source: 'tool' as const, kind, summary: evidenceSummary, verified, connectorProtocol: protocolEvidence, artifact, review };
    step.evidence = [...(step.evidence ?? []), evidence].slice(-12);
    run.evidence = [...(run.evidence ?? []), evidence].slice(-40);
    const additionalArtifacts = toolName === 'write_file' ? structuredEvidence?.artifacts?.slice(1) ?? [] : structuredEvidence?.artifacts ?? [];
    for (const additionalArtifact of additionalArtifacts) {
      const additionalEvidence = {
        ts: Date.now(), source: 'tool' as const, kind: 'file' as const,
        summary: `${additionalArtifact.filename} · ${additionalArtifact.category} · ${additionalArtifact.bytes ?? 0} 字节 · ${additionalArtifact.verified ? '已重新验证' : '仅登记'}`,
        verified: additionalArtifact.verified, artifact: additionalArtifact,
      };
      step.evidence = [...(step.evidence ?? []), additionalEvidence].slice(-12);
      run.evidence = [...(run.evidence ?? []), additionalEvidence].slice(-40);
      appendTaskRunContext(run, {
        type: additionalArtifact.verified ? 'progress' : 'error', source: 'tool', stepId,
        summary: additionalEvidence.summary, verified: additionalArtifact.verified,
        data: { artifact: additionalArtifact },
      });
    }
    appendTaskRunContext(run, {
      type: verified ? 'progress' : 'error', source: 'tool', stepId,
      summary: evidenceSummary.slice(0, 420), verified,
      data: artifact ? { artifact }
        : review ? { review }
        : protocolEvidence ? { connectorProtocol: {
          protocolVersion: protocolEvidence.protocolVersion,
          connectorId: protocolEvidence.connectorId,
          connectorLabel: protocolEvidence.connectorLabel,
          action: protocolEvidence.action,
          stage: protocolEvidence.stage,
          ok: protocolEvidence.ok,
          latencyMs: protocolEvidence.latencyMs,
          idempotencyHit: protocolEvidence.idempotencyHit,
          error: protocolEvidence.error,
          events: protocolEvidence.events,
        } } : undefined,
    });
    if (run.recoveryContext) {
      run.recoveryContext.budget.toolAttempts += 1;
      run.recoveryContext.budget.updatedAt = Date.now();
      if (verified) run.recoveryContext.completedEvidence = [...run.recoveryContext.completedEvidence, `${toolName}：${result.slice(0, 220)}`].slice(-20);
    }
    if (/^(search_skills|read_skill|install_skill)$/u.test(toolName)) {
      let skillId = '';
      try { const args = JSON.parse(toolArgs || '{}'); skillId = args.id || args.installedSkillId || ''; } catch {}
      const skillRef = (run.skillRefs ?? []).find((ref) => ref.id === skillId);
      if (!skillId && toolName === 'install_skill') skillId = result.match(/(?:^|\n)ID:\s*([^\n]+)/u)?.[1]?.trim() ?? '';
      const action: SkillUsageEvidence['action'] = toolName === 'search_skills' ? 'searched' : toolName === 'read_skill' ? (verified ? 'read' : 'read-failed') : 'installed';
      run.skillEvidence = [...(run.skillEvidence ?? []), {
        ts: Date.now(), skillId: skillId || skillRef?.id, skillName: skillRef?.name,
        action, toolName, reason: `成员 ${employee.name} 实际调用 ${toolName}`, detail: result.slice(0, 240), verified,
        stage: toolName === 'install_skill' ? 'installation' : toolName === 'search_skills' ? 'discovery' : 'rules', source: 'team',
      }].slice(-60);
    } else if (run.skillRefs?.length) {
      for (const ref of run.skillRefs) {
        const invocationEvidence: SkillUsageEvidence = { ts: Date.now(), skillId: ref.id, skillName: ref.name, action: 'called', toolName, reason: verified ? `成员 ${employee.name} 已按 Skill 规则执行真实工具` : `成员 ${employee.name} 按 Skill 规则执行工具时失败`, detail: result.slice(0, 240), verified, stage: 'invocation', source: 'team' };
        const outputEvidence: SkillUsageEvidence = { ts: Date.now(), skillId: ref.id, skillName: ref.name, action: verified ? 'produced' : 'rejected', toolName, reason: verified ? '工具结果已进入任务证据' : '工具结果没有通过验证', detail: evidenceSummary.slice(0, 240), verified, stage: 'output', source: 'team' };
        run.skillEvidence = [...(run.skillEvidence ?? []), invocationEvidence, outputEvidence].slice(-60);
        runtimeInvocations.push({ skillId: ref.id, taskId: run.id, ok: verified, evidence: `${toolName}：${result.slice(0, 600)}` });
      }
    }
  });
  for (const invocation of runtimeInvocations) void window.electronAPI?.skillsRuntimeInvocation?.(invocation);
}
