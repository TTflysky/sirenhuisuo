import type { Employee, Team, ChatMessage, AppState, AgentStatus, ModelConfig, SkillReference } from '../types';
import { repairEmployeeStations } from './officeStations';
import { seedEmployees } from './defaultEmployees';
import { seedTeams } from './defaultTeams';
import type { OutputScope } from './outputs';
import type { ConnectorProtocolResult } from '../engine/connectorProtocol.mjs';
import type { ToolExecutionEvidence } from '../engine/executionEvidence.mjs';
import { loadTaskRuns } from './taskRuns';
import { redactToolArguments } from '../engine/securityBoundary';
import { ensureDistinctEmployeeColors } from './employeeColors';
import { materializeCatalogEmployees } from './expertCatalog';
import { parseGeneratedAvatarPayload } from './generatedAvatar';
import {
  canonicalToolCallKey,
  buildFreshWebQuery,
  buildResearchFallback,
  ensureResearchSourceLinks,
  getToolCallLimit,
  isActionableCapabilityCorrection,
  isExplicitStopSteering,
  isPreparationOnlyTool,
  isResearchOnlyRequest,
  isResearchDeliveryDeflection,
  isResearchEvidenceRelevant,
  toolResourceKey,
} from '../engine/agentGuardrails.mjs';
import {
  AUTONOMOUS_EXECUTION_GUIDE,
  BEGINNER_RESPONSE_GUIDE,
  CAPABILITY_ROUTING_GUIDE,
  EXECUTION_SELF_REVIEW_GUIDE,
  SKILL_RECOVERY_GUIDE,
  buildContinuationGuide,
  getToolStage,
  guardInstallationSummary,
  humanizeExecutionError,
  isToolResultSuccessful,
} from './assistantPresentation';
import {
  applyExecutionSteering,
  blockExecution,
  canExecuteRoute,
  createExecutionController,
  evaluateExecutionConclusion,
  executionControllerGuidance,
  markExecutionBudgetReached,
  observeExecutionResult,
  restoreExecutionController,
  type ExecutionControllerSnapshot,
} from '../engine/executionController.mjs';
import {
  TASK_DECISION_TOOL,
  TASK_DECISION_TOOL_NAME,
  buildTaskContract,
  buildTaskDecisionMessages,
  createFallbackTaskDecision,
  normalizeTaskDecision,
  parseTaskDecisionToolCall,
  type TaskDecision,
} from '../engine/taskDecisionKernel.mjs';
import { assessTaskCompletion } from '../engine/taskFidelity.mjs';
import { isSkillInstallOnlyRequest, resolveSkillInstallInput, resolveSkillInstallRequest } from '../engine/skillInstallRouting.mjs';
import { buildTaskLearningContext, recordTaskLearning } from '../engine/taskLearningMemory';
import {
  buildTaskSummaryMaterial,
  restoreTaskContext,
  type TaskContextSnapshot,
  type TaskModelSummaryProposal,
} from '../engine/taskContext.mjs';
import {
  applySteering as applyTurnSteering,
  buildTurnGuidance,
  compactRuntimeEvidence,
  createTurnRuntime,
  decideRecovery as decideTurnRecovery,
  finalizeTurn as finalizeRuntimeTurn,
  normalizeToolCall as normalizeTurnToolCall,
  observeModelDecision as observeTurnModelDecision,
  observeToolResult as observeTurnToolResult,
  type TurnRuntimeState,
} from '../engine/turnRuntime.mjs';
import {
  createTurnLifecycle,
  recordLifecycleContext,
  recordLifecycleDecision,
  recordLifecycleProgress,
  recordLifecycleSteering,
  recordLifecycleToolFinished,
  recordLifecycleToolStarted,
  synchronizeTurnLifecycle,
  type TurnLifecycleState,
} from '../engine/turnLifecycle.mjs';

const LS_EMPLOYEES = 'hermes_office_employees';
const LS_TEAMS = 'hermes_office_teams';
const LS_PROJECTS = 'hermes_office_projects_v1';
const LS_CHAT_PREFIX = 'hermes_office_chat_';
const LS_SETTINGS = 'hermes_office_settings';
const MAX_CHAT = 200;

let _backendOnline: boolean | null = null;

// ===== 主流端口预设 =====
export interface PortPreset {
  label: string;
  port: string;
  desc: string;
}
export const PORT_PRESETS: PortPreset[] = [
  { label: 'Hermes 默认', port: '8080', desc: 'Hermes agent 框架常用端口' },
  { label: 'OpenAI 兼容', port: '8000', desc: 'OpenAI 兼容 API / vLLM / FastAPI' },
  { label: 'Ollama', port: '11434', desc: 'Ollama 本地大模型' },
  { label: 'Dify', port: '5001', desc: 'Dify AI 应用平台' },
  { label: 'FastAPI', port: '8000', desc: 'FastAPI / Uvicorn 默认' },
  { label: 'HTTP 标准', port: '80', desc: '标准 HTTP' },
  { label: 'HTTPS 标准', port: '443', desc: '标准 HTTPS' },
  { label: '自定义', port: '', desc: '手动输入端口' },
];

// ===== 设置 =====
export interface ModelEntry extends ModelConfig {
  id: string;          // 唯一标识
  label: string;       // 显示名称（如"DeepSeek 主力"）
  tested?: 'ok' | 'fail' | undefined;  // 连接测试结果
  lastTested?: number; // 上次测试时间戳
  lastLatencyMs?: number;
  lastHttpStatus?: number;
  lastTestMessage?: string;
  lastTestEndpoint?: string;
}

export interface AppSettings {
  provider?: string;  // 服务商 key（对应 PROVIDER_PRESETS），'custom' 为自定义（向后兼容）
  apiHost?: string;   // 完整 base_url（向后兼容）
  apiKey?: string;    // Bearer token（向后兼容）
  model?: string;     // 模型名（向后兼容）
  contextWindowTokens?: number; // 旧版全局模型的上下文上限（模型库优先）
  autoDiscuss?: boolean; // 是否在发消息/任务后自动触发团队 AI 讨论（默认 false=手动）
  autoDiscussMode?: 'off' | 'smart' | 'always';
  autoDiscussMinScore?: number;
  autoDiscussCooldownMs?: number;
  autoDiscussMaxRounds?: number;
  autoPilot?: boolean;   // 自主模式：推荐项目后自动执行最佳项目（默认 false=手动点执行）
  assistantModelConfig?: ModelConfig; // 助理机器人的独立模型配置（员工未配模型时默认使用此配置）
  // ===== 多模型库 =====
  modelLibrary?: ModelEntry[];  // 所有已配置的模型列表
  activeModelId?: string;       // 当前全局使用的模型 ID（对应 modelLibrary 中的 entry.id）
  assistantModelId?: string;    // 助理机器人使用的模型 ID
  reviewModelId?: string;       // 独立任务复盘/责任审查模型，不设置时不自动调用复盘模型
  diagnosticModelId?: string;   // 诊断中心的一键优化模型
  imageModelId?: string;        // 员工头像生图模型（OpenAI 兼容 images/generations）
  memoryWriteApproval?: boolean; // 独立审查模型提出的记忆更新是否需要人工审核（默认 true）
  skillsWriteApproval?: boolean; // 自动 Skill 草案是否需要审核（固定默认 true）
  showThoughtChain?: boolean;   // 助理是否显示思维链（默认 true）
  followUpMode?: 'queue' | 'steer'; // 运行中收到新消息：排队或引导当前执行
  /** 命令是否限制在客户端工作区。默认开启。 */
  sandboxEnabled?: boolean;
  /** 工具动作的审批强度。 */
  approvalMode?: ApprovalMode;
  /** 连接器独立审批强度；未设置时兼容沿用工具审批。 */
  connectorApprovalMode?: ApprovalMode;
}

export type ApprovalMode = 'ask' | 'delegate' | 'full';

export interface ExecutionPolicy {
  sandboxEnabled: boolean;
  approvalMode: ApprovalMode;
  connectorApprovalMode: ApprovalMode;
}

export const APPROVAL_MODE_OPTIONS: Array<{ value: ApprovalMode; label: string; description: string }> = [
  { value: 'ask', label: '请求审核', description: '每次命令或连接器操作都先征求你的同意。' },
  { value: 'delegate', label: '替我审核', description: '自动处理低风险查询和工作区任务，高风险操作再向你确认。' },
  { value: 'full', label: '完全访问权限', description: '不再弹出审批；仍保留运行记录和系统安全限制。' },
];

// ===== 服务商预设（国内主流大模型，OpenAI 兼容）=====
export interface ProviderPreset {
  key: string;
  label: string;
  baseUrl: string;        // 完整 base_url（含路径），chat/completions 将拼为 baseUrl + '/chat/completions'（若未含 /v1 或 /v4 等版本段则自动补 /v1）
  defaultModel: string;
  needsKey: boolean;
  desc: string;
}
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { key: 'deepseek', label: 'DeepSeek 深度求索', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', needsKey: true, desc: '中文+代码+性价比' },
  { key: 'qwen', label: '通义千问 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', needsKey: true, desc: '阿里云百炼，企业成熟' },
  { key: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', needsKey: true, desc: '政企/私有化常见' },
  { key: 'kimi', label: 'Kimi 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', needsKey: true, desc: '超长上下文' },
  { key: 'doubao', label: '豆包 字节', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-1.5-pro', needsKey: true, desc: '火山方舟，便宜高并发' },
  { key: 'hunyuan', label: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-pro', needsKey: true, desc: '腾讯生态' },
  { key: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', needsKey: true, desc: '需代理访问' },
  { key: 'ollama', label: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', defaultModel: 'qwen2.5', needsKey: false, desc: '本地免费零成本' },
  { key: 'custom', label: '自定义', baseUrl: '', defaultModel: '', needsKey: false, desc: '自建/兼容平台' },
];

export function getProvider(key?: string): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.key === key) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) {
      const settings = JSON.parse(raw) as AppSettings;
      if (settings.autoDiscussMode === undefined) settings.autoDiscussMode = settings.autoDiscuss ? 'smart' : 'off';
      return settings;
    }
  } catch {}
  return {};
}
export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  } catch {}
}

export function getExecutionPolicy(settings: AppSettings = loadSettings()): ExecutionPolicy {
  return {
    sandboxEnabled: settings.sandboxEnabled !== false,
    approvalMode: settings.approvalMode === 'ask' || settings.approvalMode === 'full' ? settings.approvalMode : 'delegate',
    connectorApprovalMode: settings.connectorApprovalMode === 'ask' || settings.connectorApprovalMode === 'full' ? settings.connectorApprovalMode : settings.connectorApprovalMode === 'delegate' ? 'delegate' : settings.approvalMode === 'ask' || settings.approvalMode === 'full' ? settings.approvalMode : 'delegate',
  };
}

/**
 * 保存命令沙盒和审批策略，并把变更同步给其他已打开的聊天窗口。
 * 每个窗口仍从自身 localStorage 读取设置，因此重启后也会保留。
 */
export function saveExecutionPolicy(update: Partial<ExecutionPolicy>): AppSettings {
  const next: AppSettings = { ...loadSettings(), ...update };
  saveSettings(next);
  const policy = getExecutionPolicy(next);
  try {
    window.dispatchEvent(new CustomEvent('execution-policy:changed', { detail: policy }));
    window.electronAPI?.broadcast?.('execution-policy:changed', policy);
  } catch {}
  return next;
}

// ===== 多模型库辅助 =====
/** 获取当前激活的全局模型配置（优先从 modelLibrary 查找，回退到旧字段） */
export function getActiveModel(): ModelConfig {
  const s = loadSettings();
  if (s.modelLibrary && s.modelLibrary.length > 0) {
    const active = s.modelLibrary.find(m => m.id === s.activeModelId) ?? s.modelLibrary[0];
    return { provider: active.provider, apiHost: active.apiHost, apiKey: active.apiKey, model: active.model, contextWindowTokens: active.contextWindowTokens };
  }
  // 向后兼容：旧版直接用 provider/apiHost/apiKey/model 字段
  return { provider: s.provider, apiHost: s.apiHost, apiKey: s.apiKey, model: s.model, contextWindowTokens: s.contextWindowTokens };
}

/** 获取助理机器人模型配置（优先从 modelLibrary 查找，回退到 assistantModelConfig，再回退到全局） */
export function getAssistantModel(): ModelConfig {
  const s = loadSettings();
  if (s.modelLibrary && s.modelLibrary.length > 0 && s.assistantModelId) {
    const am = s.modelLibrary.find(m => m.id === s.assistantModelId);
    if (am) return { provider: am.provider, apiHost: am.apiHost, apiKey: am.apiKey, model: am.model, contextWindowTokens: am.contextWindowTokens };
  }
  // 助理手动配置优先于全局激活模型
  if (s.assistantModelConfig) return s.assistantModelConfig;
  // 模型库启用后，旧字段通常为空。助理未单独指定模型时必须继承当前激活模型，
  // 否则会误判为“未配置 API”并持续返回本地兜底文案。
  return getActiveModel();
}

/** 获取独立审查模型。未显式选择时返回 undefined，避免执行模型默认自审。 */
export function getReviewModel(): ModelConfig | undefined {
  const settings = loadSettings();
  if (!settings.reviewModelId || !settings.modelLibrary?.length) return undefined;
  const model = settings.modelLibrary.find((item) => item.id === settings.reviewModelId);
  if (!model) return undefined;
  return { provider: model.provider, apiHost: model.apiHost, apiKey: model.apiKey, model: model.model, contextWindowTokens: model.contextWindowTokens };
}

function configuredModelById(id?: string): ModelConfig | undefined {
  const settings = loadSettings();
  if (!id || !settings.modelLibrary?.length) return undefined;
  const model = settings.modelLibrary.find((item) => item.id === id);
  if (!model) return undefined;
  return {
    provider: model.provider,
    apiHost: model.apiHost,
    apiKey: model.apiKey,
    model: model.model,
    contextWindowTokens: model.contextWindowTokens,
    refModelId: model.id,
  };
}

/** The diagnostic center requires an explicit model assignment. */
export function getDiagnosticModel(): ModelConfig | undefined {
  return configuredModelById(loadSettings().diagnosticModelId);
}

/** Image generation never silently falls back to a chat model. */
export function getImageGenerationModel(): ModelConfig | undefined {
  return configuredModelById(loadSettings().imageModelId);
}

