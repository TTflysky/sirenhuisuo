import { Button, Tag } from 'antd';
import { CheckOutlined, CloseOutlined, TeamOutlined } from '@ant-design/icons';
import type { Employee, Project } from '../../types';
import AgentAvatar from '../office/AgentAvatar';
import { employeePlanningPool } from '../../data/expertCatalog';

interface Props {
  project: Project;
  employees: Employee[];
  onApprove: () => void;
  onReject: () => void;
}

export default function ProjectApprovalCard({ project, employees, onApprove, onReject }: Props) {
  const planningEmployees = employeePlanningPool(employees);
  const members = project.members
    .map((member) => ({ ...member, employee: planningEmployees.find((employee) => employee.id === member.employeeId) }))
    .filter((member): member is typeof member & { employee: Employee } => !!member.employee);

  return (
    <section className="project-approval-card" aria-label="团队方案授权">
      <div className="project-approval-head">
        <div className="project-approval-icon"><TeamOutlined /></div>
        <div>
          <div className="project-approval-kicker">需要你的授权</div>
          <h3>{project.title}</h3>
        </div>
        <Tag color="gold">待批准</Tag>
      </div>
      <p className="project-approval-request">{project.request}</p>
      {project.brief && <div className="project-approval-section">
        <strong>项目策划</strong>
        <p className="project-approval-request">{project.brief.summary}</p>
        <ol className="project-approval-steps">{project.brief.stages.map((stage) => <li key={stage.id}><b>{stage.title}</b>：{stage.objective}</li>)}</ol>
        {project.brief.openQuestions.length > 0 && <div className="project-approval-output">待确认：{project.brief.openQuestions.join('、')}</div>}
      </div>}
      <div className="project-approval-section">
        <strong>推荐成员 · {members.length} 人</strong>
        <div className="project-approval-members">
          {members.map(({ employee, reason }) => (
            <div className="project-approval-member" key={employee.id} title={reason}>
              <AgentAvatar employee={employee} size={34} />
              <span>{employee.name}</span>
            </div>
          ))}
          {members.length === 0 && <span className="project-approval-muted">暂未匹配到成员</span>}
        </div>
      </div>
      {project.steps.length > 0 && (
        <div className="project-approval-section">
          <strong>执行顺序</strong>
          <ol className="project-approval-steps">{project.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
        </div>
      )}
      {project.expectedOutputs.length > 0 && <div className="project-approval-output">预期产出：{project.expectedOutputs.join('、')}</div>}
      <div className="project-approval-actions">
        <Button type="primary" icon={<CheckOutlined />} disabled={members.length === 0} onClick={onApprove}>批准并组建团队</Button>
        <Button danger icon={<CloseOutlined />} onClick={onReject}>驳回</Button>
      </div>
    </section>
  );
}
