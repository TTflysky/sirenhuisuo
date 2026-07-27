import { checkConnector, connectorMissingFields, loadConnectors } from '../data/connectors';
import { getActiveModel, getExecutionPolicy, getProvider } from '../data/hermesClient';
import { listSkills } from '../data/skills';
import { diagnoseModel } from './modelDiagnostics';

export type DiagnosticStatus = 'ready' | 'warning' | 'blocked';
export type DiagnosticArea = 'model' | 'connector' | 'skill' | 'workspace' | 'permission';

export interface SystemDiagnosticItem {
  id: string;
  area: DiagnosticArea;
  title: string;
  status: DiagnosticStatus;
  summary: string;
  detail: string;
  action: string;
  settingsTab?: 'model' | 'knowledge' | 'workspace' | 'automation';
}

export interface SystemDiagnosticReport {
  checkedAt: number;
  items: SystemDiagnosticItem[];
  ready: number;
  warning: number;
  blocked: number;
}

async function diagnoseActiveModel(): Promise<SystemDiagnosticItem> {
  const model = getActiveModel();
  if (!model.apiHost?.trim() || !model.model?.trim()) {
    return {
      id: 'model', area: 'model', title: 'AI 模型', status: 'blocked',
      summary: '还没有可用的主模型',
      detail: '缺少 API 地址或模型名称，助手、员工和团队都无法开始真实任务。',
      action: '在模型页面添加并启用一个模型，然后重新检查。', settingsTab: 'model',
    };
  }
  const provider = getProvider(model.provider);
  if (provider.needsKey && !model.apiKey?.trim()) {
    return {
      id: 'model', area: 'model', title: 'AI 模型', status: 'blocked',
      summary: `${model.model} 还缺 API Key`,
      detail: '接口地址和模型名称已经填写，但该服务商需要密钥。',
      action: '补充 API Key，保存后重新检查。', settingsTab: 'model',
    };
  }
  const raw = await diagnoseModel(model, { timeoutMs: 7000 });
  const connected = /模型诊断：接口可连通/u.test(raw);
  return {
    id: 'model', area: 'model', title: 'AI 模型', status: connected ? 'ready' : 'blocked',
    summary: connected ? `${model.model} 可以连接` : `${model.model} 当前连不上`,
    detail: raw.split('\n').filter((line) => /耗时|HTTP|建议|连接失败|连接超时|返回错误/u.test(line)).join('；') || raw.slice(0, 260),
    action: connected ? '模型预检通过，可以执行任务。' : '检查网络、API 地址和密钥后重新检查。',
    settingsTab: 'model',
  };
}

async function diagnoseConnectors(): Promise<SystemDiagnosticItem> {
  const enabled = loadConnectors().filter((connector) => connector.enabled);
  if (!enabled.length) {
    return {
      id: 'connector', area: 'connector', title: '连接器与知识库', status: 'warning',
      summary: '还没有启用连接器',
      detail: '不影响普通对话和本地文件任务，但无法读取外部知识库或服务。',
      action: '需要外部服务时，在知识库页面添加并完成一次真实测试。', settingsTab: 'knowledge',
    };
  }
  const missing = enabled.flatMap((connector) => connectorMissingFields(connector).map((field) => `${connector.label}缺少${field}`));
  const results = await Promise.all(enabled.map(async (connector) => ({ connector, result: await checkConnector(connector) })));
  const connected = results.filter(({ result }) => result.status === 'connected').length;
  const uncertain = results.filter(({ result }) => result.status === 'unknown').length;
  const failed = results.filter(({ result }) => result.status === 'disconnected');
  const status: DiagnosticStatus = missing.length || failed.length ? 'blocked' : uncertain ? 'warning' : 'ready';
  const problems = [
    ...missing,
    ...failed.map(({ connector, result }) => `${connector.label}：${result.error || '连接失败'}`),
    ...results.filter(({ result }) => result.status === 'unknown').map(({ connector, result }) => `${connector.label}：${result.error || '需要真实调用确认'}`),
  ];
  return {
    id: 'connector', area: 'connector', title: '连接器与知识库', status,
    summary: `${enabled.length} 个已启用，${connected} 个可用${uncertain ? `，${uncertain} 个待验证` : ''}${failed.length ? `，${failed.length} 个失败` : ''}`,
    detail: problems.length ? problems.slice(0, 6).join('；') : '所有已启用连接器均通过最小连接测试。',
    action: status === 'ready' ? '连接器预检通过。' : '补齐配置并执行一次最小真实调用，再重新检查。',
    settingsTab: 'knowledge',
  };
}