/** 员工是否启用了独立模型。旧版数据没有开关字段时兼容已有 modelConfig。 */
export function usesCustomEmployeeModel(employee: Employee): boolean {
  return employee.useCustomModel ?? !!employee.modelConfig;
}

/** 获取员工实际使用的模型；未开启独立配置时始终继承全局激活模型。 */
export function getEmployeeModel(employee: Employee): ModelConfig {
  const active = getActiveModel();
  if (!usesCustomEmployeeModel(employee) || !employee.modelConfig) return active;

  const custom = employee.modelConfig;
  const settings = loadSettings();
  if (custom.refModelId && settings.modelLibrary) {
    const referenced = settings.modelLibrary.find((model) => model.id === custom.refModelId);
    if (referenced) {
      return {
        provider: referenced.provider ?? active.provider,
        apiHost: referenced.apiHost ?? active.apiHost,
        apiKey: referenced.apiKey ?? active.apiKey,
        model: referenced.model ?? active.model,
        contextWindowTokens: referenced.contextWindowTokens ?? active.contextWindowTokens,
        refModelId: custom.refModelId,
      };
    }
  }

  return {
    provider: custom.provider ?? active.provider,
    apiHost: custom.apiHost ?? active.apiHost,
    apiKey: custom.apiKey ?? active.apiKey,
    model: custom.model ?? active.model,
    contextWindowTokens: custom.contextWindowTokens ?? active.contextWindowTokens,
  };
}

export interface ModelConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  endpoint: string;
  httpStatus?: number;
}

export interface ModelListResult {
  ok: boolean;
  models: string[];
  message: string;
  endpoint: string;
}

function apiErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return String(parsed?.error?.message ?? parsed?.message ?? raw).slice(0, 500);
  } catch {
    return raw.trim().slice(0, 500) || '服务端未返回错误详情';
  }
}

/** 使用真实的最小聊天请求测试模型，而不是只探测可能无关的 /models。 */
export async function testModelConnection(mc: ModelConfig): Promise<ModelConnectionTestResult> {
  const base = (mc.apiHost ?? '').trim().replace(/\/+$/, '');
  const endpoint = base ? endpointUrl(base, '/chat/completions') : '';
  if (!base) return { ok: false, message: '请先填写 API 地址', latencyMs: 0, endpoint };
  const model = mc.model?.trim() || getProvider(mc.provider).defaultModel;
  if (!model) return { ok: false, message: '请先填写模型名称', latencyMs: 0, endpoint };
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (mc.apiKey) headers['Authorization'] = `Bearer ${mc.apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '连接测试：请只回复 OK' }],
        stream: false,
      }),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}：${apiErrorMessage(raw)}`, latencyMs, endpoint, httpStatus: res.status };
    }
    let data: any;
    try { data = JSON.parse(raw); } catch {
      return { ok: false, message: 'HTTP 200，但响应不是有效 JSON', latencyMs, endpoint, httpStatus: res.status };
    }
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      return { ok: false, message: 'HTTP 200，但模型没有返回可用的聊天内容', latencyMs, endpoint, httpStatus: res.status };
    }
    return { ok: true, message: `聊天调用成功 · ${latencyMs} ms · HTTP ${res.status}`, latencyMs, endpoint, httpStatus: res.status };
  } catch (e: any) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = e?.name === 'AbortError'
      ? `请求超时：20 秒内模型没有返回结果`
      : `网络错误：${e?.message ?? '无法连接模型服务'}`;
    return { ok: false, message, latencyMs, endpoint };
  } finally {
    clearTimeout(timer);
  }
}

/** 迁移旧设置到 modelLibrary（如果还没有） */
export function migrateToModelLibrary(): void {
  const s = loadSettings();
  if (s.modelLibrary && s.modelLibrary.length > 0) return; // 已有库，不迁移
  if (!s.apiHost && !s.model) return; // 旧字段也空，不需要迁移
  const entry: ModelEntry = {
    id: `model-${Date.now()}`,
    label: s.model || getProvider(s.provider).defaultModel || '默认模型',
    provider: s.provider,
    apiHost: s.apiHost,
    apiKey: s.apiKey,
    model: s.model,
  };
  s.modelLibrary = [entry];
  s.activeModelId = entry.id;
  saveSettings(s);
}

// ===== 用户长期记忆 =====
const LS_USER_MEMORY = 'hermes_office_user_memory';
const LS_USER_PROFILE = 'hermes_office_user_profile';
const MAX_MEMORY_ITEMS = 100;

export type UserMemoryCategory = 'identity' | 'preference' | 'constraint' | 'workflow' | 'decision' | 'project';

export interface UserMemoryItem {
  ts: number;           // 记录时间
  content: string;      // 记忆内容（如"用户偏好红色主题"）
  source: string;       // 来源（如"私聊-张三"、"助手对话"）
  category?: UserMemoryCategory;
  importance?: number;  // 1-5，决定上下文注入和容量淘汰优先级
  confidence?: number;  // 0-1，仅保留明确、可验证的信息
  updatedAt?: number;
  fingerprint?: string;
}

const MEMORY_CATEGORY_LABELS: Record<UserMemoryCategory, string> = {
  identity: '身份背景',
  preference: '长期偏好',
  constraint: '明确约束',
  workflow: '工作习惯',
  decision: '长期决策',
  project: '项目背景',
};

export const USER_MEMORY_CATEGORY_LABELS = MEMORY_CATEGORY_LABELS;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeMemoryText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^(用户|老板|该用户)[：:，,\s]*/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function memoryFingerprint(text: string): string {
  const normalized = normalizeMemoryText(text);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function memoryTokens(text: string): Set<string> {
  const normalized = normalizeMemoryText(text);
  const tokens = new Set<string>();
  const latinWords = text.toLowerCase().match(/[a-z0-9][a-z0-9._+-]*/g) ?? [];
  latinWords.forEach((word) => tokens.add(word));
  for (let i = 0; i < normalized.length - 1; i += 1) tokens.add(normalized.slice(i, i + 2));
  if (normalized.length === 1) tokens.add(normalized);
  return tokens;
}

function memorySimilarity(a: string, b: string): number {
  const na = normalizeMemoryText(a);
  const nb = normalizeMemoryText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if ((na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) / Math.max(na.length, nb.length) >= 0.72) return 0.9;
  const left = memoryTokens(a);
  const right = memoryTokens(b);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function inferMemoryCategory(content: string): UserMemoryCategory {
  if (/(必须|不能|不要|禁止|务必|每次|一律|约束|要求)/u.test(content)) return 'constraint';
  if (/(偏好|喜欢|倾向|风格|希望|更喜欢)/u.test(content)) return 'preference';
  if (/(流程|习惯|先.+再|工作方式|验收|测试|提交|发布)/u.test(content)) return 'workflow';
  if (/(决定|确定|以后|长期|统一|采用|改为)/u.test(content)) return 'decision';
  if (/(项目|产品|仓库|版本|应用|团队)/u.test(content)) return 'project';
  return 'identity';
}

function normalizeMemoryItem(item: UserMemoryItem): UserMemoryItem | null {
  const content = String(item?.content ?? '').trim();
  if (!content) return null;
  const ts = Number.isFinite(item.ts) ? item.ts : Date.now();
  const category = Object.hasOwn(MEMORY_CATEGORY_LABELS, item.category ?? '')
    ? item.category as UserMemoryCategory
    : inferMemoryCategory(content);
  return {
    ts,
    content: content.slice(0, 240),
    source: String(item.source || '历史记忆'),
    category,
    importance: clamp(Math.round(Number(item.importance) || 3), 1, 5),
    confidence: clamp(Number(item.confidence) || (item.source === '手动添加' ? 1 : 0.8), 0, 1),
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : ts,
    fingerprint: memoryFingerprint(content),
  };
}

function mergeMemorySources(a: string, b: string): string {
  return [...new Set([...a.split('、'), ...b.split('、')].filter(Boolean))].slice(-3).join('、');
}

function trimMemoryCapacity(items: UserMemoryItem[]): UserMemoryItem[] {
  if (items.length <= MAX_MEMORY_ITEMS) return items;
  const ranked = [...items].sort((a, b) => {
    const scoreA = (a.importance ?? 3) * 20 + (a.confidence ?? 0.8) * 10 + (a.updatedAt ?? a.ts) / 1e12;
    const scoreB = (b.importance ?? 3) * 20 + (b.confidence ?? 0.8) * 10 + (b.updatedAt ?? b.ts) / 1e12;
    return scoreB - scoreA;
  }).slice(0, MAX_MEMORY_ITEMS);
  return ranked.sort((a, b) => a.ts - b.ts);
}

export function organizeUserMemory(items: UserMemoryItem[] = loadUserMemory()): UserMemoryItem[] {
  const organized: UserMemoryItem[] = [];
  for (const raw of items) {
    const item = normalizeMemoryItem(raw);
    if (!item) continue;
    const duplicateIndex = organized.findIndex((existing) =>
      existing.fingerprint === item.fingerprint ||
      (existing.category === item.category && memorySimilarity(existing.content, item.content) >= 0.82));
    if (duplicateIndex < 0) {
      organized.push(item);
      continue;
    }
    const existing = organized[duplicateIndex];
    const preferIncoming = (item.updatedAt ?? item.ts) >= (existing.updatedAt ?? existing.ts) && item.content.length >= existing.content.length * 0.75;
    organized[duplicateIndex] = {
      ...(preferIncoming ? item : existing),
      ts: Math.min(existing.ts, item.ts),
      updatedAt: Math.max(existing.updatedAt ?? existing.ts, item.updatedAt ?? item.ts),
      importance: Math.max(existing.importance ?? 3, item.importance ?? 3),
      confidence: Math.max(existing.confidence ?? 0.8, item.confidence ?? 0.8),
      source: mergeMemorySources(existing.source, item.source),
    };
  }
  return trimMemoryCapacity(organized);
}

export function loadUserMemory(): UserMemoryItem[] {
  try {
    const raw = localStorage.getItem(LS_USER_MEMORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizeMemoryItem).filter((item): item is UserMemoryItem => Boolean(item)) : [];
    }
  } catch {}
  return [];
}
export function saveUserMemory(items: UserMemoryItem[]): void {
  try {
    localStorage.setItem(LS_USER_MEMORY, JSON.stringify(trimMemoryCapacity(items.map(normalizeMemoryItem).filter((item): item is UserMemoryItem => Boolean(item)))));
  } catch {}
}
export function upsertUserMemory(item: UserMemoryItem, replaces?: string): { action: 'added' | 'updated' | 'ignored'; items: UserMemoryItem[] } {
  const list = loadUserMemory();
  const incoming = normalizeMemoryItem(item);
  if (!incoming) return { action: 'ignored', items: list };
  let matchIndex = replaces
    ? list.findIndex((existing) => memorySimilarity(existing.content, replaces) >= 0.72)
    : -1;
  if (matchIndex < 0) {
    matchIndex = list.findIndex((existing) =>
      existing.fingerprint === incoming.fingerprint ||
      (existing.category === incoming.category && memorySimilarity(existing.content, incoming.content) >= 0.82));
  }
  if (matchIndex >= 0) {
    const existing = list[matchIndex];
    if (existing.fingerprint === incoming.fingerprint) {
      return { action: 'ignored', items: list };
    }
    list[matchIndex] = {
      ...incoming,
      ts: existing.ts,
      updatedAt: Date.now(),
      source: mergeMemorySources(existing.source, incoming.source),
    };
    saveUserMemory(list);
    return { action: 'updated', items: loadUserMemory() };
  }
  list.push(incoming);
  saveUserMemory(list);
  return { action: 'added', items: loadUserMemory() };
}
export function appendUserMemory(item: UserMemoryItem): void {
  upsertUserMemory(item);
}

export function loadUserProfile(): string {
  try {
    return localStorage.getItem(LS_USER_PROFILE) ?? '';
  } catch { return ''; }
}
export function saveUserProfile(text: string): void {
  try {
    localStorage.setItem(LS_USER_PROFILE, text);
  } catch {}
}

// 构建用户上下文字符串（供注入系统提示用）
export function buildUserContext(query = ''): string {
  const profile = loadUserProfile().trim();
  const memory = loadUserMemory();
  let ctx = '';
  if (profile) {
    ctx += `## 用户画像\n${profile}\n\n`;
  }
  if (memory.length > 0) {
    const selected: UserMemoryItem[] = [];
    const now = Date.now();
    const ranked = [...memory].sort((a, b) => {
      const score = (item: UserMemoryItem) => {
        const relevance = query.trim() ? memorySimilarity(query, item.content) * 100 : 0;
        const importance = (item.importance ?? 3) * 8;
        const confidence = (item.confidence ?? 0.8) * 5;
        const recency = Math.max(0, 5 - (now - (item.updatedAt ?? item.ts)) / (90 * 24 * 60 * 60 * 1000));
        return relevance + importance + confidence + recency;
      };
      return score(b) - score(a);
    });
    if (!query.trim()) {
      for (const category of Object.keys(MEMORY_CATEGORY_LABELS) as UserMemoryCategory[]) {
        const candidate = ranked.find((item) => item.category === category && (item.confidence ?? 0.8) >= 0.65);
        if (candidate) selected.push(candidate);
      }
    } else {
      for (const item of ranked) {
        if (selected.length >= 8) break;
        if ((item.confidence ?? 0.8) >= 0.65 && memorySimilarity(query, item.content) >= 0.08) selected.push(item);
      }
    }
    for (const item of ranked) {
      if (selected.length >= 12) break;
      if (!selected.includes(item) && (item.confidence ?? 0.8) >= 0.65) selected.push(item);
    }
    const important = selected.map(m => `- [${MEMORY_CATEGORY_LABELS[m.category ?? 'identity']}] ${m.content}`).join('\n');
    ctx += `## 经筛选的长期记忆（${selected.length} 条）\n${important}\n`;
  }
  return ctx;
}

// ===== 自动提炼用户习惯/思维模式 =====
/**
 * 用 LLM 分析一段对话，提炼出关于用户的新认知（习惯、偏好、思维模式），
 * 追加到长期记忆中，并更新用户画像。
 * @param conversation 对话文本（如多条消息拼接）
 * @param source 来源描述
 */
export async function extractUserInsights(conversation: string, source: string): Promise<void> {
  if (!conversation.trim()) return;
  // 只处理显著长度的对话（至少 3 轮）
  const lines = conversation.split('\n').filter(Boolean);
  if (lines.length < 6) return;

  const existingProfile = loadUserProfile();
  const existingMemory = [...loadUserMemory()]
    .sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3) || (b.updatedAt ?? b.ts) - (a.updatedAt ?? a.ts))
    .slice(0, 20)
    .map(m => `[${MEMORY_CATEGORY_LABELS[m.category ?? 'identity']}] ${m.content}`)
    .join('\n');

  try {
    const r = await chatCompletion([
      { role: 'system', content: `你是用户洞察分析师。分析以下对话，提取关于这个用户的新认知。

已有用户画像：${existingProfile || '（无）'}
已有记忆：${existingMemory || '（无）'}

请以 JSON 格式回复：
{
  "memories": [
    {
      "content": "一条脱离当前对话后仍然有用的长期事实",
      "category": "identity|preference|constraint|workflow|decision|project",
      "importance": 1,
      "confidence": 0.9,
      "action": "add|update|ignore",
      "replaces": "更新时填写被替代的旧记忆原文，否则留空"
    }
  ]
}

注意：
- 只分析用户本人明确表达的内容，不把助理或员工的回复当成用户事实
- 仅记录稳定身份背景、长期偏好、明确约束、反复出现的工作流程或已确认的长期决策
- 不记录一次性任务、临时指令、闲聊、情绪宣泄、未确认推测、工具状态、错误信息和助理自己的判断
- 与已有记忆表达相同则 action=ignore；新信息明确取代旧信息时 action=update 并填写 replaces
- 每条 10-60 字，必须具体、可验证；importance 为 1-5，confidence 为 0-1
- 不能仅凭一次含糊表达推断性格或偏好；不确定时不要记录
- 如果没有值得长期保留的信息，memories 返回空数组
- 用中文回复` },
      { role: 'user', content: `对话记录（${source}）：\n\n${conversation.slice(0, 3000)}` },
    ], 'extract', '用户洞察提炼');
    if (!r.content) return;

    // 尝试解析 JSON
    const jsonMatch = r.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const data = JSON.parse(jsonMatch[0]);

    if (Array.isArray(data.memories) && data.memories.length > 0) {
      const now = Date.now();
      for (const memory of data.memories.slice(0, 6)) {
        if (!memory || typeof memory.content !== 'string' || memory.action === 'ignore') continue;
        const confidence = clamp(Number(memory.confidence) || 0, 0, 1);
        if (confidence < 0.65) continue;
        upsertUserMemory({
          ts: now,
          content: memory.content,
          source,
          category: Object.hasOwn(MEMORY_CATEGORY_LABELS, memory.category) ? memory.category : inferMemoryCategory(memory.content),
          importance: clamp(Math.round(Number(memory.importance) || 3), 1, 5),
          confidence,
          updatedAt: now,
        }, memory.action === 'update' && typeof memory.replaces === 'string' ? memory.replaces : undefined);
      }
    }
  } catch {
    // 静默失败——提炼是辅助功能，不影响主流程
  }
}

