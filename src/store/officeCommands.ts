import type { AppState, AvatarFrameConfig, Employee, OpcRoleId, Project, ProjectMember, Team } from '../types';
import { ROLE_SCARF } from '../types';
import { findFreeStation } from '../data/officeStations';
import { expertToEmployee, findExpertCatalogEntry, employeePlanningPool } from '../data/expertCatalog';
import { matchProjectMembers } from '../engine/taskMatcher';
import { buildProfessionalProjectBrief } from '../engine/expertOrchestration';
import { prepareProjectExecution } from '../engine/teamControl';
import { syncNativeTaskRoster } from '../data/taskExecutionBridge';
import * as client from '../data/hermesClient';
import type { AppStateAction } from './appStateReducer';

interface OfficeCommandDependencies {
  getState: () => AppState;
  dispatch: (action: AppStateAction) => void;
  startTaskRun: (...args: any[]) => Promise<void>;
}

export function createOfficeCommands({ getState, dispatch, startTaskRun }: OfficeCommandDependencies) {
  const addEmployee = (
    name: string,
    title: string,
    role: OpcRoleId,
    avatar: string,
    avatarKind: 'preset' | 'custom',
    statusColor?: string,
    prompt?: string,
    avatarFrame?: AvatarFrameConfig
  ) => {
    const newEmp: Employee = {
      id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      title,
      role,
      avatar,
      avatarKind,
      statusColor: statusColor ?? (ROLE_SCARF[role] ?? '#64748b'),
      stationIndex: findFreeStation(getState().employees),
      prompt,
      avatarFrame,
      isOnline: true,
      isWorking: false,
    };
    console.log('[addEmployee] 新员工:', newEmp, '当前员工数:', getState().employees.length);
    dispatch({ type: 'ADD_EMPLOYEE', emp: newEmp });
  };

  const addCatalogExperts = (expertIds: string[]): Employee[] => {
    const current = getState();
    const existing = new Map(current.employees.map((employee) => [employee.id, employee]));
    const added: Employee[] = [];
    for (const expertId of [...new Set(expertIds)]) {
      const present = existing.get(expertId);
      if (present) {
        added.push(present);
        continue;
      }
      const expert = findExpertCatalogEntry(expertId);
      if (!expert) continue;
      const employee = expertToEmployee(expert, current.employees.length + added.length);
      existing.set(employee.id, employee);
      added.push(employee);
      dispatch({ type: 'ADD_EMPLOYEE', emp: employee });
    }
    return added;
  };

  const createTeam = (name: string, icon: string, memberIds: string[], description = '') => {
    const now = Date.now();
    const team: Team = {
      id: `team-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      icon,
      memberIds,
      description: description.trim(),
      createdAt: now,
      updatedAt: now,
      chatMessages: [
        {
          id: `msg-welcome-${Date.now()}`,
          authorId: 'emp-me',
          roleId: 'human',
          content: `🎉 团队「${name}」已创建！共 ${memberIds.length} 名成员。`,
          mentions: [],
          timestamp: Date.now(),
          kind: 'text',
        },
      ],
      tasks: [],
    };
    dispatch({ type: 'ADD_TEAM', team });

    // 更新成员的 currentTeamId
    for (const mid of memberIds) {
      dispatch({ type: 'UPDATE_EMPLOYEE', id: mid, partial: { currentTeamId: team.id } });
    }
  };

  const addTeamMembers = (teamId: string, memberIds: string[]): Employee[] => {
    const current = getState();
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return [];
    const existingIds = new Set(team.memberIds);
    const knownEmployees = new Map(current.employees.map((employee) => [employee.id, employee]));
    const added = [...new Set(memberIds)].map((id, index) => {
      const present = knownEmployees.get(id);
      if (present) return present;
      const expert = findExpertCatalogEntry(id);
      return expert ? expertToEmployee(expert, current.employees.length + index) : undefined;
    }).filter((employee): employee is Employee => !!employee && !existingIds.has(employee.id));
    if (!added.length) return [];

    for (const employee of added) {
      if (!knownEmployees.has(employee.id)) dispatch({ type: 'ADD_EMPLOYEE', emp: employee });
    }

    const nextMemberIds = [...new Set([...team.memberIds, ...added.map((employee) => employee.id)])];
    dispatch({ type: 'UPDATE_TEAM', id: teamId, partial: { memberIds: nextMemberIds } });
    added.forEach((employee) => dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { currentTeamId: teamId } }));
    if (team.projectId) {
      const project = current.projects.find((item) => item.id === team.projectId);
      if (project) {
        const knownProjectMembers = new Set(project.members.map((member) => member.employeeId));
        dispatch({ type: 'UPDATE_PROJECT', id: project.id, partial: {
          members: [...project.members, ...added.filter((employee) => !knownProjectMembers.has(employee.id)).map((employee) => ({ employeeId: employee.id, reason: '按老板最新要求加入项目团队' }))],
          rosterRevision: (project.rosterRevision ?? 1) + 1,
        } });
      }
    }
    const roster = new Map([...current.employees, ...added].map((employee) => [employee.id, employee]));
    const activeRuns = current.taskRuns.filter((run) => run.teamId === teamId && ['queued', 'running', 'paused'].includes(run.status));
    for (const run of activeRuns) {
      const members = nextMemberIds.map((id) => roster.get(id)).filter((employee): employee is Employee => !!employee)
        .map((employee) => ({ ...employee, modelConfig: client.getEmployeeModel(employee) }));
      void syncNativeTaskRoster(run.id, members, `老板在任务执行中新增成员：${added.map((employee) => employee.name).join('、')}`);
    }
    dispatch({
      type: 'APPEND_CHAT',
      teamId,
      msgs: [{
        id: `msg-members-added-${Date.now()}`,
        authorId: 'assistant',
        roleId: 'custom',
        content: `已将 ${added.map((employee) => employee.name).join('、')} 加入「${team.name}」。成员列表已同步，后续可以直接 @姓名 分配工作。`,
        mentions: added.map((employee) => employee.id),
        timestamp: Date.now(),
        kind: 'text',
      }],
    });
    return added;
  };

  const setTeamMembers = (teamId: string, memberIds: string[]): { added: Employee[]; removed: Employee[] } => {
    const current = getState();
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return { added: [], removed: [] };
    const directory = new Map(current.employees.map((employee) => [employee.id, employee]));
    const added: Employee[] = [];
    const nextMemberIds = [...new Set(memberIds)].filter((employeeId) => {
      if (directory.has(employeeId)) return true;
      const expert = findExpertCatalogEntry(employeeId);
      if (!expert) return false;
      const employee = expertToEmployee(expert, current.employees.length + added.length);
      directory.set(employeeId, employee);
      added.push(employee);
      return true;
    });
    const previousIds = new Set(team.memberIds);
    const nextIds = new Set(nextMemberIds);
    const removed = team.memberIds
      .filter((employeeId) => !nextIds.has(employeeId))
      .map((employeeId) => directory.get(employeeId))
      .filter((employee): employee is Employee => !!employee);
    const newlyAssigned = nextMemberIds
      .filter((employeeId) => !previousIds.has(employeeId))
      .map((employeeId) => directory.get(employeeId))
      .filter((employee): employee is Employee => !!employee);
    if (!added.length && !removed.length && newlyAssigned.length === 0) return { added: [], removed: [] };
    added.forEach((employee) => dispatch({ type: 'ADD_EMPLOYEE', emp: employee }));
    dispatch({ type: 'UPDATE_TEAM', id: teamId, partial: { memberIds: nextMemberIds } });
    newlyAssigned.forEach((employee) => dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { currentTeamId: teamId } }));
    removed.forEach((employee) => {
      if (employee.currentTeamId === teamId) dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { currentTeamId: undefined, isWorking: false, currentTask: undefined } });
    });
    if (team.projectId) {
      const project = current.projects.find((item) => item.id === team.projectId);
      if (project) {
        const previousProjectMembers = new Map(project.members.map((member) => [member.employeeId, member]));
        dispatch({ type: 'UPDATE_PROJECT', id: project.id, partial: {
          members: nextMemberIds.map((employeeId) => previousProjectMembers.get(employeeId) ?? { employeeId, reason: '按老板最新要求调整项目团队' }),
          rosterRevision: (project.rosterRevision ?? 1) + 1,
        } });
      }
    }
    const roster = nextMemberIds.map((employeeId) => directory.get(employeeId)).filter((employee): employee is Employee => !!employee)
      .map((employee) => ({ ...employee, modelConfig: client.getEmployeeModel(employee) }));
    for (const run of current.taskRuns.filter((run) => run.teamId === teamId && ['queued', 'running', 'paused'].includes(run.status))) {
      void syncNativeTaskRoster(run.id, roster, `老板调整了项目团队名单，新加入：${newlyAssigned.map((employee) => employee.name).join('、') || '无'}`);
    }
    return { added: newlyAssigned, removed };
  };

  const removeTeamMembers = (teamId: string, memberIds: string[]): Employee[] => {
    const current = getState();
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return [];
    const removedIds = new Set(memberIds.filter((id) => team.memberIds.includes(id)));
    if (!removedIds.size) return [];
    const removed = team.memberIds
      .filter((id) => removedIds.has(id))
      .map((id) => current.employees.find((employee) => employee.id === id))
      .filter((employee): employee is Employee => !!employee);
    const nextMemberIds = team.memberIds.filter((id) => !removedIds.has(id));
    dispatch({ type: 'UPDATE_TEAM', id: teamId, partial: { memberIds: nextMemberIds } });
    removed.forEach((employee) => {
      if (employee.currentTeamId === teamId) dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { currentTeamId: undefined, isWorking: false, currentTask: undefined } });
    });
    if (team.projectId) {
      const project = current.projects.find((item) => item.id === team.projectId);
      if (project) dispatch({ type: 'UPDATE_PROJECT', id: project.id, partial: {
        members: project.members.filter((member) => !removedIds.has(member.employeeId)),
        rosterRevision: (project.rosterRevision ?? 1) + 1,
      } });
    }
    dispatch({ type: 'APPEND_CHAT', teamId, msgs: [{
      id: `msg-members-removed-${Date.now()}`,
      authorId: 'assistant', roleId: 'custom',
      content: `已将 ${removed.map((employee) => employee.name).join('、')} 从「${team.name}」移出。未开始的任务会按最新名单重新分配；已开始的任务保留原有执行记录。`,
      mentions: removed.map((employee) => employee.id), timestamp: Date.now(), kind: 'text',
    }] });
    return removed;
  };

  const setProjectMembers = (projectId: string, memberIds: string[]): ProjectMember[] => {
    const current = getState();
    const project = current.projects.find((item) => item.id === projectId);
    const rejectedDraft = project?.status === 'archived' && Boolean(project.rejectionReason);
    if (!project || (project.status !== 'awaiting_approval' && !rejectedDraft)) return [];
    const employees = employeePlanningPool(client.fetchInitial().employees);
    const selectionRequest = [project.request, ...(project.requiredCapabilities ?? [])].filter(Boolean).join('\n所需能力：');
    const recommended = new Map(matchProjectMembers(employees, selectionRequest).map((member) => [member.employeeId, member.reason]));
    const members = [...new Set(memberIds)]
      .filter((employeeId) => employees.some((employee) => employee.id === employeeId))
      .map((employeeId) => ({ employeeId, reason: recommended.get(employeeId) ?? '按老板最新的成员调整加入' }));
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: {
      members,
      status: 'awaiting_approval',
      rejectionReason: undefined,
      rosterRevision: (project.rosterRevision ?? 1) + 1,
    } });
    return members;
  };

  const createProjectDraft = (input: { title: string; request: string; conversationId?: string; steps?: string[]; expectedOutputs?: string[]; requiredCapabilities?: string[]; decisionReason?: string }) => {
    const now = Date.now();
    const latestEmployees = employeePlanningPool(client.fetchInitial().employees);
    const selectionRequest = [input.request, ...(input.requiredCapabilities ?? [])].filter(Boolean).join('\n所需能力：');
    const members = matchProjectMembers(latestEmployees, selectionRequest);
    const project: Project = {
      id: `project-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: input.title.trim() || '未命名项目',
      request: input.request.trim(),
      conversationId: input.conversationId,
      steps: input.steps?.filter(Boolean) ?? [],
      expectedOutputs: input.expectedOutputs?.filter(Boolean) ?? [],
      members,
      brief: buildProfessionalProjectBrief({ request: input.request, members }),
      requiredCapabilities: input.requiredCapabilities?.filter(Boolean),
      decisionReason: input.decisionReason?.trim(),
      status: 'awaiting_approval', rosterRevision: 1, createdAt: now, updatedAt: now,
    };
    dispatch({ type: 'CREATE_PROJECT', project });
  };

  const approveProject = (projectId: string, override?: { memberIds?: string[]; requiredCapabilities?: string[]; decisionReason?: string }): ProjectMember[] => {
    const project = getState().projects.find((item) => item.id === projectId);
    const rejectedDraft = project?.status === 'archived' && Boolean(project.rejectionReason) && Boolean(override?.memberIds?.length);
    if (!project || (project.status !== 'awaiting_approval' && !rejectedDraft)) return [];
    const memberDirectory = new Map(getState().employees.map((employee) => [employee.id, employee]));
    const planningEmployees = employeePlanningPool(client.fetchInitial().employees);
    const recommended = new Map(matchProjectMembers(
      planningEmployees,
      [project.request, ...(override?.requiredCapabilities ?? project.requiredCapabilities ?? [])].filter(Boolean).join('\n所需能力：'),
    ).map((member) => [member.employeeId, member.reason]));
    const effectiveMembers = override?.memberIds?.length
      ? [...new Set(override.memberIds)]
        .filter((employeeId) => planningEmployees.some((employee) => employee.id === employeeId))
        .map((employeeId) => ({ employeeId, reason: recommended.get(employeeId) ?? '按当前对话中确认的方案加入' }))
      : project.members;
    const memberIds = effectiveMembers.map((member) => member.employeeId);
    if (!memberIds.length) return [];
    for (const employee of addCatalogExperts(memberIds)) memberDirectory.set(employee.id, employee);
    const team: Team = {
      id: `team-project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: project.title,
      description: project.request.slice(0, 240),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      icon: '📌', memberIds, projectId,
      chatMessages: [{ id: `msg-project-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
        content: `团队已建立。成员名单已按批准方案固定：${memberIds.map((id) => `@${memberDirectory.get(id)?.name ?? id}`).join('、')}。\n\n现在还不会开工。请先一次性确认：\n1. 要解决的核心问题和第一版边界；\n2. 使用哪些资料或知识来源、部署到哪里；\n3. 必须具备的检索/权限/连接能力；\n4. 界面风格与最优先的使用场景。\n\n你回复后，点击“确认方向并开始执行”，团队才会生成分阶段计划。`, mentions: memberIds, timestamp: Date.now(), kind: 'text' }],
      tasks: [],
    };
    dispatch({ type: 'ADD_TEAM', team });
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: {
      status: 'clarifying',
      teamId: team.id,
      members: effectiveMembers,
      requiredCapabilities: override?.requiredCapabilities?.filter(Boolean) ?? project.requiredCapabilities,
      decisionReason: override?.decisionReason?.trim() || project.decisionReason,
      rejectionReason: undefined,
    } });
    memberIds.forEach((id) => dispatch({ type: 'UPDATE_EMPLOYEE', id, partial: { currentTeamId: team.id } }));
    return effectiveMembers;
  };

  const startProjectExecution = (projectId: string, clarificationResponse: string) => {
    const prepared = prepareProjectExecution(getState(), projectId, clarificationResponse);
    if (!prepared) return;
    dispatch({ type: 'UPDATE_PROJECT', id: prepared.project.id, partial: { status: 'running', clarificationResponse: prepared.clarificationResponse, brief: prepared.brief } });
    dispatch({ type: 'APPEND_CHAT', teamId: prepared.team.id, msgs: [{
      id: `msg-project-start-${Date.now()}`,
      authorId: 'assistant', roleId: 'custom',
      content: '方向已确认，团队现在开始执行。会按“需求/架构 -> 设计/数据 -> 实现 -> 审查”的依赖顺序推进；没有轮到的成员会显示为等待前置步骤，不会假装同时开工。',
      mentions: prepared.memberIds, timestamp: Date.now(), kind: 'text',
    }] });
    setTimeout(() => { void startTaskRun(prepared.team.id, prepared.effectiveRequest, prepared.memberIds, undefined, undefined, [], undefined, undefined, prepared.brief); }, 0);
  };

  const archiveProject = (projectId: string) => {
    const project = getState().projects.find((item) => item.id === projectId);
    if (!project) return;
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: { status: 'archived' } });
    if (project.teamId) dispatch({ type: 'UPDATE_TEAM', id: project.teamId, partial: { archived: true } });
  };

  const rejectProject = (projectId: string, reason = '用户驳回团队方案') => {
    const project = getState().projects.find((item) => item.id === projectId);
    if (!project || project.status !== 'awaiting_approval') return;
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: { status: 'archived', rejectionReason: reason } });
  };


  return {
    addEmployee,
    addCatalogExperts,
    createTeam,
    addTeamMembers,
    setTeamMembers,
    removeTeamMembers,
    setProjectMembers,
    createProjectDraft,
    approveProject,
    startProjectExecution,
    archiveProject,
    rejectProject,
  };
}