async function diagnoseSkills(): Promise<SystemDiagnosticItem> {
  try {
    const skills = await listSkills();
    const limited = skills.filter((skill) => skill.health === 'limited');
    const broken = skills.filter((skill) => skill.health === 'broken');
    const setup = skills.filter((skill) => skill.health === 'setup');
    return {
      id: 'skill', area: 'skill', title: 'Skill 健康', status: skills.length === 0 || broken.length ? 'blocked' : limited.length || setup.length ? 'warning' : 'ready',
      summary: skills.length === 0 ? '没有可用 Skill' : `${skills.length} 个已安装${broken.length ? `，${broken.length} 个已隔离` : ''}${limited.length ? `，${limited.length} 个不完整` : ''}${setup.length ? `，${setup.length} 个使用前需配置` : ''}`,
      detail: [...broken, ...limited, ...setup].length ? [...broken, ...limited, ...setup].slice(0, 8).map((skill) => `${skill.name}：${skill.healthMessage || '需要处理'}`).join('；') : '技能清单和引用文件检查正常。',
      action: skills.length === 0 ? '前往主界面技能库安装 Skill。' : broken.length || limited.length ? '在主界面技能库修复或重新安装这些 Skill；已隔离技能不会自动参与任务。' : setup.length ? '按技能卡提示补齐账号、环境变量或外部软件。' : 'Skill 健康检查通过。',
    };
  } catch (error) {
    return {
      id: 'skill', area: 'skill', title: 'Skill 健康', status: 'blocked', summary: '无法扫描 Skill',
      detail: error instanceof Error ? error.message : String(error), action: '检查客户端安装目录和 Skill 目录后重新检查。',
    };
  }
}

async function diagnoseWorkspace(): Promise<SystemDiagnosticItem> {
  const api = window.electronAPI;
  if (!api?.fsInitWorkspace || !api.fsWrite || !api.fsRead) {
    return {
      id: 'workspace', area: 'workspace', title: '任务工作区', status: 'blocked', summary: '当前环境不支持真实工作区',
      detail: '浏览器预览不能提供完整的本机文件隔离能力。', action: '请使用太极桌面客户端。', settingsTab: 'workspace',
    };
  }
  try {
    const id = 'diagnostics/system-health';
    const initialized = await api.fsInitWorkspace(id, { kind: 'assistant', label: '系统诊断', taskId: 'system-health' });
    if (!initialized.ok) throw new Error(initialized.error || '无法创建诊断目录');
    const nonce = `taiji-${Date.now()}`;
    const written = await api.fsWrite(`${id}/health-check.txt`, nonce);
    if (!written.ok) throw new Error(written.error || '无法写入测试文件');
    const read = await api.fsRead(`${id}/health-check.txt`);
    if (!read.ok || read.content !== nonce) throw new Error(read.error || '写入后无法正确读回');
    return {
      id: 'workspace', area: 'workspace', title: '任务工作区', status: 'ready', summary: '创建、写入和读取均正常',
      detail: `工作区根目录：${await api.getWorkspace()}`, action: '工作区预检通过，新任务会使用独立目录。', settingsTab: 'workspace',
    };
  } catch (error) {
    return {
      id: 'workspace', area: 'workspace', title: '任务工作区', status: 'blocked', summary: '工作区读写失败',
      detail: error instanceof Error ? error.message : String(error), action: '检查目录权限或磁盘空间后重新检查。', settingsTab: 'workspace',
    };
  }
}

async function diagnosePermission(): Promise<SystemDiagnosticItem> {
  const policy = getExecutionPolicy();
  const risky = !policy.sandboxEnabled || policy.approvalMode === 'full';
  return {
    id: 'permission', area: 'permission', title: '安全与审批', status: risky ? 'warning' : 'ready',
    summary: `${policy.sandboxEnabled ? '命令沙盒已开启' : '命令沙盒已关闭'}，命令${policy.approvalMode === 'ask' ? '每次审核' : policy.approvalMode === 'delegate' ? '低风险自动审核' : '完全访问'}，连接器${policy.connectorApprovalMode === 'ask' ? '每次审核' : policy.connectorApprovalMode === 'delegate' ? '低风险自动审核' : '完全访问'}`,
    detail: risky ? '当前设置允许更大范围的本机或外部操作，执行高风险任务前请确认来源。' : '命令限制在工作区内，高风险动作会停下来确认。',
    action: risky ? '日常使用建议开启沙盒并选择“替我审核”。' : '安全策略预检通过。', settingsTab: 'automation',
  };
}

export async function runSystemDiagnostics(): Promise<SystemDiagnosticReport> {
  const settled = await Promise.allSettled([
    diagnoseActiveModel(), diagnoseConnectors(), diagnoseSkills(), diagnoseWorkspace(), diagnosePermission(),
  ]);
  const names = ['AI 模型', '连接器与知识库', 'Skill 健康', '任务工作区', '安全与审批'];
  const areas: DiagnosticArea[] = ['model', 'connector', 'skill', 'workspace', 'permission'];
  const items = settled.map((result, index): SystemDiagnosticItem => result.status === 'fulfilled' ? result.value : {
    id: areas[index], area: areas[index], title: names[index], status: 'blocked', summary: '检查过程出错',
    detail: result.reason instanceof Error ? result.reason.message : String(result.reason), action: '处理提示后重新检查。',
  });
  return {
    checkedAt: Date.now(), items,
    ready: items.filter((item) => item.status === 'ready').length,
    warning: items.filter((item) => item.status === 'warning').length,
    blocked: items.filter((item) => item.status === 'blocked').length,
  };
}