// 拼接完整 API base URL（base_url 已含版本/路径段，直接规整返回）
export function resolveApiBase(s: AppSettings = loadSettings()): string {
  const host = (s.apiHost ?? '').trim().replace(/\/+$/, '');
  return host;
}

// ===== 合并员工模型配置与全局设置 =====
/**
 * 解析聊天用的模型配置，三阶回退：
 * 1. 员工独立配置 (empConfig)
 * 2. 助理机器人配置 (getAssistantModel)
 * 3. 全局设置 (getActiveModel)
 */
export function resolveChatSettings(empConfig?: ModelConfig): AppSettings {
  const global = loadSettings();
  const activeMc = getActiveModel();
  const assistantMc = getAssistantModel();

  // 如果员工配置是引用模式，从 modelLibrary 解析
  if (empConfig?.refModelId && global.modelLibrary) {
    const ref = global.modelLibrary.find(m => m.id === empConfig.refModelId);
    if (ref) {
      return {
        provider: ref.provider ?? global.provider,
        apiHost: ref.apiHost ?? global.apiHost,
        apiKey: ref.apiKey ?? global.apiKey,
        model: ref.model ?? global.model,
        contextWindowTokens: ref.contextWindowTokens,
        autoDiscuss: global.autoDiscuss,
      };
    }
  }

  if (!empConfig) {
    // 没有员工配置：回退到助理配置 → 全局
    if (assistantMc.apiHost || assistantMc.model) {
      return {
        provider: assistantMc.provider ?? global.provider,
        apiHost: assistantMc.apiHost ?? global.apiHost,
        apiKey: assistantMc.apiKey ?? global.apiKey,
        model: assistantMc.model ?? global.model,
        contextWindowTokens: assistantMc.contextWindowTokens,
        autoDiscuss: global.autoDiscuss,
      };
    }
    return global;
  }
  // 有员工配置：员工优先 → 助理 → 全局
  return {
    provider: empConfig.provider ?? assistantMc.provider ?? activeMc.provider ?? global.provider,
    apiHost: empConfig.apiHost ?? assistantMc.apiHost ?? activeMc.apiHost ?? global.apiHost,
    apiKey: empConfig.apiKey ?? assistantMc.apiKey ?? activeMc.apiKey ?? global.apiKey,
    model: empConfig.model ?? assistantMc.model ?? activeMc.model ?? global.model,
    contextWindowTokens: empConfig.contextWindowTokens ?? assistantMc.contextWindowTokens ?? activeMc.contextWindowTokens,
    autoDiscuss: global.autoDiscuss,
  };
}

// 拼接某端点完整 URL：base 已含 /v1 或 /v4 等版本段则直接拼，否则自动补 /v1
function endpointUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  if (/\/v\d+(\/|$)/.test(b)) return `${b}${p}`; // 已含版本段
  return `${b}/v1${p}`;
}

// 带超时的 fetch（含 API key，可选覆盖 base 和 key）
async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = 4000, overrideKey?: string, overrideBase?: string, externalSignal?: AbortSignal): Promise<Response> {
  const base = overrideBase ?? resolveApiBase();
  if (!base) throw new Error('no api base');
  const url = endpointUrl(base, path);
  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  const abortFromExternal = () => {
    externallyAborted = true;
    controller.abort();
  };
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException(`模型请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回`, 'TimeoutError'));
  }, timeoutMs);
  const s = loadSettings();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const key = overrideKey ?? s.apiKey;
  if (key) headers['Authorization'] = `Bearer ${key}`;
  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    return res;
  } catch (e) {
    if (timedOut) throw new Error(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）。请检查模型服务负载、网络或稍后重试。`);
    if (externallyAborted) {
      const interruption = new Error('模型请求已被新的运行中指令中断。');
      interruption.name = 'ExternalAbortError';
      throw interruption;
    }
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('模型请求已取消。');
    throw e;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

export interface GeneratedAvatarImage {
  dataUrl: string;
  model: string;
  revisedPrompt?: string;
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('生成图片读取失败'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });
}

/** Generate one square employee portrait through an explicitly assigned image model. */
export async function generateEmployeeAvatarImage(prompt: string, modelConfig = getImageGenerationModel()): Promise<GeneratedAvatarImage> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error('请先填写头像描述');
  if (!modelConfig?.apiHost?.trim() || !modelConfig.model?.trim()) throw new Error('还没有配置头像生图模型，请先在模型库中指定一个生图模型');
  const base = resolveApiBase(modelConfig as AppSettings);
  const model = modelConfig.model.trim();
  const response = await apiFetch('/images/generations', {
    method: 'POST',
    body: JSON.stringify({ model, prompt: cleanPrompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
  }, 180000, modelConfig.apiKey, base);
  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`生图接口返回 ${response.status}：${apiErrorMessage(raw)}`);
  let payload: any;
  try { payload = JSON.parse(raw); }
  catch { throw new Error('生图接口返回的不是有效 JSON'); }
  const result = parseGeneratedAvatarPayload(payload);
  if (result.kind === 'data') return { dataUrl: result.dataUrl, model, revisedPrompt: result.revisedPrompt };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const downloaded = await fetch(result.url, { signal: controller.signal });
    if (!downloaded.ok) throw new Error(`生成图片下载失败（HTTP ${downloaded.status}）`);
    const blob = await downloaded.blob();
    if (!blob.type.startsWith('image/')) throw new Error('生图地址返回的不是图片');
    if (blob.size > 10 * 1024 * 1024) throw new Error('生成图片超过 10MB，请在生图服务中降低图片尺寸');
    return { dataUrl: await blobAsDataUrl(blob), model, revisedPrompt: result.revisedPrompt };
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('生成图片下载超过 60 秒，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 读取 OpenAI 兼容服务的模型列表，用于设置页免手填模型 ID。 */
export async function fetchAvailableModels(mc: ModelConfig): Promise<ModelListResult> {
  const base = (mc.apiHost ?? '').trim().replace(/\/+$/, '');
  const endpoint = base ? endpointUrl(base, '/models') : '';
  if (!base) return { ok: false, models: [], message: '请先填写 API 地址', endpoint };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (mc.apiKey) headers.Authorization = `Bearer ${mc.apiKey}`;
    const response = await fetch(endpoint, { headers, signal: controller.signal });
    const raw = await response.text().catch(() => '');
    if (!response.ok) return { ok: false, models: [], message: `HTTP ${response.status}：${apiErrorMessage(raw)}`, endpoint };
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return { ok: false, models: [], message: '模型列表响应不是有效 JSON', endpoint }; }
    const records = Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray(payload) ? payload : [];
    const models = [...new Set(records.map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return String((item as { id?: unknown; name?: unknown; model?: unknown }).id ?? (item as { name?: unknown }).name ?? (item as { model?: unknown }).model ?? '').trim();
      return '';
    }).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (models.length === 0) return { ok: false, models: [], message: '接口返回成功，但未找到可用模型 ID', endpoint };
    return { ok: true, models, message: `已获取 ${models.length} 个模型`, endpoint };
  } catch (error: any) {
    return { ok: false, models: [], message: error?.name === 'AbortError' ? '获取模型列表超时（15 秒）' : `网络错误：${error?.message ?? '无法连接服务'}`, endpoint };
  } finally {
    clearTimeout(timer);
  }
}

// ===== 探测后端 =====
export async function checkBackend(): Promise<boolean> {
  const result = await testModelConnection(getActiveModel());
  _backendOnline = result.ok;
  return result.ok;
}

// 测试连接（供设置面板用，返回详细结果）
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const result = await testModelConnection(getActiveModel());
  return { ok: result.ok, message: `${result.message}${result.endpoint ? `（${result.endpoint}）` : ''}` };
}

// ===== OpenAI 兼容聊天补全 =====
export interface ContentPart {
  type: 'text';
  text?: string;
}
export interface ImagePart {
  type: 'image_url';
  image_url: { url: string }; // data URL: data:image/png;base64,...
}
export type ChatContent = string | (ContentPart | ImagePart)[];

/** 用户上传/粘贴的附件 */
export interface Attachment {
  name: string;
  mime: string;
  /** 图片/文本类的 base64 data URL 或纯文本；文件类可为空（仅保存为产出物） */
  dataUrl?: string;
  size: number;
  kind: 'image' | 'text' | 'file';
  /** 二进制或文本附件成功写入当前聊天工作区后的相对路径 */
  workspacePath?: string;
  persistenceError?: string;
}

export interface ChatTurn { role: 'system' | 'user' | 'assistant' | 'tool'; content: ChatContent; tool_call_id?: string; name?: string; }

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
export interface ContextUsage {
  /** 本次真正送到模型的输入 token 数。 */
  promptTokens: number;
  /** 用户在模型库填写的官方上下文长度；没有可靠来源时不填。 */
  contextWindowTokens?: number;
  /** 服务端提供的真实用量，或客户端基于发送内容的估算。 */
  source: 'api' | 'estimate';
}
export interface ToolCallResult {
  id: string;
  name: string;
  arguments: string;  // JSON string
}
export interface ChatResult {
  content: string | null;        // null = 模型返回了 tool_calls 无文本
  usage: TokenUsage;
  contextUsage: ContextUsage;
  model: string;
  toolCalls?: ToolCallResult[];  // function-calling 返回的工具调用
}

export interface ChatCompletionRequestOptions {
  /** 默认 auto；任务编译等内核调用可强制指定一个函数。 */
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** 当前请求独立超时，不影响普通长任务的默认五分钟。 */
  timeoutMs?: number;
  /** 内核分类调用可关闭自动用户记忆注入，改用显式筛选后的上下文。 */
  injectUserContext?: boolean;
}

// ===== Token 消耗日志 =====
export interface TokenLogEntry {
  ts: number;           // 时间戳
  model: string;        // 模型名
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  scene: string;        // 场景：dm / team
  label?: string;       // 备注（如员工名/团队名）
}
const LS_TOKENLOG = 'hermes_office_tokenlog';
const MAX_TOKENLOG = 2000;

export function loadTokenLog(): TokenLogEntry[] {
  try {
    const raw = localStorage.getItem(LS_TOKENLOG);
    if (raw) return JSON.parse(raw) as TokenLogEntry[];
  } catch {}
  return [];
}
function appendTokenLog(e: TokenLogEntry): void {
  try {
    const list = loadTokenLog();
    list.push(e);
    localStorage.setItem(LS_TOKENLOG, JSON.stringify(list.slice(-MAX_TOKENLOG)));
  } catch {}
}
export function clearTokenLog(): void {
  try { localStorage.removeItem(LS_TOKENLOG); } catch {}
}

/**
 * 调 OpenAI 兼容 /v1/chat/completions。
 * @param modelConfig 可选员工独立模型配置，覆盖全局设置
 * @returns { content, usage, model }；失败抛错（调用方回落本地剧本）
 * 成功时自动把 token 消耗记入 tokenLog。
 */
export async function chatCompletion(
  turns: ChatTurn[],
  scene: string = 'dm',
  label?: string,
  tools?: any[],
  modelConfig?: ModelConfig,  // 新增参数：员工独立模型配置
  extraSystemContext?: string,  // 额外的系统上下文（如 soul.md）
  attachments?: Attachment[],   // 用户上传/粘贴的附件（图片走多模态视觉）
  requestSignal?: AbortSignal,  // 运行中收到新要求时，仅中断当前模型请求并重新规划
  requestOptions: ChatCompletionRequestOptions = {},
): Promise<ChatResult> {
  const merged = resolveChatSettings(modelConfig); // 合并配置
  const base = resolveApiBase(merged);
  if (!base) throw new Error('未配置 API');
  const model = merged.model?.trim() || getProvider(merged.provider).defaultModel || 'gpt-4o-mini';

  // 注入与当前问题相关的长期记忆和画像；内核调用可显式关闭，避免重复污染分类输入。
  const latestUserQuery = [...turns].reverse().find((turn) => turn.role === 'user');
  const latestUserQueryText = typeof latestUserQuery?.content === 'string'
    ? latestUserQuery.content
    : (latestUserQuery?.content ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text ?? '').join('\n');
  const userCtx = requestOptions.injectUserContext === false ? '' : buildUserContext(latestUserQueryText);
  let finalTurns = turns.map(t => ({ ...t }));
  if (userCtx || extraSystemContext) {
    // 找到第一条 system 消息，追加用户上下文和 extraSystemContext
    const sysIdx = finalTurns.findIndex(t => t.role === 'system');
    if (sysIdx >= 0) {
      const sysContent = finalTurns[sysIdx].content;
      // 系统提示内容仅支持 string 形式注入
      let sys = typeof sysContent === 'string' ? sysContent : '';
      if (extraSystemContext) {
        sys += `\n\n## 扩展上下文\n${extraSystemContext.slice(0, 160000)}`;
      }
      if (userCtx) {
        sys += `\n\n## 关于当前用户\n${userCtx}\n（用户画像是用户主动确认的高优先级事实；长期记忆已经过筛选。不要自行声称“已记录”，记忆写入由独立提炼流程负责。）`;
      }
      finalTurns = finalTurns.map((t, i) => i === sysIdx ? { ...t, content: sys } : t);
    } else {
      // 没有 system 消息则新建一条
      let content = '';
      if (extraSystemContext) content += `## 扩展上下文\n${extraSystemContext.slice(0, 160000)}\n\n`;
      if (userCtx) content += `## 关于当前用户\n${userCtx}\n`;
      if (content) finalTurns.unshift({ role: 'system', content });
    }
  }

  // 多模态附件：把最后一条 user 消息转为 [text, image_url] 数组
  if (attachments && attachments.length > 0) {
    const lastUserIdx = finalTurns.map(t => t.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      const t = finalTurns[lastUserIdx];
      const textPart: ContentPart = { type: 'text', text: typeof t.content === 'string' ? t.content : '' };
      const imageParts: ImagePart[] = attachments
        .filter(a => a.kind === 'image' && a.dataUrl)
        .map(a => ({ type: 'image_url', image_url: { url: a.dataUrl! } }));
      if (imageParts.length > 0) {
        finalTurns = finalTurns.map((turn, i) =>
          i === lastUserIdx ? { ...turn, content: [textPart, ...imageParts] } : turn
        );
      }
    }
  }
  const res = await apiFetch('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: finalTurns,
      stream: false,
      ...(tools && tools.length > 0 ? { tools, tool_choice: requestOptions.toolChoice ?? 'auto' } : {}),
    }),
  }, requestOptions.timeoutMs ?? 300000, merged.apiKey, base, requestSignal); // Long-running model/tool requests may take minutes on a busy provider.
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`模型响应 ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message ?? {};
  const content: string | null = typeof msg.content === 'string' && msg.content.trim() ? msg.content.trim() : null;
  const u = data?.usage ?? {};
  const apiPromptTokens = Number.isFinite(Number(u.prompt_tokens)) ? Number(u.prompt_tokens) : undefined;
  const usage: TokenUsage = {
    promptTokens: apiPromptTokens ?? estimateTokens(finalTurns.map((t) => typeof t.content === 'string' ? t.content : t.content.map((part) => part.type === 'text' ? part.text ?? '' : '[图片]').join('\n')).join('')),
    completionTokens: u.completion_tokens ?? (content ? estimateTokens(content) : 50),
    totalTokens: u.total_tokens ?? 0,
  };
  if (!usage.totalTokens) usage.totalTokens = usage.promptTokens + usage.completionTokens;
  const contextWindowTokens = Number(merged.contextWindowTokens);
  const contextUsage: ContextUsage = {
    promptTokens: usage.promptTokens,
    contextWindowTokens: Number.isFinite(contextWindowTokens) && contextWindowTokens > 0 ? Math.round(contextWindowTokens) : undefined,
    source: apiPromptTokens === undefined ? 'estimate' : 'api',
  };
  // 记账（简化：单行 append 以避免匹配问题）
  appendTokenLog({ ts: Date.now(), model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, scene, label });
  let toolCalls: ToolCallResult[] | undefined;
  if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    toolCalls = msg.tool_calls.map((tc: any) => ({
      id: tc.id ?? `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '{}',
    }));
  }
  if (!content && !toolCalls) throw new Error('模型返回为空');
  return { content, usage, contextUsage, model, toolCalls };
}

