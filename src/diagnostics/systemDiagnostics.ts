import { checkConnector, connectorMissingFields, loadConnectors } from '../data/connectors';
import type { ModelConfig } from '../types';
import { getActiveModel, getExecutionPolicy, getModelCapabilities, getProvider, loadSettings } from '../data/hermesClient';
import { externalCapabilityProfileForConnector, recordExternalCapabilityProbe, syncExternalCapabilityProfiles } from '../data/externalCapabilityMatrix';
import { getModelHealthSnapshot, getModelRecoveryAdviceForConfig } from '../data/modelReliability';
import { listSkills } from '../data/skills';
import { diagnoseModel } from './modelDiagnostics';
import { getToolRegistrySnapshot } from '../engine/toolCatalog';
import { completeExternalCapabilityProfiles, summarizeExternalCapabilityMatrix, type ExternalCapabilityEntry, type ExternalCapabilityKind, type ExternalCapabilityMatrix, type ExternalCapabilityProfile } from '../engine/externalCapabilityMatrix.mjs';

export type DiagnosticStatus = 'ready' | 'warning' | 'blocked';
export type DiagnosticArea = 'model' | 'connector' | 'skill' | 'external' | 'tool' | 'runtime' | 'memory' | 'workspace' | 'permission';

export interface SystemDiagnosticItem {
  id: string;
  area: DiagnosticArea;
  title: string;
  status: DiagnosticStatus;
  summary: string;
  detail: string;
  action: string;
  settingsTab?: 'model' | 'knowledge' | 'workspace' | 'memory' | 'automation';
}

export interface SystemDiagnosticReport {
  checkedAt: number;
  items: SystemDiagnosticItem[];
  ready: number;
  warning: number;
  blocked: number;
  externalCapabilities: { summary: ReturnType<typeof summarizeExternalCapabilityMatrix>; entries: ExternalCapabilityEntry[] };
}

function configuredCapabilityProfiles(): ExternalCapabilityProfile[] {
  const settings = loadSettings();
  const models: Array<ModelConfig & { id?: string; label?: string; lastCompatibilityReport?: any }> = settings.modelLibrary?.length ? settings.modelLibrary : [getActiveModel()];
  const modelProfiles = models.flatMap((model, index) => {
    const capabilities = getModelCapabilities(model);
    const identity = model.apiHost || model.provider;
    const id = model.id || model.refModelId || `${model.model || 'model'}-${index}`;
    const configured = Boolean(model.apiHost?.trim() && model.model?.trim() && (!getProvider(model.provider).needsKey || model.apiKey?.trim()));
    return [
      ...(capabilities.includes('chat') ? [{ id: `model:chat:${id}`, kind: 'chat_model' as const, label: model.label || model.model || '聊天模型', source: model.provider, configured, resourceIdentity: identity }] : []),
      ...(capabilities.includes('image') ? [{ id: `model:image:${id}`, kind: 'image_generation' as const, label: model.label || model.model || '图片模型', source: model.provider, configured, resourceIdentity: identity }] : []),
    ];
  });
  const discoveredProfiles: ExternalCapabilityProfile[] = [
    ...modelProfiles,
    { id: 'builtin:web-page', kind: 'web_page', label: '指定网页读取', source: 'desktop-runtime', configured: Boolean(window.electronAPI?.knowledgeFetchUrl) },
    { id: 'builtin:skillhub', kind: 'skillhub', label: 'SkillHub', source: 'skill-runtime', configured: Boolean(window.electronAPI?.skillsSearchMarket && window.electronAPI?.skillsInstall) },
    ...loadConnectors().map((connector) => externalCapabilityProfileForConnector(connector, connectorMissingFields(connector).length === 0)),
  ];
  const fallbackLabels: Record<ExternalCapabilityKind, string> = {
    chat_model: '聊天模型', image_generation: '图片生成', web_page: '指定网页读取', skillhub: 'SkillHub',
    knowledge_base: '知识库', email: '邮件', github: 'GitHub', generic_http: 'HTTP', mcp: 'MCP',
  };
  return completeExternalCapabilityProfiles(discoveredProfiles, fallbackLabels);
}

function modelProbeState(report: any, kind: ExternalCapabilityKind): Record<string, unknown> | undefined {
  const capability = kind === 'image_generation' ? report?.capabilities?.image_generation : report?.capabilities?.chat;
  if (!capability || capability.state === 'not_tested') return undefined;
  const state = String(capability.state ?? '');
  return {
    actualCall: true,
    ok: state === 'supported',
    validated: state === 'supported',
    httpStatus: report?.probes?.find((probe: any) => probe.capability === (kind === 'image_generation' ? 'image_generation' : 'chat'))?.httpStatus,
    protocolError: state === 'protocol_error',
    invalidContent: state === 'invalid_content',
    detail: capability.error || capability.nextAction || state,
  };
}

