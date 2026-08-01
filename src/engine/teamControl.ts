import * as client from '../data/hermesClient';
import type { AppState, Employee } from '../types';
import { buildProfessionalProjectBrief } from './expertOrchestration';

export function isTeamControlRequest(text: string): boolean {
  const pause = /(?:暂停|停止|先停|停下|别做|不要继续).{0,12}(?:工作|任务|手上|当前|执行)|(?:工作|任务).{0,8}(?:暂停|停止)/u.test(text);
  const report = /(?:汇报|报告|报一下|说一下|告诉我).{0,12}(?:模型|配置|状态)|(?:模型|配置|状态).{0,12}(?:汇报|报告|报一下|说一下)|(?:你们|大家|各位|自己).{0,8}(?:用的|使用).{0,8}(?:什么|哪个).{0,4}模型/u.test(text);
  return pause || report || /报数|报个数|数数|在线情况/u.test(text);
}

export function employeeModelSummary(employee: Employee): string {
  const config = client.getEmployeeModel(employee);
  const source = client.usesCustomEmployeeModel(employee) ? '员工独立配置' : '继承全局默认';
  let host = config.apiHost?.trim() || '未配置';
  try { host = new URL(host).host; } catch {}
  return `${config.model || '未配置模型'}（${source}），服务商：${config.provider || '自定义'}，接口：${host}`;
}

export function prepareProjectExecution(state: AppState, projectId: string, clarificationResponse: string) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project || project.status !== 'clarifying' || !project.teamId || !clarificationResponse.trim()) return undefined;
  const team = state.teams.find((item) => item.id === project.teamId);
  if (!team) return undefined;
  const memberIds = project.members.map((member) => member.employeeId).filter((id) => team.memberIds.includes(id));
  if (!memberIds.length) return undefined;
  const effectiveRequest = `${project.request}\n\n老板确认的方向与风格：\n${clarificationResponse.trim()}`;
  return {
    project,
    team,
    memberIds,
    effectiveRequest,
    clarificationResponse: clarificationResponse.trim(),
    brief: buildProfessionalProjectBrief({ request: effectiveRequest, members: project.members }),
  };
}