/**
 * 长任务的模型摘要只负责导航，不改变结构化事实、验收结果或未决问题。
 * 模型不可用时返回 null，调用方继续使用确定性压缩摘要。
 */
export async function summarizeTaskContext(
  snapshot: TaskContextSnapshot,
  modelConfig: ModelConfig = getAssistantModel(),
): Promise<TaskModelSummaryProposal | null> {
  const context = restoreTaskContext(snapshot);
  if (!resolveApiBase(modelConfig) || context.events.length === 0) return null;
  try {
    const result = await chatCompletion([
      {
        role: 'system',
        content: '你是任务上下文压缩器。只根据提供的结构化记录，用中文输出一段不超过500字的事实摘要。说明目标、已完成且已验证的结果、交付文件、未决问题和建议继续位置。不要补充记录中没有的事实，不要输出思考过程、标题、Markdown或JSON。',
      },
      { role: 'user', content: buildTaskSummaryMaterial(context) },
    ], 'task-context-summary', '长任务摘要', undefined, modelConfig, undefined, undefined, undefined, {
      toolChoice: 'none',
      timeoutMs: 90000,
      injectUserContext: false,
    });
    const narrative = result.content?.trim().slice(0, 1600);
    if (!narrative) return null;
    return { narrative, modelName: result.model, sourceEventCount: context.summary.sourceEventCount };
  } catch {
    return null;
  }
}

// 粗略估算 token（中文≈1.5字/token，英文≈4字符/token）
function estimateTokens(text: string): number {
  let n = 0;
  for (const ch of text) {
    n += /[一-鿿]/.test(ch) ? 0.67 : 0.25;
  }
  return Math.max(1, Math.round(n));
}

/** A successful transport response is not always useful progress for the task. */
function isUsefulToolOutcome(name: string, success: boolean, output: string, goal = ''): boolean {
  if (!success || !isToolResultSuccessful(output, success)) return false;
  if (name === 'search_skills') return !/没有找到.{0,80}(?:技能|匹配)|技能库为空/u.test(output);
  if (name === 'web_search') return !/未找到直接结果|API 暂时不可用|搜索 API/u.test(output)
    && (!goal || isResearchEvidenceRelevant(goal, output));
  return true;
}

/** Connector intent is a capability class, not a special case for one provider. */
export function isConnectorTask(userText: string): boolean {
  if (isKnowledgeDirectoryReadRequest(userText)) return false;
  return /连接器|知识库|外部服务|(?:^|[^a-z])mcp(?:[^a-z]|$)|obsidian|(?:^|[^a-z])ima(?:[^a-z]|$)|(?:GitHub|邮箱|企业微信|腾讯文档).{0,24}(?:连接|配置|关联|绑定|接入|调用)/iu.test(userText);
}

function isKnowledgeDirectoryReadRequest(userText: string): boolean {
  return /(?:查看|读取|列出|浏览|统计|查询|查找).{0,12}(?:obsidian|知识库|vault).{0,24}(?:目录|文件夹|笔记|条目|清单|列表|多少)/iu.test(userText);
}

export function isConnectorSetupRequest(userText: string): boolean {
  return isConnectorTask(userText) && /安装|配置|添加|接入|连接|关联|绑定|启用|设置|装好|装上|验证|测试|检查|诊断|连通|可用|能不能用/iu.test(userText);
}

export function isConnectorVerificationOnlyRequest(userText: string): boolean {
  return isConnectorTask(userText)
    && /验证|测试|检查|诊断|连通|可用|能不能用/iu.test(userText)
    && !/搜索|查询(?:内容|资料|文档|笔记)|上传|下载|创建|新建|写入|追加|删除|导出|同步|发送|读取(?:内容|正文)|列出/iu.test(userText);
}

export async function compileTaskDecision(
  turns: ChatTurn[],
  tools: any[],
  modelConfig?: ModelConfig,
  requestSignal?: AbortSignal,
): Promise<{ decision: TaskDecision; usage: TokenUsage; contextUsage?: ContextUsage; model?: string }> {
  const userTurns = turns.filter((turn) => turn.role === 'user').map((turn) => typeof turn.content === 'string'
    ? turn.content
    : (turn.content ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text ?? '').join('\n'));
  const latestMessage = userTurns.at(-1) ?? '';
  const previousUserMessage = userTurns.at(-2) ?? '';
  const availableTools = tools.map((tool) => String(tool?.function?.name ?? '')).filter(Boolean);
  const fallback = createFallbackTaskDecision({ latestMessage, previousUserMessage, availableTools });
  const relevantTaskExperience = buildTaskLearningContext(fallback.goal);
  const recentHistory = turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').slice(-8).map((turn) => ({
    role: turn.role,
    content: typeof turn.content === 'string'
      ? turn.content
      : (turn.content ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text ?? '').join('\n'),
  }));
  const input = {
    latestMessage,
    previousUserMessage,
    availableTools,
    recentHistory,
    relevantUserContext: buildUserContext(fallback.goal),
    relevantTaskExperience,
  };
  try {
    const response = await chatCompletion(
      buildTaskDecisionMessages(input) as ChatTurn[],
      'task-decision',
      '任务决策内核',
      [TASK_DECISION_TOOL],
      modelConfig,
      undefined,
      undefined,
      requestSignal,
      {
        toolChoice: { type: 'function', function: { name: TASK_DECISION_TOOL_NAME } },
        timeoutMs: 45000,
        injectUserContext: false,
      },
    );
    let candidate = parseTaskDecisionToolCall(response.toolCalls);
    if (!candidate && response.content) {
      const json = response.content.match(/\{[\s\S]*\}/)?.[0];
      if (json) candidate = JSON.parse(json) as Record<string, unknown>;
    }
    return {
      decision: normalizeTaskDecision(candidate, input),
      usage: response.usage,
      contextUsage: response.contextUsage,
      model: response.model,
    };
  } catch {
    return {
      decision: fallback,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}

// ===== Agent 循环：调模型 + 执行工具，直到产出最终回复 =====
export interface AgentLoopOpts {
  turns: ChatTurn[];
  tools: any[];
  scene: string;
  label: string;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, args: string, result: string, success?: boolean, protocolEvidence?: ConnectorProtocolResult, structuredEvidence?: ToolExecutionEvidence) => void;
  modelConfig?: ModelConfig;  // 可选员工独立模型配置
  extraSystemContext?: string; // 额外的系统上下文（如 soul.md）
  scope?: OutputScope;        // 产出物作用域
  /** 任务专属磁盘工作区；展示仍按 scope 聚合。 */
  workspaceId?: string;
  /** Explicitly selected skills participate in route enforcement, not only prompt injection. */
  skillRefs?: SkillReference[];
  /** A deterministic binding for follow-up language such as "install it". */
  referenceContext?: string;
  /** Real source URL carried by the bound reference, never inferred by the model. */
  referenceSourceUrl?: string;
  attachments?: Attachment[];  // 用户上传/粘贴的图片附件（多模态视觉）
  shouldStop?: () => boolean;  // 自主执行中断信号（如用户点「停止」）
  waitIfPaused?: () => Promise<void>; // 在模型调用和工具调用之间等待用户继续
  consumeSteeringMessages?: () => string[]; // 运行中追加的老板指令
  getModelRequestSignal?: () => AbortSignal; // 新指令可以中断正在等待的模型响应
  onSteeringReply?: (content: string, usage: TokenUsage, contextUsage?: ContextUsage) => void;
  onModelRetry?: (attempt: number, maxAttempts: number, error: string, nextDelayMs: number) => void;
  /** 恢复中的统一执行状态；未提供时从当前用户目标创建。 */
  initialExecutionState?: ExecutionControllerSnapshot;
  /** 每次观察、恢复决策或验收状态变化时通知调用方。 */
  onExecutionState?: (state: ExecutionControllerSnapshot) => void;
  /** 跨聊天与后台 Worker 共享的公开行动生命周期，不包含隐藏思维链。 */
  onTurnLifecycle?: (state: TurnLifecycleState) => void;
  /** Called after intent compilation and before any executable route starts. */
  onTaskPrepared?: (decision: TaskDecision) => Promise<void> | void;
  /** UI control-plane routes may compile once before choosing the executor. */
  taskDecisionCompilation?: Awaited<ReturnType<typeof compileTaskDecision>>;
  /** 团队多步骤共享控制器时用于隔离各步骤的同名工具路线。 */
  executionRouteScope?: string;
}

function getUserActionForFailure(raw: string): string {
  if (/连接器|知识库|MCP|Obsidian|Vault|服务地址|认证凭据/iu.test(raw)) {
    if (/缺少|未配置|还需要|不能为空/iu.test(raw)) return '在已经打开的连接器配置窗口中填写提示的地址、目录或认证凭据，然后点击“一键配置”；保存后助手会继续做连接测试。';
    return '打开主界面左侧“连接器”，找到对应服务并点击设置，核对地址和认证信息后保存；助手会重新测试并告诉你是否真正可用。';
  }
  if (/401|403|unauthorized|forbidden|api\s*key|鉴权|密钥/iu.test(raw)) {
    return '打开“设置 → 模型”，检查接口地址和 API Key，保存后回复“继续”，我会从连接验证开始。';
  }
  if (/验证码|verification\s*code|captcha|登录|sign[ -]?in|oauth|授权/iu.test(raw)) {
    return '先在对应服务完成登录、验证码或授权，完成后回复“继续”，我会接着验证。';
  }
  if (/EACCES|EPERM|permission|权限|拒绝访问|administrator/iu.test(raw)) {
    return '请用管理员身份重新打开太极，然后回复“继续”，我会从失败步骤接着做。';
  }
  if (/timeout|timed out|ECONN|ENOTFOUND|network|网络|连接失败/iu.test(raw)) {
    return '先确认电脑能正常访问对应网站或服务，然后回复“继续”，我会重新连接并验证。';
  }
  if (/ENOENT|not found|not recognized|找不到|不存在/iu.test(raw)) {
    return '需要的程序、文件或技能来源没有找到。请提供正确的文件位置或官方下载地址；已有成果会保留。';
  }
  return '请展开最后一条“执行过程”查看通俗原因；如果需要你提供账号、授权、文件或选择，助手会明确说明具体缺少哪一项。';
}