function refreshStoredModelProbes(): void {
  const settings = loadSettings();
  for (const profile of configuredCapabilityProfiles().filter((item) => item.kind === 'chat_model' || item.kind === 'image_generation')) {
    const modelId = profile.id.split(':').slice(2).join(':');
    const model = settings.modelLibrary?.find((item) => item.id === modelId);
    const event = modelProbeState(model?.lastCompatibilityReport, profile.kind);
    if (event) recordExternalCapabilityProbe(profile, event);
  }
}

function externalCapabilityItem(matrix: ExternalCapabilityMatrix): SystemDiagnosticItem {
  const summary = summarizeExternalCapabilityMatrix(matrix);
  const status: DiagnosticStatus = summary.blocked ? 'blocked' : summary.notTested || summary.missingConfig ? 'warning' : 'ready';
  return {
    id: 'external', area: 'external', title: '外部能力真实矩阵', status,
    summary: `${summary.available}/${summary.total} 项真实可用${summary.notTested ? `，${summary.notTested} 项未测试` : ''}${summary.blocked ? `，${summary.blocked} 项失败` : ''}`,
    detail: summary.total ? `缺配置 ${summary.missingConfig} 项；恢复复验 ${summary.recovered} 次。安装、发现或保存配置不会被计作真实可用。` : '尚未发现可验证的模型或外部服务配置。',
    action: status === 'ready' ? '所有已登记外部能力均有真实验证证据。' : '在对应模型、知识库或 Skill 页面完成真实测试；需要副作用的能力不会在后台自动发送测试数据。',
  };
}