function sourceUrlParts(value: string): { host: string; pathname: string } | undefined {
  try {
    const parsed = new URL(value);
    return { host: parsed.hostname.toLocaleLowerCase(), pathname: parsed.pathname.replace(/\/+$/u, '') };
  } catch {
    return undefined;
  }
}

function githubRepository(value: ReturnType<typeof sourceUrlParts>): string {
  if (!value) return '';
  const parts = value.pathname.split('/').filter(Boolean);
  if (value.host === 'api.github.com' && parts[0] === 'repos') return parts.slice(1, 3).join('/');
  if (value.host === 'github.com' || value.host === 'raw.githubusercontent.com') return parts.slice(0, 2).join('/');
  return '';
}

function isAllowedPinnedSkillSource(value: unknown, pinnedSource: string): boolean {
  const candidate = sourceUrlParts(String(value || ''));
  const pinned = sourceUrlParts(pinnedSource);
  if (!candidate || !pinned) return false;
  if (candidate.host === pinned.host && candidate.pathname === pinned.pathname) return true;
  const pinnedRepository = githubRepository(pinned);
  const candidateRepository = githubRepository(candidate);
  return Boolean(pinnedRepository && candidateRepository && pinnedRepository === candidateRepository);
}

function isPinnedSkillRuleDocument(value: unknown, pinnedSource: string): boolean {
  const candidate = sourceUrlParts(String(value || ''));
  const pinned = sourceUrlParts(pinnedSource);
  if (!candidate || !pinned || !isAllowedPinnedSkillSource(value, pinnedSource)) return false;
  return /(?:^|\/)SKILL\.md$/iu.test(candidate.pathname);
}

export async function runAgentLoop(opts: AgentLoopOpts): Promise<{ content: string; usage: TokenUsage; contextUsage?: ContextUsage; model: string; executionState: ExecutionControllerSnapshot; taskDecision: TaskDecision; turnRuntime: TurnRuntimeState; turnFinalization: Record<string, unknown>; turnLifecycle: TurnLifecycleState }> {
  const {
    turns, tools, scene, label, onToolCall, onToolResult, modelConfig, extraSystemContext,
    scope, attachments, shouldStop, waitIfPaused, consumeSteeringMessages,
    getModelRequestSignal, onSteeringReply, onModelRetry, initialExecutionState, onExecutionState, onTurnLifecycle, onTaskPrepared, taskDecisionCompilation,
  } = opts;
  let currentTurns = [...turns];
  let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let latestContextUsage: ContextUsage | undefined;
  let finalModel = '';
  const userTexts = turns.filter((turn) => turn.role === 'user').map((turn) => typeof turn.content === 'string'
    ? turn.content
    : (turn.content ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text).join('\n'));
  const latestUserText = userTexts.at(-1) ?? '';
  const compiled = taskDecisionCompilation ?? await compileTaskDecision(turns, tools, modelConfig, getModelRequestSignal?.());
  const taskDecision = compiled.decision;
  totalUsage.promptTokens += compiled.usage.promptTokens;
  totalUsage.completionTokens += compiled.usage.completionTokens;
  totalUsage.totalTokens += compiled.usage.totalTokens;
  latestContextUsage = compiled.contextUsage;
  finalModel = compiled.model ?? '';
  const originalUserText = taskDecision.goal;
  const installOnlyTask = isSkillInstallOnlyRequest(originalUserText);
  const explicitSkillInstallRequest = resolveSkillInstallRequest(originalUserText);
  const resumedFromCapabilityCorrection = taskDecision.mode === 'execute'
    && originalUserText !== latestUserText
    && isActionableCapabilityCorrection(latestUserText);
  const isInstallationTask = /安装|装好|装上|安装包|部署/u.test(originalUserText);
  const connectorTask = isConnectorTask(originalUserText) || taskDecision.primaryRoute === 'inspect_connectors';
  const connectorSetupTask = isConnectorSetupRequest(originalUserText) || taskDecision.primaryRoute === 'inspect_connectors';
  const isSkillInstallation = isInstallationTask && !connectorTask
    && (/skill|技能|插件/iu.test(originalUserText) || Boolean(opts.referenceSourceUrl));
  const conversationOnly = taskDecision.mode !== 'execute';
  const pinnedSkillInstall = !conversationOnly && installOnlyTask && isSkillInstallation
    ? resolveSkillInstallInput({ sourceUrl: explicitSkillInstallRequest?.sourceUrl || opts.referenceSourceUrl }, originalUserText)
    : undefined;
  const pinnedSkillSource = !pinnedSkillInstall?.error ? pinnedSkillInstall?.sourceUrl || '' : '';
  const skillDiscoveryNeedsSelection = !explicitSkillInstallRequest?.sourceUrl
    && /(?:找|搜索|搜寻|检索|推荐|find|search)/iu.test(originalUserText)
    && /(?:skill|技能|插件)/iu.test(originalUserText);
  const researchOnlyTask = isResearchOnlyRequest(originalUserText)
    || (taskDecision.primaryRoute === 'web_search'
      && !/(?:安装|部署|开发|修改|修复|创建|生成|保存|下载|上传|提交|打包|配置|接入|连接)/u.test(originalUserText));
  const requiresExecutionEvidence = !conversationOnly && taskDecision.requiresEvidence;
  const taskExperience = conversationOnly ? '' : buildTaskLearningContext(originalUserText);
  const taskContract = buildTaskContract(taskDecision, taskExperience);
  const pinnedSkillInstruction = pinnedSkillSource
    ? `\n\n## 指定 Skill 来源合同\n用户已指定唯一来源：${pinnedSkillSource}\n先读取该来源的 SKILL.md，并按其中的引用关系读取必要配套文件，自己完成用途、规则和风险判断；禁止搜索 SkillsMP、SkillHub 或其他替代来源，禁止使用 npx/skills CLI。完成阅读与风险判断后，调用 install_skill，且 sourceUrl 必须保持为上述来源。客户端原生安装器会复制并校验完整目录。`
    : '';
  let turnRuntime = createTurnRuntime({
    scope: scope ?? scene,
    goal: originalUserText,
    contract: taskDecision,
  });
  let turnLifecycle = createTurnLifecycle({
    turnId: turnRuntime.turnId,
    scope: scope ?? scene,
    goal: originalUserText,
    deliverableType: turnRuntime.deliverableType,
    contextWindowTokens: modelConfig?.contextWindowTokens,
    maxModelRounds: connectorSetupTask ? 24 : 36,
  });
  const publishTurnLifecycle = () => onTurnLifecycle?.(turnLifecycle);
  if (!conversationOnly) await onTaskPrepared?.(taskDecision);
  publishTurnLifecycle();
  currentTurns = conversationOnly
    ? [{ role: 'system', content: `${taskContract}\n\n当前消息不需要工具执行。直接结合最近上下文回应，不得自动恢复、重放或继续上一项任务。只有用户明确提出新的执行目标或明确要求继续时，才能重新开始执行。` }, ...currentTurns]
    : [{
      role: 'system',
      content: `${taskContract}\n\n${buildTurnGuidance(turnRuntime)}\n\n${AUTONOMOUS_EXECUTION_GUIDE}\n\n${CAPABILITY_ROUTING_GUIDE}\n\n${SKILL_RECOVERY_GUIDE}${pinnedSkillInstruction}${resumedFromCapabilityCorrection
        ? `\n\n用户最新消息是在纠正上一轮没有行动的问题。当前仍未完成的目标是：\n${originalUserText.slice(0, 2000)}\n必须立即按纠正后的能力路线执行，不要再次道歉、解释能力或要求用户重复目标。`
        : ''}`,
    }, ...currentTurns];

  // 多模态：把最后一条 user 消息转为 [text, image_url] 数组
  if (attachments && attachments.length > 0) {
    const lastUserIdx = currentTurns.map((t) => t.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      const t = currentTurns[lastUserIdx];
      const textPart: ContentPart = { type: 'text', text: typeof t.content === 'string' ? t.content : '' };
      const imageParts: ImagePart[] = attachments
        .filter((a) => a.kind === 'image' && a.dataUrl)
        .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl! } }));
      if (imageParts.length > 0) {
        currentTurns = currentTurns.map((turn, i) =>
          i === lastUserIdx ? { ...turn, content: [textPart, ...imageParts] } : turn
        );
      }
    }
  }
  const checkpointBaseTurns = [...currentTurns];
  const steeringCheckpointTurns: ChatTurn[] = [];

  let finalContent: string | null = null;
  const iterationsPerPhase = connectorSetupTask ? 6 : 8;
  const maxIter = connectorSetupTask ? 24 : 36;
  const maxToolCallsPerPhase = connectorSetupTask ? 8 : 12;
  const maxAutonomousToolPhases = connectorSetupTask ? 2 : 4;
  const maxTotalToolAttempts = connectorSetupTask ? 18 : 48;
  const maxPreparationOnlyStreak = connectorSetupTask ? 5 : 8;
  const callLog: Array<{ name: string; args: string; result: string; success: boolean }> = [];
  const toolResultCache = new Map<string, { output: string; success: boolean }>();
  const toolCallCounts = new Map<string, number>();
  const resourceReadCounts = new Map<string, number>();
  const failedSkillReads = new Set<string>();
  let pinnedSkillRuleRead = false;
  const successfulCalls = new Set<string>();
  let stopped = false;
  let finalReviewRequested = false;
  let phaseStartSuccessCount = 0;
  let phaseStartLogIndex = 0;
  let stalledPhases = 0;
  let executionBudgetReached = false;
  let toolCallsThisPhase = 0;
  let totalToolAttempts = 0;
  let preparationOnlyStreak = 0;
  let duplicateOrBlockedStreak = 0;
  let completedToolPhases = 0;
  let phaseToolBudgetReached = false;
  let requiredResearchSucceeded = false;
  let requiredResearchOutput = '';
  let researchSummaryFailures = 0;
  let completedInstallOnlyTask = false;
  let completedSkillDiscovery = false;
  const maxResearchSummaryAttempts = 2;
  let executionState = initialExecutionState
    ? restoreExecutionController(initialExecutionState, { goal: originalUserText, acceptanceCriteria: taskDecision.acceptanceCriteria, requiresEvidence: requiresExecutionEvidence, maxAttempts: maxTotalToolAttempts })
    : createExecutionController({ goal: originalUserText, acceptanceCriteria: taskDecision.acceptanceCriteria, requiresEvidence: requiresExecutionEvidence, maxAttempts: maxTotalToolAttempts });
  const publishExecutionState = (next: ExecutionControllerSnapshot) => {
    executionState = next;
    onExecutionState?.(executionState);
  };
  const executionRouteKey = (name: string, argumentsText: string) => `${opts.executionRouteScope ?? scene}:${canonicalToolCallKey(name, argumentsText)}`;
  const observeToolOutcome = (name: string, argumentsText: string, output: string, success: boolean, evidenceKind = 'progress', contributesEvidence = success) => {
    publishExecutionState(observeExecutionResult(executionState, {
      toolName: name,
      routeKey: executionRouteKey(name, argumentsText),
      success,
      result: output,
      contributesEvidence,
      evidenceKind,
    }));
  };
  onExecutionState?.(executionState);

  const respondToSteering = async (initialMessages: string[]): Promise<{ stopped: boolean }> => {
    const pendingMessages = [...initialMessages];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const instruction = pendingMessages.join('\n').trim();
      if (!instruction) return { stopped: false };
      turnRuntime = applyTurnSteering(turnRuntime, instruction);
      turnLifecycle = recordLifecycleSteering(turnLifecycle, pendingMessages);
      publishTurnLifecycle();
      publishExecutionState(applyExecutionSteering(executionState, instruction));
      const userTurn: ChatTurn = {
        role: 'user',
        content: `## 用户刚刚插话（优先于当前计划）\n${instruction}`,
      };
      try {
        const response = await chatCompletion([
          ...currentTurns,
          userTurn,
          {
            role: 'system',
            content: '立刻只回应用户刚刚插入的话。结合已经完成的动作、真实证据和当前阻塞，用通俗中文说明现在的情况、是否会调整原计划以及下一步。不要调用工具，不要复读旧计划，不要声称尚未验证的结果。用户没有明确要求继续时，不得擅自恢复已暂停或已停止的任务。',
          },
        ], scene, `${label} · 处理中回应`, undefined, modelConfig, extraSystemContext, undefined, getModelRequestSignal?.());
        totalUsage.promptTokens += response.usage.promptTokens;
        totalUsage.completionTokens += response.usage.completionTokens;
        totalUsage.totalTokens += response.usage.totalTokens;
        latestContextUsage = response.contextUsage;
        if (!finalModel) finalModel = response.model;

        const newerMessages = consumeSteeringMessages?.() ?? [];
        if (newerMessages.length > 0) {
          pendingMessages.push(...newerMessages);
          continue;
        }

        const content = response.content?.trim()
          || '我收到你的新要求了。我会先按最新信息重新判断，不再机械重复刚才的操作。';
        const assistantTurn: ChatTurn = { role: 'assistant', content };
        currentTurns.push(userTurn, assistantTurn);
        steeringCheckpointTurns.push(userTurn, assistantTurn);
        finalReviewRequested = false;
        onSteeringReply?.(content, response.usage, response.contextUsage);
        return { stopped: isExplicitStopSteering(pendingMessages) };
      } catch (error: any) {
        const newerMessages = consumeSteeringMessages?.() ?? [];
        if (error?.name === 'ExternalAbortError' && newerMessages.length > 0) {
          pendingMessages.push(...newerMessages);
          continue;
        }
        if (shouldStop?.()) return { stopped: true };
        const content = '我已经收到你的新要求。当前步骤不会再继续扩展；等模型恢复后，我会从这条最新要求重新判断。';
        currentTurns.push(userTurn, { role: 'assistant', content });
        steeringCheckpointTurns.push(userTurn, { role: 'assistant', content });
        onSteeringReply?.(content, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        return { stopped: isExplicitStopSteering(pendingMessages) };
      }
    }
    return { stopped: isExplicitStopSteering(pendingMessages) };
  };

  for (let iter = 0; iter < maxIter; iter++) {
    // 暂停中的插话会临时唤醒等待者。唤醒后必须先消费最新消息，
    // 不能先让旧计划多跑一次模型或工具调用。
    await waitIfPaused?.();
    if (shouldStop?.()) { stopped = true; break; }
    const atTurnStartGuidance = consumeSteeringMessages?.() ?? [];
    if (atTurnStartGuidance.length > 0) {
      const steering = await respondToSteering(atTurnStartGuidance);
      if (steering.stopped) { stopped = true; break; }
      continue;
    }
    if (phaseToolBudgetReached) {
      if (executionBudgetReached) break;
      const phaseCalls = callLog.slice(phaseStartLogIndex);
      const madeProgress = successfulCalls.size > phaseStartSuccessCount;
      stalledPhases = madeProgress ? 0 : stalledPhases + 1;
      const summaryRows = phaseCalls.slice(-14).map((call, index) => {
        const state = call.success ? '完成' : `未完成（${humanizeExecutionError(call.result)}）`;
        return `${index + 1}. ${getToolStage(call.name)}：${state}`;
      });
      const runtimeSnapshot = compactRuntimeEvidence(turnRuntime);
      const summary = `${summaryRows.length > 0 ? summaryRows.join('\n') : '这一阶段没有产生有效操作。'}\n\n结构化观察：${JSON.stringify(runtimeSnapshot)}`;
      turnLifecycle = recordLifecycleContext(turnLifecycle, {
        compacted: true,
        stage: completedToolPhases + 2,
        summary,
        unresolvedIssues: turnRuntime.unresolvedIssues,
      });
      publishTurnLifecycle();
      if (stalledPhases >= 3 || completedToolPhases >= maxAutonomousToolPhases - 1) {
        executionBudgetReached = true;
        break;
      }
      completedToolPhases += 1;
      currentTurns = [
        ...checkpointBaseTurns,
        ...steeringCheckpointTurns,
        { role: 'system', content: `${buildContinuationGuide(summary, stalledPhases)}\n\n已自动完成第 ${completedToolPhases} 个执行阶段的上下文压缩。不要向用户索要“继续”，请直接从未完成目标进入下一阶段，并优先验证能否换工具、换路径或补齐验收。` },
      ];
      phaseStartSuccessCount = successfulCalls.size;
      phaseStartLogIndex = callLog.length;
      finalReviewRequested = false;
      toolCallsThisPhase = 0;
      phaseToolBudgetReached = false;
      continue;
    }
    if (iter > 0 && iter % iterationsPerPhase === 0) {
      const phaseCalls = callLog.slice(phaseStartLogIndex);
      const madeProgress = successfulCalls.size > phaseStartSuccessCount;
      stalledPhases = madeProgress ? 0 : stalledPhases + 1;
      const summaryRows = phaseCalls.slice(-14).map((call, index) => {
        const state = call.success ? '完成' : `未完成（${humanizeExecutionError(call.result)}）`;
        return `${index + 1}. ${getToolStage(call.name)}：${state}`;
      });
      const runtimeSnapshot = compactRuntimeEvidence(turnRuntime);
      const summary = `${summaryRows.length > 0 ? summaryRows.join('\n') : '这一阶段没有产生有效操作。'}\n\n结构化观察：${JSON.stringify(runtimeSnapshot)}`;
      turnLifecycle = recordLifecycleContext(turnLifecycle, {
        compacted: true,
        stage: Math.floor(iter / iterationsPerPhase) + 2,
        summary,
        unresolvedIssues: turnRuntime.unresolvedIssues,
      });
      publishTurnLifecycle();
      if (stalledPhases >= 3) {
        executionBudgetReached = true;
        break;
      }
      currentTurns = [
        ...checkpointBaseTurns,
        ...steeringCheckpointTurns,
        { role: 'system', content: buildContinuationGuide(summary, stalledPhases) },
      ];
      phaseStartSuccessCount = successfulCalls.size;
      phaseStartLogIndex = callLog.length;
      finalReviewRequested = false;
    }
    let r: ChatResult;
    try {
      const toolsForCall = conversationOnly ? undefined : tools;
      turnLifecycle = recordLifecycleProgress(turnLifecycle, {
        type: 'model_request_started',
        phase: 'observe',
        activity: `正在请求 ${modelConfig?.model || '当前模型'} 判断下一步`,
        modelRounds: 1,
      });
      publishTurnLifecycle();
      r = await chatCompletion(
        currentTurns,
        scene,
        label,
        toolsForCall,
        modelConfig,
        extraSystemContext,
        undefined,
        getModelRequestSignal?.(),
        undefined,
      );
      const observedDecision = observeTurnModelDecision(turnRuntime, {
        content: r.content,
        toolCalls: r.toolCalls,
      });
      turnRuntime = observedDecision.runtime;
      turnLifecycle = recordLifecycleDecision(turnLifecycle, observedDecision.decision);
      turnLifecycle = recordLifecycleProgress(turnLifecycle, {
        type: 'model_response_received',
        phase: observedDecision.decision.action,
        activity: r.toolCalls?.length ? '模型已返回工具动作，正在执行' : '模型已返回内容，正在核对验收条件',
        estimatedTokens: r.contextUsage?.promptTokens ?? r.usage.promptTokens,
        contextWindowTokens: r.contextUsage?.contextWindowTokens ?? modelConfig?.contextWindowTokens,
      });
      publishTurnLifecycle();
    } catch (error: any) {
      const interruptedMessages = consumeSteeringMessages?.() ?? [];
      if (error?.name === 'ExternalAbortError' && interruptedMessages.length > 0) {
        const steering = await respondToSteering(interruptedMessages);
        if (steering.stopped) { stopped = true; break; }
        continue;
      }
      if (shouldStop?.()) { stopped = true; break; }
      researchSummaryFailures += 1;
      const errorText = error?.message ?? String(error);
      const observedModelFailure = observeTurnToolResult(turnRuntime, {
        toolCallId: `model-request-${researchSummaryFailures}`,
        name: 'model_request',
        args: { model: modelConfig?.model ?? 'active-model', scene },
        success: false,
        useful: false,
        output: errorText,
        kind: 'model',
      });
      turnRuntime = observedModelFailure.runtime;
      const modelRecovery = decideTurnRecovery(turnRuntime, observedModelFailure.error ?? errorText);
      turnRuntime = modelRecovery.runtime;
      turnLifecycle = recordLifecycleProgress(turnLifecycle, {
        type: 'model_request_failed',
        phase: modelRecovery.decision.action === 'waiting_user' ? 'waiting_user' : 'observe',
        activity: modelRecovery.decision.action === 'retry' ? '模型请求未成功，正在按分类恢复' : '模型请求未成功，正在保存恢复现场',
        detail: { errorType: modelRecovery.decision.errorType, action: modelRecovery.decision.action },
      });
      publishTurnLifecycle();
      publishExecutionState(observeExecutionResult(executionState, {
        toolName: 'model_request',
        routeKey: executionRouteKey('model_request', JSON.stringify({ model: modelConfig?.model ?? 'active-model', scene })),
        success: false,
        result: errorText,
        contributesEvidence: false,
        retryLimit: maxResearchSummaryAttempts - 1,
      }));
      if (modelRecovery.decision.action === 'retry' && executionState.decision.kind === 'retry' && researchSummaryFailures < maxResearchSummaryAttempts) {
        const retryDelayMs = 10000;
        onModelRetry?.(researchSummaryFailures, maxResearchSummaryAttempts, errorText, retryDelayMs);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        await waitIfPaused?.();
        if (shouldStop?.()) { stopped = true; break; }
        continue;
      }
      onModelRetry?.(researchSummaryFailures, maxResearchSummaryAttempts, errorText, 0);
      if (modelRecovery.decision.action === 'waiting_user') {
        finalContent = modelRecovery.decision.userMessage;
        publishExecutionState(blockExecution(executionState, modelRecovery.decision.message, executionState.decision.failureClass));
        break;
      }
      if (researchOnlyTask && requiredResearchSucceeded) {
        finalContent = buildResearchFallback(originalUserText, requiredResearchOutput, errorText);
        observeToolOutcome('client_research_fallback', JSON.stringify({ query: buildFreshWebQuery(originalUserText) }), finalContent, true, 'research');
        publishExecutionState(evaluateExecutionConclusion(executionState, { content: finalContent, reviewed: true }));
        break;
      }
      finalContent = `还没有完成。\n\n模型请求已按“${modelRecovery.decision.errorType}”分类恢复，但仍没有返回有效结果。当前目标、已完成证据和未决问题已经保存；请检查模型连接或切换可用模型后继续。`;
      publishExecutionState(blockExecution(executionState, '模型请求已完成分类恢复，但仍未返回有效结果。', executionState.decision.failureClass));
      break;
    }
    if (researchSummaryFailures > 0) {
      observeToolOutcome('model_request', JSON.stringify({ model: modelConfig?.model ?? 'active-model', scene }), '模型已恢复并返回有效结果', true, 'model', false);
      researchSummaryFailures = 0;
    }
    totalUsage.promptTokens += r.usage.promptTokens;
    totalUsage.completionTokens += r.usage.completionTokens;
    totalUsage.totalTokens += r.usage.totalTokens;
    latestContextUsage = r.contextUsage;
    if (!finalModel) finalModel = r.model;

    // HTTP 请求无法在生成中途改写，但返回后必须先吸收最新指令，
    // 不能继续执行已经过时的工具调用或下一步骤。
    const afterCallGuidance = consumeSteeringMessages?.() ?? [];
    if (afterCallGuidance.length) {
      const steering = await respondToSteering(afterCallGuidance);
      if (steering.stopped) { stopped = true; break; }
      continue;
    }

    if (r.toolCalls && r.toolCalls.length > 0) {
      // 模型返回了工具调用：执行，结果加入对话继续
      const { executeTool } = await import('../engine/tools');
      let iterationHadFailure = false;
      let steeringHandled = false;
      for (const tc of r.toolCalls) {
        await waitIfPaused?.();
        if (shouldStop?.()) { stopped = true; break; }
        const beforeToolGuidance = consumeSteeringMessages?.() ?? [];
        if (beforeToolGuidance.length > 0) {
          const steering = await respondToSteering(beforeToolGuidance);
          if (steering.stopped) stopped = true;
          steeringHandled = true;
          break;
        }
        if (toolCallsThisPhase >= maxToolCallsPerPhase || totalToolAttempts >= maxTotalToolAttempts) {
          phaseToolBudgetReached = true;
          executionBudgetReached = totalToolAttempts >= maxTotalToolAttempts;
          break;
        }
        totalToolAttempts += 1;
        toolCallsThisPhase += 1;
        const normalizedCall = normalizeTurnToolCall(tc.name, tc.arguments);
        let effectiveArguments = normalizedCall.ok ? normalizedCall.argumentsText! : tc.arguments;
        let effectiveCallOk = normalizedCall.ok;
        let effectiveCallError = normalizedCall.error;
        if (tc.name === 'install_skill') {
          const suppliedArgs = normalizedCall.ok && normalizedCall.args && typeof normalizedCall.args === 'object'
            ? normalizedCall.args
            : {};
          // The model can audit the requested package, but it cannot substitute
          // a different package at the final write step.
          const modelArgs = pinnedSkillSource
            ? { ...suppliedArgs, sourceUrl: pinnedSkillSource }
            : suppliedArgs;
          const resolvedInstall = resolveSkillInstallInput(modelArgs, originalUserText);
          if (!resolvedInstall.error) {
            effectiveArguments = JSON.stringify({ ...modelArgs, ...resolvedInstall });
            effectiveCallOk = true;
            effectiveCallError = undefined;
          } else {
            effectiveCallError = resolvedInstall.error;
          }
        }
        const lifecycleArgs = (() => { try { return JSON.parse(effectiveArguments); } catch { return {}; } })();
        turnLifecycle = recordLifecycleToolStarted(turnLifecycle, {
          callId: tc.id,
          name: tc.name,
          args: lifecycleArgs,
          activity: `正在调用 ${getToolStage(tc.name)}`,
        });
        publishTurnLifecycle();
        const cacheKey = canonicalToolCallKey(tc.name, effectiveArguments);
        const routeGate = canExecuteRoute(executionState, { toolName: tc.name, routeKey: executionRouteKey(tc.name, effectiveArguments) });
        const controllerRetry = executionState.decision.kind === 'retry' && executionState.decision.routeId === routeGate.routeId;
        const resourceKey = toolResourceKey(tc.name, effectiveArguments);
        const resourceReadCount = resourceKey ? (resourceReadCounts.get(resourceKey) ?? 0) : 0;
        const toolCallCount = (toolCallCounts.get(tc.name) ?? 0) + 1;
        toolCallCounts.set(tc.name, toolCallCount);
        const cached = controllerRetry ? undefined : toolResultCache.get(cacheKey);
        const repeatedFailedSkillRead = tc.name === 'read_skill' && failedSkillReads.has(cacheKey);
        const resourceLimit = tc.name === 'read_skill' || tc.name === 'read_web_page'
          ? 1
          : tc.name === 'read_file' ? (connectorSetupTask ? 4 : 12) : Number.POSITIVE_INFINITY;
        const toolLimitReached = toolCallCount > getToolCallLimit(tc.name, connectorSetupTask);
        const resourceLimitReached = Boolean(resourceKey) && resourceReadCount >= resourceLimit;
        const blockedReason = !effectiveCallOk
          ? effectiveCallError ?? '工具参数无效，模型需要修正后再调用。'
          : pinnedSkillSource && (tc.name === 'search_skills' || tc.name === 'web_search')
          ? '用户已给出明确的 Skill 来源。本次只允许阅读该来源及同仓库配套文件、完成风险判断并安装；禁止搜索候选或替代来源。'
          : pinnedSkillSource && tc.name === 'read_web_page' && !isAllowedPinnedSkillSource(lifecycleArgs.url, pinnedSkillSource)
          ? '当前网页不属于用户指定的 Skill 来源或其同一 GitHub 仓库。不得改读市场页、聚合页或替代来源。'
          : pinnedSkillSource && tc.name === 'run_command' && /(?:npx\s+skills|skills\s+add)/iu.test(String(lifecycleArgs.command ?? lifecycleArgs.cmd ?? ''))
          ? '指定来源安装必须使用原生 install_skill，以便保存完整目录并做原子校验；禁止改走 npx/skills CLI。'
          : pinnedSkillSource && tc.name === 'install_skill' && !/\.zip$/iu.test(sourceUrlParts(pinnedSkillSource)?.pathname ?? '') && !pinnedSkillRuleRead
          ? '安装前必须先读取用户指定来源中的 SKILL.md，并按其规则判断必要配套文件和风险；不要把市场介绍页或安装说明当成 Skill 正文。'
          : tc.name === 'install_skill' && skillDiscoveryNeedsSelection
          ? '当前任务只要求检索 Skill 候选，用户尚未选择要安装的技能。请展示已找到的候选及来源，等待用户明确选择后再安装；禁止擅自安装或改用其他来源。'
          : !routeGate.allowed
          ? routeGate.reason ?? '执行控制器已阻止重复或无效路线，必须换一种方法。'
          : repeatedFailedSkillRead
          ? '这个 Skill 已经读取失败，已阻止重复尝试。必须改用不同来源、替代工具或明确交接真实缺项。'
          : cached !== undefined
          ? '完全相同的工具调用已经执行过。重复调用不会产生新证据，必须重新判断目标并换路线。'
          : toolLimitReached
          ? `“${getToolStage(tc.name)}”已经达到本任务的合理尝试次数。必须停止这条路线，改用其他工具或根据现有证据向用户说明阻塞。`
          : resourceLimitReached
          ? `同一资源已经读取 ${resourceReadCount} 次，继续读取不会产生新证据。必须开始实际操作、改用其他来源或说明缺少的外部条件。`
          : '';

        let executed = false;
        const result = blockedReason
          ? { toolCallId: tc.id, name: tc.name, success: false, output: blockedReason }
          : await (async () => {
            executed = true;
            onToolCall?.(tc.name, redactToolArguments(effectiveArguments));
            return executeTool({ id: tc.id, name: tc.name, args: (() => { try { return JSON.parse(effectiveArguments); } catch { return {}; } })(), scope, workspaceId: opts.workspaceId });
          })();
        const resultSuccess = executed && isUsefulToolOutcome(tc.name, result.success, result.output, originalUserText);
        const newEvidence = resultSuccess && cached === undefined;
        if (tc.name === 'web_search' && resultSuccess) {
          requiredResearchSucceeded = true;
          requiredResearchOutput = result.output;
        }
        observeToolOutcome(tc.name, effectiveArguments, result.output, resultSuccess, tc.name === 'write_file' ? 'file' : tc.name === 'test_connector' ? 'connection' : 'progress');
        if (resourceKey && executed) resourceReadCounts.set(resourceKey, resourceReadCount + 1);
        if (resultSuccess && tc.name === 'read_web_page' && isPinnedSkillRuleDocument(lifecycleArgs.url, pinnedSkillSource)) {
          pinnedSkillRuleRead = true;
        }
        if (tc.name === 'read_skill' && !resultSuccess) failedSkillReads.add(cacheKey);
        if (newEvidence && !isPreparationOnlyTool(tc.name)) successfulCalls.add(cacheKey);
        if (!newEvidence) iterationHadFailure = true;
        if (executed && cached === undefined) toolResultCache.set(cacheKey, { output: result.output.slice(0, 6000), success: resultSuccess });
        if (executed) onToolResult?.(tc.name, redactToolArguments(effectiveArguments), result.output, resultSuccess, result.protocolEvidence, result.structuredEvidence);
        callLog.push({ name: tc.name, args: effectiveArguments, result: result.output.slice(0, 1200), success: resultSuccess });
        const observedResult = observeTurnToolResult(turnRuntime, {
          toolCallId: tc.id,
          name: tc.name,
          args: (() => { try { return JSON.parse(effectiveArguments); } catch { return effectiveArguments; } })(),
          success: resultSuccess,
          useful: newEvidence,
          output: result.output,
          kind: tc.name === 'write_file' ? 'file' : tc.name === 'test_connector' ? 'connection' : 'tool',
        });
        turnRuntime = observedResult.runtime;
        turnLifecycle = recordLifecycleToolFinished(turnLifecycle, {
          callId: tc.id,
          name: tc.name,
          success: resultSuccess,
          output: result.output,
          errorType: observedResult.error?.type,
          resultRef: observedResult.evidence.resultRef,
          evidenceIds: [observedResult.evidence.evidenceId],
        });
        publishTurnLifecycle();
        if (resultSuccess && tc.name === 'search_skills' && skillDiscoveryNeedsSelection) {
          const acceptance = assessTaskCompletion(originalUserText, result.output, callLog);
          publishExecutionState(evaluateExecutionConclusion(executionState, {
            content: result.output,
            reviewed: true,
            acceptancePassed: acceptance.passed,
            acceptanceIssues: acceptance.issues,
          }));
          finalContent = `已找到以下 Skill 候选，尚未安装。\n\n${result.output}\n\n请直接回复候选名称或发送该技能的详情链接；确认后我只会安装你选中的那一个。`;
          completedSkillDiscovery = true;
          break;
        }
        if (resultSuccess && tc.name === 'install_skill' && installOnlyTask) {
          const acceptance = assessTaskCompletion(originalUserText, result.output, callLog);
          publishExecutionState(evaluateExecutionConclusion(executionState, {
            content: result.output,
            reviewed: true,
            acceptancePassed: acceptance.passed,
            acceptanceIssues: acceptance.issues,
          }));
          if (executionState.status === 'completed') {
            finalContent = `已经安装好了。\n\n${result.output}`;
            completedInstallOnlyTask = true;
            break;
          }
        }
        if (!resultSuccess && observedResult.error) {
          const recovery = decideTurnRecovery(turnRuntime, observedResult.error);
          turnRuntime = recovery.runtime;
          currentTurns.push({ role: 'system', content: `${buildTurnGuidance(turnRuntime)}\n\n本次失败分类：${recovery.decision.errorType}；恢复动作：${recovery.decision.action}。不要原样重复同一工具参数。` });
          if (recovery.decision.action === 'waiting_user') {
            finalContent = recovery.decision.userMessage;
            executionBudgetReached = true;
            phaseToolBudgetReached = true;
          }
        }

        if (isPreparationOnlyTool(tc.name) && newEvidence) preparationOnlyStreak += 1;
        else if (newEvidence) preparationOnlyStreak = 0;
        if (!executed || cached !== undefined || resourceLimitReached || toolLimitReached) duplicateOrBlockedStreak += 1;
        else if (newEvidence) duplicateOrBlockedStreak = 0;

        if (resultSuccess && tc.name === 'write_file') {
          try {
            const writtenArgs = JSON.parse(effectiveArguments || '{}') as { path?: string };
            const writtenResource = toolResourceKey('read_file', JSON.stringify({ path: writtenArgs.path ?? '' }));
            if (writtenResource) resourceReadCounts.delete(writtenResource);
          } catch {}
        }

        if (preparationOnlyStreak === maxPreparationOnlyStreak) {
          currentTurns.push({
            role: 'system',
            content: `已经连续 ${preparationOnlyStreak} 次只做搜索、检查或读取，没有形成安装、配置、写入、验证等实际结果。现在必须停止继续收集同类资料，重新核对用户最终目标，并在下一步选择：执行一个可验证动作、换一条实现路线，或根据真实证据说明唯一缺少的用户条件。`,
          });
        }
        if (preparationOnlyStreak >= maxPreparationOnlyStreak + 3 || duplicateOrBlockedStreak >= 4) {
          executionBudgetReached = true;
          phaseToolBudgetReached = true;
        }
        if (toolCallsThisPhase >= maxToolCallsPerPhase || totalToolAttempts >= maxTotalToolAttempts) {
          phaseToolBudgetReached = true;
          if (totalToolAttempts >= maxTotalToolAttempts) executionBudgetReached = true;
        }
        // 对 tool output 长度做上限，防止下游模型调用因上下文超长失败
        const truncated = result.output.slice(0, 1500);
        currentTurns.push({ role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }] } as any);
        currentTurns.push({ role: 'tool', content: truncated, tool_call_id: tc.id } as any);
        // v2 observes a failed Skill call like any other capability failure.
        // The model can discover another tool or source; the client no longer
        // launches an unrelated recovery route behind its back.
        if (shouldStop?.()) { stopped = true; break; } // 用户停止：工具执行后中止
        const afterToolGuidance = consumeSteeringMessages?.() ?? [];
        if (afterToolGuidance.length > 0) {
          const steering = await respondToSteering(afterToolGuidance);
          if (steering.stopped) stopped = true;
          steeringHandled = true;
          break;
        }
      }
      if (stopped) break;
      if (completedInstallOnlyTask) break;
      if (completedSkillDiscovery) break;
      if (steeringHandled) continue;
      if (phaseToolBudgetReached) continue;
      if (iterationHadFailure) {
        currentTurns.push({ role: 'system', content: executionControllerGuidance(executionState) });
      }
    } else if (r.content) {
      if (!conversationOnly) {
        const cognitiveOnlyCompletion = !executionState.requiresEvidence && callLog.length === 0;
        const acceptance = assessTaskCompletion(originalUserText, r.content, callLog);
        publishExecutionState(evaluateExecutionConclusion(executionState, {
          content: r.content,
          reviewed: cognitiveOnlyCompletion || finalReviewRequested,
          acceptancePassed: acceptance.passed,
          acceptanceIssues: acceptance.issues,
        }));
        const nextDecision = executionState.decision.kind;
        if (nextDecision === 'verify') {
          currentTurns.push({ role: 'assistant', content: r.content });
          currentTurns.push({ role: 'system', content: `${EXECUTION_SELF_REVIEW_GUIDE}\n\n${executionControllerGuidance(executionState)}` });
          finalReviewRequested = true;
          continue;
        }
        if (nextDecision === 'act' || nextDecision === 'continue' || nextDecision === 'retry' || nextDecision === 'switch_route') {
          currentTurns.push({ role: 'assistant', content: r.content });
          currentTurns.push({ role: 'system', content: executionControllerGuidance(executionState) });
          finalReviewRequested = false;
          continue;
        }
      }
      finalContent = r.content;
      break;
    } else {
      break;
    }
  }

  if (executionBudgetReached && executionState.status === 'running') {
    publishExecutionState(markExecutionBudgetReached(executionState));
  }

  if (researchOnlyTask && requiredResearchSucceeded) {
    const unusableSummary = !finalContent
      || isResearchDeliveryDeflection(finalContent)
      || /(?:没有|未能|无法|不能).{0,18}(?:搜索|检索|查询|实时结果)|卡在.{0,12}(?:查询|搜索)|搜索.{0,12}失败/u.test(finalContent);
    finalContent = unusableSummary
      ? buildResearchFallback(originalUserText, requiredResearchOutput)
      : ensureResearchSourceLinks(finalContent ?? '', originalUserText, requiredResearchOutput);
  }

  const failuresBeforeSummary = callLog.filter((call) => !call.success);
  const answerNeedsNextStep = finalContent != null
    && /还没|没有完成|不能确认|未完成|失败|卡在|没有处理好/u.test(finalContent)
    && !/(?:下一步|你现在(?:需要|可以)|请(?:打开|点击|提供|登录|授权|检查|选择|回复|上传|填写|重新启动))/u.test(finalContent);

  // 到达执行预算或模型留下模糊失败答复时，禁用工具做一次强制交接总结。
  if (!stopped && callLog.length > 0 && (!finalContent || answerNeedsNextStep)) {
    const successfulStages = [...new Set(callLog.filter((call) => call.success).map((call) => getToolStage(call.name)))].slice(-8);
    const failureEvidence = failuresBeforeSummary.slice(-6).map((call, index) =>
      `${index + 1}. 阶段：${getToolStage(call.name)}\n原因摘要：${humanizeExecutionError(call.result)}\n真实反馈：${call.result.slice(0, 700)}`
    ).join('\n\n');
    try {
      const handoff = await chatCompletion([
        { role: 'system', content: `${BEGINNER_RESPONSE_GUIDE}\n\n你现在只负责根据真实执行证据写最终交接，不得调用工具，不得虚构成功。` },
        { role: 'system', content: '内部工具预算、上下文压缩或阶段次数不是用户需要解决的问题。除非确实缺少账号、授权、验证码、文件或业务选择，否则不得要求用户回复“继续”；要明确说明系统已经自动尝试的替代路径。' },
        { role: 'user', content: `用户最初目标：\n${originalUserText.slice(0, 4000)}\n\n已成功的阶段：\n${successfulStages.length ? successfulStages.join('、') : '暂时没有可确认的完成项'}\n\n最近失败证据：\n${failureEvidence || '没有明确失败，但执行预算已经用完。'}\n\n是否达到执行预算：${executionBudgetReached ? '是' : '否'}\n\n请用通俗中文交接，必须包含：\n1. 第一行明确整个目标成功还是没有成功；\n2. 已经完成并保留了什么；\n3. 最后卡在哪一类事情和通俗原因；\n4. 用户现在唯一最省事的下一步，明确点哪里、提供什么或回复什么。\n如果不需要用户提供账号、授权、文件或选择，就直说用户不需要改设置；禁止把“回复继续”当成推进任务的条件。不要只说“重新验收”“请重试”或“查看执行过程”。` },
      ], scene, `${label} · 失败交接`, undefined, modelConfig, extraSystemContext);
      totalUsage.promptTokens += handoff.usage.promptTokens;
      totalUsage.completionTokens += handoff.usage.completionTokens;
      totalUsage.totalTokens += handoff.usage.totalTokens;
      latestContextUsage = handoff.contextUsage;
      if (!finalModel) finalModel = handoff.model;
      if (handoff.content) finalContent = handoff.content;
    } catch {
      // 模型交接失败时继续使用下方确定性回退，保证用户仍能拿到具体下一步。
    }
  }

  // 工具循环用尽但模型未产出最终文本：只给普通用户看得懂的结果，技术记录由折叠执行过程承载。
  if (!finalContent) {
    if (stopped) {
      finalContent = isInstallationTask
        ? '还没有安装好，任务已经停止。\n\n停止前完成的内容仍然保留。你可以重新发送安装要求，我会从没有完成的步骤继续；详细记录可以在下方“执行过程”中查看。'
        : '还没有完成，任务已经停止。\n\n停止前完成的内容仍然保留。需要时可以重新发送要求，从没有完成的步骤继续；详细记录可以在下方“执行过程”中查看。';
    } else if (callLog.length > 0) {
      const failures = callLog.filter((call) => !call.success);
      const lastCall = callLog.at(-1)!;
      if (failures.length === 0) {
        const connectorVerified = callLog.some((call) => call.success && (call.name === 'test_connector' || (call.name === 'run_command' && /"verification"\s*:\s*(?:true|"true")/iu.test(call.args) && /"connector"\s*:/iu.test(call.args))));
        const connectorPrepared = callLog.some((call) => call.name === 'prepare_connector' && call.success);
        finalContent = connectorSetupTask && !connectorVerified
          ? connectorPrepared
            ? '还没有完成连接器配置。\n\n配置窗口已经打开，现有草稿也已保留，但还需要你填写该服务要求的地址、目录或认证凭据并点击“一键配置”。保存后助手会做真实连接测试，测试通过才算完成。'
            : '还没有完成连接器配置。\n\n目前只完成了连接器状态检查，还没有保存并通过真实连接测试。请按已经打开的配置入口填写必要信息后继续验证。'
          : isSkillInstallation
          ? '目前还不能确认这个技能已经完全可用。\n\n技能相关的操作已经执行完，但还没有拿到“版本正确、必要配置完成、实际调用通过”三项完整验收结果。请让我继续做最后检查；详细记录可以在下方“执行过程”中查看。'
          : isInstallationTask
            ? '目前还不能确认已经完全安装好。\n\n安装相关的操作已经执行完，但还缺最后的版本、配置和实际打开检查。完成这些检查后才能正式确认；详细记录可以在下方“执行过程”中查看。'
            : '已经处理好了。\n\n这次需要的步骤已经全部完成并做了最后检查。你可以直接回到刚才的功能继续使用；详细记录可以在下方“执行过程”中查看。';
      } else if (lastCall.success) {
        const lastFailure = failures.at(-1)!;
        const completedStages = [...new Set(callLog.filter((call) => call.success).map((call) => getToolStage(call.name)))].slice(-5);
        finalContent = `${isInstallationTask ? '还没有安装好' : '还没有完成整个目标'}。\n\n已经完成并保留：${completedStages.length ? completedStages.join('、') : '目前没有可确认的完成项'}。\n\n最后卡在“${getToolStage(lastFailure.name)}”。${humanizeExecutionError(lastFailure.result)}\n\n你现在需要这样做：${getUserActionForFailure(lastFailure.result)}\n\n详细记录可以在下方“执行过程”中逐条展开查看。`;
      } else {
        finalContent = `${isInstallationTask ? '还没有安装好' : '还没有处理好'}。\n\n最后卡在“${getToolStage(lastCall.name)}”这一步。${humanizeExecutionError(lastCall.result)}\n\n你现在需要这样做：${getUserActionForFailure(lastCall.result)}\n\n原始记录可以在下方“执行过程”中逐条展开查看。`;
      }
    } else {
      finalContent = `${isInstallationTask ? '还没有安装好' : '还没有拿到有效结果'}。\n\n这次没有收到可以确认的结果，所以不能把它当作成功。请重新发送一次；如果仍然没有回复，请打开“设置 → 模型”检查当前模型是否可用。`;
    }
  }
  if (failuresBeforeSummary.length > 0 && finalContent
      && /还没|没有完成|不能确认|未完成|失败|卡在|没有处理好/u.test(finalContent)
      && !/(?:下一步|你现在(?:需要|可以)|请(?:打开|点击|提供|登录|授权|检查|选择|回复|上传|填写|重新启动))/u.test(finalContent)) {
    const lastFailure = failuresBeforeSummary.at(-1)!;
    finalContent += `\n\n你现在需要这样做：${getUserActionForFailure(lastFailure.result)}`;
  }
  if (isInstallationTask && !connectorTask) {
    finalContent = guardInstallationSummary(finalContent, originalUserText, callLog.map((call) => call.result).join('\n'));
  }
  if (connectorSetupTask) {
    const connectorVerified = callLog.some((call) => call.success && (call.name === 'test_connector' || (call.name === 'run_command' && /"verification"\s*:\s*(?:true|"true")/iu.test(call.args) && /"connector"\s*:/iu.test(call.args))));
    const connectorPrepared = callLog.some((call) => call.name === 'prepare_connector' && call.success);
    const falselyClaimsReady = /(?:已经|已)(?:成功)?(?:完成|配置|连接|关联)|处理好了|现在可以(?:使用|调用)/u.test(finalContent);
    if (!connectorVerified && falselyClaimsReady) {
      finalContent = connectorPrepared
        ? '还没有完成连接器配置。\n\n配置入口已经准备并打开，但还缺用户必须填写的服务地址、目录或认证凭据，以及保存后的真实连接测试。请在配置窗口填写并点击“一键配置”；测试通过前不会把它说成完成。'
        : '还没有完成连接器配置。\n\n目前没有拿到真实连接测试通过的证据。请先打开对应连接器配置，填写必要信息并保存，然后再进行连接测试。';
    }
  }
  const controllerDidNotComplete = !conversationOnly && executionState.status !== 'completed';
  const falselyClaimsControllerCompletion = /(?:已经|已)(?:成功)?(?:完成|处理|配置|安装|连接)|处理好了|现在可以(?:使用|调用)/u.test(finalContent);
  if (controllerDidNotComplete && falselyClaimsControllerCompletion) {
    finalContent = `还没有完成。\n\n${executionState.decision.reason}\n\n系统没有取得足够的真实执行与验收证据，因此没有采纳模型刚才的完成声明。已产生的文件和执行记录仍然保留。`;
  }
  if (!conversationOnly && callLog.length > 0) {
    const successfulTools = [...new Set(callLog.filter((call) => call.success).map((call) => call.name))];
    const failedTools = [...new Set(callLog.filter((call) => !call.success).map((call) => call.name))];
    const failureLabels = [...new Set(executionState.failures.map((failure) => failure.label))];
    const outcome = stopped || executionState.status === 'stopped'
      ? 'stopped'
      : executionState.status === 'completed' ? 'completed' : 'blocked';
    const lesson = outcome === 'completed'
      ? `${taskDecision.primaryRoute} 路线形成了可验收结果${executionState.routeChanges > 0 ? `，期间切换了 ${executionState.routeChanges} 次路线` : ''}。`
      : failureLabels.length > 0
        ? `最后阻塞属于“${failureLabels.at(-1)}”；再次遇到相似目标时先检查该条件，并避免原样重复失败路线。`
        : '本次没有形成完整验收证据；再次执行时应从未满足的完成标准继续。';
    recordTaskLearning({
      goal: originalUserText,
      outcome,
      successfulTools,
      failedTools,
      failureLabels,
      lesson,
    });
  }
  const finalized = finalizeRuntimeTurn(turnRuntime, {
    status: turnRuntime.phase === 'waiting_user'
      ? 'waiting_user'
      : stopped ? 'stopped'
          : executionState.status === 'completed' ? 'completed'
            : 'checkpointed',
    content: finalContent,
    waitingFor: turnRuntime.phase === 'waiting_user' ? turnRuntime.unresolvedIssues.at(-1) : '',
  });
  turnRuntime = finalized.runtime;
  turnLifecycle = synchronizeTurnLifecycle(turnLifecycle, turnRuntime, finalized.finalization, {
    scope: scope ?? scene,
    goal: originalUserText,
    reason: finalized.finalization.status,
  });
  publishTurnLifecycle();
  return { content: finalContent, usage: totalUsage, contextUsage: latestContextUsage, model: finalModel, executionState, taskDecision, turnRuntime, turnFinalization: finalized.finalization, turnLifecycle };
}