async function diagnoseActiveModel(): Promise<SystemDiagnosticItem> {
  const model = getActiveModel();
  const profile = configuredCapabilityProfiles().find((item) => item.kind === 'chat_model' && (item.id.endsWith(`:${model.refModelId}`) || item.id.includes(model.model ?? '') || item.label === model.model));
  if (!model.apiHost?.trim() || !model.model?.trim()) {
    if (profile) recordExternalCapabilityProbe(profile, { configured: false, missingConfig: true, actualCall: false });
    return {
      id: 'model', area: 'model', title: 'AI 模型', status: 'blocked',
      summary: '还没有可用的主模型',
      detail: '缺少 API 地址或模型名称，助手、员工和团队都无法开始真实任务。',
      action: '在模型页面添加并启用一个模型，然后重新检查。', settingsTab: 'model',
    };
  }
  const provider = getProvider(model.provider);
  if (provider.needsKey && !model.apiKey?.trim()) {
    if (profile) recordExternalCapabilityProbe(profile, { configured: false, missingConfig: true, actualCall: false });
    return {
      id: 'model', area: 'model', title: 'AI 模型', status: 'blocked',
      summary: `${model.model} 还缺 API Key`,
      detail: '接口地址和模型名称已经填写，但该服务商需要密钥。',
      action: '补充 API Key，保存后重新检查。', settingsTab: 'model',
    };
  }
  const runtimeHealth = getModelHealthSnapshot(model)[0] as {
    circuitState?: string;
    requestCount?: number;
    successRate?: number;
    averageLatencyMs?: number;
    averageFirstTokenMs?: number;
    failureClasses?: Record<string, number>;
    recovery?: { recovered?: number; failed?: number };
  } | undefined;
  const settings = loadSettings();
  const alternatives = (settings.modelLibrary ?? [])
    .filter((entry) => entry.id !== model.refModelId && entry.model && !/^gpt-image/iu.test(entry.model))
    .map((entry) => ({ provider: entry.provider, apiHost: entry.apiHost, model: entry.model, refModelId: entry.id }));
  const advice = getModelRecoveryAdviceForConfig(model, alternatives);
  const raw = await diagnoseModel(model, { timeoutMs: 7000 });
  const connected = /模型诊断：接口可连通/u.test(raw);
  if (profile) recordExternalCapabilityProbe(profile, { actualCall: true, ok: connected, validated: connected, responseReceived: connected, detail: raw.slice(0, 500) });
  const circuitOpen = runtimeHealth?.circuitState === 'open';
  const status: DiagnosticStatus = connected ? (circuitOpen ? 'warning' : 'ready') : 'blocked';
  const totalRequests = Number(runtimeHealth?.requestCount ?? 0);
  const successRate = totalRequests ? `${Math.round(Number(runtimeHealth?.successRate ?? 0) * 100)}%` : '暂无运行期样本';
  const failures = runtimeHealth?.failureClasses ?? {};
  const runtimeDetail = totalRequests
    ? `运行期 ${totalRequests} 次，成功率 ${successRate}，平均耗时 ${runtimeHealth?.averageLatencyMs ?? 0}ms，首 token ${runtimeHealth?.averageFirstTokenMs ?? 0}ms；503 ${failures.server ?? 0}，429 ${failures.rate_limit ?? 0}，超时 ${failures.timeout ?? 0}，网络 ${failures.network ?? 0}；恢复 ${runtimeHealth?.recovery?.recovered ?? 0} 次`
    : '还没有运行期模型调用样本';
  return {
    id: 'model', area: 'model', title: 'AI 模型', status,
    summary: connected ? `${model.model} 可以连接${circuitOpen ? '，运行期保护窗口尚未结束' : ''}` : `${model.model} 当前连不上`,
    detail: `${raw.split('\n').filter((line) => /耗时|HTTP|建议|连接失败|连接超时|返回错误/u.test(line)).join('；') || raw.slice(0, 260)}；${runtimeDetail}`,
    action: connected
      ? circuitOpen
        ? `等待 ${Math.max(1, Math.ceil(Number(advice.retryAfterMs ?? 0) / 1000))} 秒后继续探测${Array.isArray(advice.alternatives) && advice.alternatives.length ? '，也可以到模型页面手动切换备用聊天模型' : ''}。系统不会自动换模型。`
        : '模型预检通过，可以执行任务。'
      : '检查网络、API 地址和密钥后重新检查。',
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
  for (const { connector, result } of results) {
    const configured = connectorMissingFields(connector).length === 0;
    const profile = externalCapabilityProfileForConnector(connector, configured);
    recordExternalCapabilityProbe(profile, {
      configured,
      missingConfig: !configured,
      actualCall: configured && connector.kind !== 'skill-bridge',
      ok: result.status === 'connected',
      validated: result.status === 'connected',
      responseReceived: result.status !== 'unknown',
      detail: result.error || result.status,
      protocolError: /协议|json-rpc|响应字段/iu.test(result.error ?? ''),
    });
  }
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

async function diagnoseToolRegistry(): Promise<SystemDiagnosticItem> {
  const snapshot = getToolRegistrySnapshot();
  const sources = new Map<string, number>();
  snapshot.tools.forEach((tool) => sources.set(tool.source, (sources.get(tool.source) ?? 0) + 1));
  const problems = [
    ...snapshot.collisions.map((name) => `${name} 名称冲突`),
    ...snapshot.invalid.map((item) => `${item.name}：${item.errors.join('、')}`),
  ];
  const status: DiagnosticStatus = snapshot.ready === 0 || snapshot.blocked > 0 ? 'blocked' : 'ready';
  return {
    id: 'tool', area: 'tool', title: '工具注册中心', status,
    summary: `${snapshot.ready} 个可用，协议 v${snapshot.protocolVersion}${snapshot.blocked ? `，${snapshot.blocked} 个已隔离` : ''}`,
    detail: problems.length
      ? problems.slice(0, 8).join('；')
      : [...sources.entries()].map(([source, count]) => `${source} ${count} 个`).join('；'),
    action: status === 'ready' ? '名称、参数 Schema、来源和运行时边界均已通过预检。' : '修复冲突或损坏定义后重新检查；已隔离工具不会交给模型。',
  };
}

async function diagnoseTaskRuntime(): Promise<SystemDiagnosticItem> {
  const api = window.electronAPI;
  if (!api?.ecosystemHealth) {
    return {
      id: 'runtime', area: 'runtime', title: '任务内核与恢复', status: 'blocked',
      summary: '当前环境没有任务内核健康接口',
      detail: '无法核对任务账本、后台 Worker、工具注册、升级身份和 Git 隔离状态。',
      action: '请使用太极桌面客户端，并确认客户端已经更新到当前版本。',
    };
  }
  try {
    const report = await api.ecosystemHealth({ mode: 'runtime' });
    const problems = report.checks.filter((check) => check.status !== 'ready');
    const detail = problems.length
      ? problems.map((check) => `${check.title}：${check.summary}`).join('；')
      : report.checks.map((check) => check.title).join('、');
    return {
      id: 'runtime', area: 'runtime', title: '任务内核与恢复', status: report.status,
      summary: `${report.ready}/${report.checks.length} 项正常${report.warning ? `，${report.warning} 项提醒` : ''}${report.blocked ? `，${report.blocked} 项不可用` : ''}`,
      detail,
      action: report.status === 'ready'
        ? '任务账本、后台执行、工具、Skill、工作区、版本身份和代码隔离均通过检查。'
        : report.canRelease
          ? '核心任务能力可用；按提醒检查 Git 或可选能力即可。'
          : '先处理上面的核心故障并重新检查，系统不会把未通过的升级记为成功。',
      settingsTab: report.canRelease ? undefined : 'workspace',
    };
  } catch (error) {
    return {
      id: 'runtime', area: 'runtime', title: '任务内核与恢复', status: 'blocked', summary: '任务内核健康检查失败',
      detail: error instanceof Error ? error.message : String(error), action: '重新启动客户端后再检查；仍失败时查看升级日志和任务账本。',
    };
  }
}

async function diagnoseMemoryLearning(): Promise<SystemDiagnosticItem> {
  const api = window.electronAPI;
  if (!api?.memoryList || !api.learningReviewStatus) {
    return {
      id: 'memory', area: 'memory', title: '记忆与任务复盘', status: 'blocked',
      summary: '当前客户端没有分层记忆接口',
      detail: '无法读取组织、团队、员工、用户记忆和持久化复盘队列。',
      action: '确认客户端已经更新到当前版本后重新检查。', settingsTab: 'memory',
    };
  }
  try {
    const [memory, reviews] = await Promise.all([
      api.memoryList({ includeAudit: true }),
      api.learningReviewStatus(),
    ]);
    if (!memory.ok || !reviews.ok) throw new Error(memory.error || reviews.error || '记忆或复盘状态读取失败');
    const entries = memory.entries ?? [];
    const pending = (memory.proposals ?? []).filter((item) => item.status === 'pending').length;
    const failed = reviews.counts?.failed ?? 0;
    const waiting = reviews.counts?.waiting_model ?? 0;
    const active = (reviews.counts?.queued ?? 0) + (reviews.counts?.processing ?? 0);
    const status: DiagnosticStatus = pending || failed || waiting ? 'warning' : 'ready';
    const detail = [
      pending ? `${pending} 条独立判断等待批准` : '',
      waiting ? `${waiting} 项等待独立审查模型` : '',
      failed ? `${failed} 项复盘失败，可单独重试` : '',
      active ? `${active} 项正在排队或处理` : '',
    ].filter(Boolean).join('；') || '分层事实源、审批队列、复盘恢复和 Markdown 投影均正常。';
    return {
      id: 'memory', area: 'memory', title: '记忆与任务复盘', status,
      summary: `${entries.length} 条分层记忆，${reviews.counts?.completed ?? 0} 项复盘已完成`,
      detail,
      action: status === 'ready' ? '记忆与复盘闭环可用。' : '打开记忆页处理待审核、待配置或失败项目。',
      settingsTab: 'memory',
    };
  } catch (error) {
    return {
      id: 'memory', area: 'memory', title: '记忆与任务复盘', status: 'blocked', summary: '记忆事实源读取失败',
      detail: error instanceof Error ? error.message : String(error), action: '重新启动客户端后再检查；仍失败时查看被隔离的损坏数据。', settingsTab: 'memory',
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
  const profiles = configuredCapabilityProfiles();
  syncExternalCapabilityProfiles(profiles);
  const settled = await Promise.allSettled([
    diagnoseActiveModel(), diagnoseConnectors(), diagnoseSkills(), diagnoseToolRegistry(), diagnoseTaskRuntime(), diagnoseMemoryLearning(), diagnoseWorkspace(), diagnosePermission(),
  ]);
  const names = ['AI 模型', '连接器与知识库', 'Skill 健康', '工具注册中心', '任务内核与恢复', '记忆与任务复盘', '任务工作区', '安全与审批'];
  const areas: DiagnosticArea[] = ['model', 'connector', 'skill', 'tool', 'runtime', 'memory', 'workspace', 'permission'];
  const items = settled.map((result, index): SystemDiagnosticItem => result.status === 'fulfilled' ? result.value : {
    id: areas[index], area: areas[index], title: names[index], status: 'blocked', summary: '检查过程出错',
    detail: result.reason instanceof Error ? result.reason.message : String(result.reason), action: '处理提示后重新检查。',
  });
  refreshStoredModelProbes();
  const externalMatrix = syncExternalCapabilityProfiles(profiles);
  items.splice(3, 0, externalCapabilityItem(externalMatrix));
  return {
    checkedAt: Date.now(), items,
    ready: items.filter((item) => item.status === 'ready').length,
    warning: items.filter((item) => item.status === 'warning').length,
    blocked: items.filter((item) => item.status === 'blocked').length,
    externalCapabilities: { summary: summarizeExternalCapabilityMatrix(externalMatrix), entries: Object.values(externalMatrix.entries) },
  };
}