// ===== 初始加载 =====
export function fetchInitial(): AppState {
  // Employees
  let employees: Employee[] = [];
  try {
    const raw = localStorage.getItem(LS_EMPLOYEES);
    if (raw) employees = JSON.parse(raw) as Employee[];
  } catch {}
  if (employees.length === 0) {
    employees = [...seedEmployees];
    saveEmployees(employees);
  }
  // Built-in experts are real office employees in v2.2.1. Existing user
  // profiles, teams, chats and task data remain untouched; only missing
  // catalog IDs are appended during this one-way migration.
  const catalogMigration = materializeCatalogEmployees(employees);
  employees = catalogMigration.employees;
  const distinctColors = ensureDistinctEmployeeColors(employees);
  employees = distinctColors.employees;
  const repairedStations = repairEmployeeStations(employees);
  employees = repairedStations.employees;
  if (catalogMigration.added.length || distinctColors.changed || repairedStations.changed) saveEmployees(employees);

  // Teams (不含 chatMessages)
  let teams: Team[] = [];
  try {
    const raw = localStorage.getItem(LS_TEAMS);
    if (raw) teams = JSON.parse(raw) as Team[];
  } catch {}
  if (teams.length === 0) {
    teams = JSON.parse(JSON.stringify(seedTeams)) as Team[];
    saveTeams(teams);
  }

  // 回填 chatMessages
  for (const t of teams) {
    t.chatMessages = loadChat(t.id);
    // 确保有 tasks 数组
    if (!t.tasks) t.tasks = [];
  }

  const status: AgentStatus = { backendOnline: _backendOnline ?? false, demoRunning: false };

  return { employees, teams, projects: loadProjects(), taskRuns: loadTaskRuns(), status };
}

export function loadProjects(): import('../types').Project[] {
  try {
    const raw = localStorage.getItem(LS_PROJECTS);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function saveProjects(projects: import('../types').Project[]): void {
  try { localStorage.setItem(LS_PROJECTS, JSON.stringify(projects.slice(-80))); } catch (e) {
    console.warn('[hermesClient] Failed to save projects:', e);
  }
}

// ===== 持久化：员工 =====
export function saveEmployees(list: Employee[]): void {
  try {
    localStorage.setItem(LS_EMPLOYEES, JSON.stringify(list));
  } catch (e) {
    console.warn('[hermesClient] Failed to save employees:', e);
  }
}

export function upsertEmployee(emp: Employee, list: Employee[]): Employee[] {
  const idx = list.findIndex((e) => e.id === emp.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = emp;
    saveEmployees(next);
    return next;
  }
  const next = [...list, emp];
  saveEmployees(next);
  return next;
}

export function removeEmployee(id: string, list: Employee[]): Employee[] {
  const next = list.filter((e) => e.id !== id);
  saveEmployees(next);
  return next;
}

// ===== 持久化：团队 =====
export function saveTeams(list: Team[]): void {
  try {
    // 不存 chatMessages，分开存
    const stripped = list.map((t) => ({ ...t, chatMessages: [] }));
    localStorage.setItem(LS_TEAMS, JSON.stringify(stripped));
  } catch (e) {
    console.warn('[hermesClient] Failed to save teams:', e);
  }
}

// ===== 持久化：聊天 =====
function isRawBinaryChatContent(content: unknown): boolean {
  if (typeof content !== 'string') return true;
  const value = content.trim();
  if (!value) return false;
  if (/^data:[a-z][a-z0-9+.-]*\/[a-z0-9+.-]+;base64,/iu.test(value)) return true;

  // 头像或附件的 data URL 被错误写入聊天记录时，有时只留下 Base64 主体。
  // 普通文本、代码和模型回复不可能由数千个无空白 Base64 字符组成。
  const compact = value.replace(/\s/gu, '');
  return compact.length >= 1024
    && compact.length >= value.length * 0.95
    && /^[A-Za-z0-9+/_-]+={0,2}$/u.test(compact);
}

function cleanChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((message): message is ChatMessage => (
    !!message
    && typeof message === 'object'
    && typeof (message as ChatMessage).id === 'string'
    && !isRawBinaryChatContent((message as ChatMessage).content)
  ));
}

export function loadChat(id: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${LS_CHAT_PREFIX}${id}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      const messages = cleanChatMessages(parsed);
      if (Array.isArray(parsed) && messages.length !== parsed.length) {
        localStorage.setItem(`${LS_CHAT_PREFIX}${id}`, JSON.stringify(messages));
      }
      return messages;
    }
  } catch {}
  return [];
}

export function appendChat(id: string, msgs: ChatMessage[]): void {
  try {
    const existing = loadChat(id);
    // 按消息 id 去重：同一 action 可能在多个窗口各执行一次，避免重复落盘
    const existingIds = new Set(existing.map((m) => m.id));
    const toAdd = cleanChatMessages(msgs).filter((m) => !existingIds.has(m.id));
    if (toAdd.length === 0) return;
    const merged = [...existing, ...toAdd].slice(-MAX_CHAT);
    localStorage.setItem(`${LS_CHAT_PREFIX}${id}`, JSON.stringify(merged));
  } catch (e) {
    console.warn('[hermesClient] Failed to append chat:', e);
  }
}

export function replaceChat(id: string, msgs: ChatMessage[]): void {
  try { localStorage.setItem(`${LS_CHAT_PREFIX}${id}`, JSON.stringify(cleanChatMessages(msgs).slice(-MAX_CHAT))); }
  catch (e) { console.warn('[hermesClient] Failed to replace chat:', e); }
}

// ===== 工具：找空闲工位 =====
export { findFreeStation } from './officeStations';

// ===== 私聊（DM）消息持久化：按员工 id 存 =====
const LS_DM_PREFIX = 'hermes_office_dm_';
export function loadDm(empId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${LS_DM_PREFIX}${empId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      const messages = cleanChatMessages(parsed);
      if (Array.isArray(parsed) && messages.length !== parsed.length) {
        localStorage.setItem(`${LS_DM_PREFIX}${empId}`, JSON.stringify(messages));
      }
      return messages;
    }
  } catch {}
  return [];
}
export function appendDm(empId: string, msgs: ChatMessage[]): void {
  try {
    const existing = loadDm(empId);
    // 去重：避免同一消息在多个窗口重复落盘
    const existingIds = new Set(existing.map((m) => m.id));
    const toAdd = cleanChatMessages(msgs).filter((m) => !existingIds.has(m.id));
    if (toAdd.length === 0) return;
    const merged = [...existing, ...toAdd].slice(-MAX_CHAT);
    localStorage.setItem(`${LS_DM_PREFIX}${empId}`, JSON.stringify(merged));
  } catch (e) {
    console.warn('[hermesClient] Failed to append dm:', e);
  }
}

export function replaceDm(empId: string, msgs: ChatMessage[]): void {
  try { localStorage.setItem(`${LS_DM_PREFIX}${empId}`, JSON.stringify(cleanChatMessages(msgs).slice(-MAX_CHAT))); }
  catch (e) { console.warn('[hermesClient] Failed to replace dm:', e); }
}
