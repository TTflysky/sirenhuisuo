import type { Employee, Team, AppState, AgentStatus, ModelConfig } from '../types';
import { repairEmployeeStations } from './officeStations';
import { seedEmployees } from './defaultEmployees';
import { seedTeams } from './defaultTeams';
import { loadTaskRuns } from './taskRuns';
import { ensureDistinctEmployeeColors } from './employeeColors';
import { materializeCatalogEmployees, normalizeCatalogEmployeePersonas } from './expertCatalog';
import {
  APP_STATE_STORAGE_KEYS,
  appendChat,
  appendDm,
  loadChat,
  loadDm,
  loadProjects,
  removeEmployee,
  replaceChat,
  replaceDm,
  saveEmployees,
  saveProjects,
  saveTeams,
  upsertEmployee,
} from './appStateStorage';
import { parseGeneratedAvatarPayload } from './generatedAvatar';
import { buildImageEditFormData, selectEditableImage } from '../engine/imageRequest.mjs';
import { consumeOpenAIChatStream } from '../engine/chatStream.mjs';
import { normalizeModelMessage } from '../engine/modelOutputGateway.mjs';
import { prepareChatRequestTurns } from '../engine/chatRequestContext.mjs';
import { createCompatibilityReport } from '../engine/modelCompatibility.mjs';
import { runReliableModelRequest } from './modelReliability';
import {
  resolveImageSpecification,
  type ImageGenerationOptions,
  type ImageSpecification,
} from '../engine/imageSpecifications.mjs';
import { isResearchEvidenceRelevant } from '../engine/agentGuardrails.mjs';
import { isToolResultSuccessful } from './assistantPresentation';
import {
  TASK_DECISION_TOOL,
  TASK_DECISION_TOOL_NAME,
  buildTaskDecisionMessages,
  createFallbackTaskDecision,
  normalizeTaskDecision,
  parseTaskDecisionToolCall,
  type TaskDecision,
} from '../engine/taskDecisionKernel.mjs';
import { buildTaskDecisionAudit } from '../engine/taskDecisionPipeline.mjs';
import { buildTaskLearningContext } from '../engine/taskLearningMemory';
import {
  buildTaskSummaryMaterial,
  restoreTaskContext,
  type TaskContextSnapshot,
  type TaskModelSummaryProposal,
} from '../engine/taskContext.mjs';
import {
  USER_MEMORY_CATEGORY_LABELS,
  buildUserContext,
  clampMemoryValue,
  inferMemoryCategory,
  loadUserMemory,
  loadUserProfile,
  upsertUserMemory,
} from './userMemory';
import { createRunAgentLoop } from './agentLoopRuntime';

export {
  USER_MEMORY_CATEGORY_LABELS,
  appendUserMemory,
  buildUserContext,
  loadUserMemory,
  loadUserProfile,
  organizeUserMemory,
  saveUserMemory,
  saveUserProfile,
  upsertUserMemory,
} from './userMemory';
export type { UserMemoryCategory, UserMemoryItem } from './userMemory';

const LS_SETTINGS = 'hermes_office_settings';
const LS_EMPLOYEES = APP_STATE_STORAGE_KEYS.employees;
const LS_TEAMS = APP_STATE_STORAGE_KEYS.teams;

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
  lastCompatibilityReport?: ReturnType<typeof createCompatibilityReport>;
  /** Explicit capabilities are optional. Older entries are inferred from the model id. */
  capabilities?: ModelCapability[];
}

export type ModelCapability = 'chat' | 'image';
export type ChatModelScene = 'assistant' | 'dm' | 'team';

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
  /** The model selected from each chat composer. Keeps a temporary image switch out of default assignments. */
  chatModelOverrides?: Partial<Record<ChatModelScene, string>>;
  /** Per-chat image output controls. They do not change the assigned text model. */
  imageGenerationOptions?: Partial<Record<ChatModelScene, ImageGenerationOptions>>;
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
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('taiji-settings:changed', { detail: s }));
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
    return { provider: active.provider, apiHost: active.apiHost, apiKey: active.apiKey, model: active.model, contextWindowTokens: active.contextWindowTokens, refModelId: active.id };
  }
  // 向后兼容：旧版直接用 provider/apiHost/apiKey/model 字段
  return { provider: s.provider, apiHost: s.apiHost, apiKey: s.apiKey, model: s.model, contextWindowTokens: s.contextWindowTokens };
}

/** 获取助理机器人模型配置（优先从 modelLibrary 查找，回退到 assistantModelConfig，再回退到全局） */
export function getAssistantModel(): ModelConfig {
  const s = loadSettings();
  if (s.modelLibrary && s.modelLibrary.length > 0 && s.assistantModelId) {
    const am = s.modelLibrary.find(m => m.id === s.assistantModelId);
    if (am) return { provider: am.provider, apiHost: am.apiHost, apiKey: am.apiKey, model: am.model, contextWindowTokens: am.contextWindowTokens, refModelId: am.id };
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
  return { provider: model.provider, apiHost: model.apiHost, apiKey: model.apiKey, model: model.model, contextWindowTokens: model.contextWindowTokens, refModelId: model.id };
}

function configuredModelById(id?: string, capability?: ModelCapability): ModelConfig | undefined {
  const settings = loadSettings();
  if (!id || !settings.modelLibrary?.length) return undefined;
  const model = settings.modelLibrary.find((item) => item.id === id);
  if (!model || (capability && !getModelCapabilities(model).includes(capability))) return undefined;
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
  return configuredModelById(loadSettings().diagnosticModelId, 'chat');
}

/** Image generation never silently falls back to a chat model. */
export function getImageGenerationModel(): ModelConfig | undefined {
  return configuredModelById(loadSettings().imageModelId, 'image');
}

export function isImageGenerationModel(modelConfig?: Pick<ModelConfig, 'model'>): boolean {
  return /^gpt-image-(?:1(?:\.5|-mini)?|2)$/iu.test(modelConfig?.model?.trim() ?? '');
}

export function getModelCapabilities(model: Pick<ModelConfig, 'model'> & Partial<ModelEntry>): ModelCapability[] {
  if (model.capabilities?.length) return [...new Set(model.capabilities)];
  return isImageGenerationModel(model) ? ['image'] : ['chat'];
}

/** Resolve the model selected in a chat composer without changing role-level defaults. */
export function getConversationModel(scene: ChatModelScene, employee?: Employee): ModelConfig {
  const settings = loadSettings();
  const overrideId = settings.chatModelOverrides?.[scene];
  const override = overrideId ? settings.modelLibrary?.find((entry) => entry.id === overrideId) : undefined;
  if (override) {
    return {
      provider: override.provider,
      apiHost: override.apiHost,
      apiKey: override.apiKey,
      model: override.model,
      contextWindowTokens: override.contextWindowTokens,
      refModelId: override.id,
    };
  }
  if (scene === 'assistant') return getAssistantModel();
  if (scene === 'dm' && employee) return getEmployeeModel(employee);
  return getActiveModel();
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
  compatibility: ReturnType<typeof createCompatibilityReport>;
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
  const imageModel = isImageGenerationModel(mc);
  const endpoint = base ? endpointUrl(base, imageModel ? '/images/generations' : '/chat/completions') : '';
  const capability = imageModel ? 'image_generation' : 'chat';
  const compatibility = (probe: Record<string, unknown>) => createCompatibilityReport({ modelConfig: mc, probes: [{ capability, endpoint, ...probe }] });
  if (!base) return { ok: false, message: '请先填写 API 地址', latencyMs: 0, endpoint, compatibility: compatibility({ missingConfig: true }) };
  const model = mc.model?.trim() || getProvider(mc.provider).defaultModel;
  if (!model) return { ok: false, message: '请先填写模型名称', latencyMs: 0, endpoint, compatibility: compatibility({ missingConfig: true }) };
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (mc.apiKey) headers['Authorization'] = `Bearer ${mc.apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify(imageModel
        ? buildImageGenerationRequest(model, 'A simple blue circle on a white background.')
        : { model, messages: [{ role: 'user', content: '连接测试：请只回复 OK' }], stream: false }),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}：${apiErrorMessage(raw)}`, latencyMs, endpoint, httpStatus: res.status, compatibility: compatibility({ httpStatus: res.status, body: raw, ok: false }) };
    }
    let data: any;
    try { data = JSON.parse(raw); } catch {
      return { ok: false, message: 'HTTP 200，但响应不是有效 JSON', latencyMs, endpoint, httpStatus: res.status, compatibility: compatibility({ httpStatus: res.status, body: raw, ok: false }) };
    }
    const reply = data?.choices?.[0]?.message?.content;
    const generatedImage = data?.data?.[0]?.b64_json || data?.data?.[0]?.url;
    if (imageModel ? !generatedImage : typeof reply !== 'string' || !reply.trim()) {
      const message = imageModel ? 'HTTP 200，但图片接口没有返回 Base64 或图片地址' : 'HTTP 200，但模型没有返回可用的聊天内容';
      return { ok: false, message, latencyMs, endpoint, httpStatus: res.status, compatibility: compatibility({ httpStatus: res.status, body: data, ok: false }) };
    }
    return { ok: true, message: `${imageModel ? '图片' : '聊天'}调用成功 · ${latencyMs} ms · HTTP ${res.status}`, latencyMs, endpoint, httpStatus: res.status, compatibility: compatibility({ httpStatus: res.status, body: data, ok: true }) };
  } catch (e: any) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = e?.name === 'AbortError'
      ? `请求超时：20 秒内模型没有返回结果`
      : `网络错误：${e?.message ?? '无法连接模型服务'}`;
    return { ok: false, message, latencyMs, endpoint, compatibility: compatibility({ timeout: e?.name === 'AbortError', networkError: e?.name !== 'AbortError', errorName: e?.name, error: e?.message }) };
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
    .map(m => `[${USER_MEMORY_CATEGORY_LABELS[m.category ?? 'identity']}] ${m.content}`)
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
        const confidence = clampMemoryValue(Number(memory.confidence) || 0, 0, 1);
        if (confidence < 0.65) continue;
        upsertUserMemory({
          ts: now,
          content: memory.content,
          source,
          category: Object.hasOwn(USER_MEMORY_CATEGORY_LABELS, memory.category) ? memory.category : inferMemoryCategory(memory.content),
          importance: clampMemoryValue(Math.round(Number(memory.importance) || 3), 1, 5),
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
  const multipartBody = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(!multipartBody ? { 'Content-Type': 'application/json' } : {}),
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
  specification?: ImageSpecification;
}

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n: 1;
  size: string;
  quality?: 'auto' | 'low' | 'medium' | 'high';
  output_format?: 'png';
  response_format?: 'b64_json';
}

/**
 * GPT Image 2 always returns Base64 image data and rejects the legacy
 * response_format option. Retain it only for older OpenAI-compatible APIs.
 */
export function buildImageGenerationRequest(model: string, prompt: string, options: Partial<ImageGenerationOptions> = {}): ImageGenerationRequest {
  const specification = resolveImageSpecification(model, options);
  const request: ImageGenerationRequest = { model, prompt, n: 1, size: specification.size };
  if (/^gpt-image-/iu.test(model.trim())) request.quality = specification.quality;
  if (/^gpt-image-2$/iu.test(model.trim())) request.output_format = 'png';
  else request.response_format = 'b64_json';
  return request;
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('生成图片读取失败'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });
}

/** Generate an image, or edit the first image attached to the current turn. */
export async function generateImage(prompt: string, modelConfig = getImageGenerationModel(), attachments: Attachment[] = [], options: Partial<ImageGenerationOptions> = {}): Promise<GeneratedAvatarImage> {
  const sourceImage = selectEditableImage(attachments);
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error(sourceImage ? '请说明要如何修改这张图片' : '请先填写图片描述');
  if (!modelConfig?.apiHost?.trim() || !modelConfig.model?.trim()) throw new Error('还没有配置头像生图模型，请先在模型库中指定一个生图模型');
  const base = resolveApiBase(modelConfig as AppSettings);
  const model = modelConfig.model.trim();
  const specification = resolveImageSpecification(model, options);
  const response = await apiFetch(sourceImage ? '/images/edits' : '/images/generations', {
    method: 'POST',
    body: sourceImage
      ? buildImageEditFormData(model, cleanPrompt, sourceImage, specification)
      : JSON.stringify(buildImageGenerationRequest(model, cleanPrompt, specification)),
  }, 180000, modelConfig.apiKey, base);
  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${sourceImage ? '图片编辑' : '生图'}接口返回 ${response.status}：${apiErrorMessage(raw)}`);
  let payload: any;
  try { payload = JSON.parse(raw); }
  catch { throw new Error('生图接口返回的不是有效 JSON'); }
  const result = parseGeneratedAvatarPayload(payload);
  if (result.kind === 'data') return { dataUrl: result.dataUrl, model, revisedPrompt: result.revisedPrompt, specification };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const downloaded = await fetch(result.url, { signal: controller.signal });
    if (!downloaded.ok) throw new Error(`生成图片下载失败（HTTP ${downloaded.status}）`);
    const blob = await downloaded.blob();
    if (!blob.type.startsWith('image/')) throw new Error('生图地址返回的不是图片');
    if (blob.size > 48 * 1024 * 1024) throw new Error('生成图片超过 48MB，请降低清晰度或图片规格');
    return { dataUrl: await blobAsDataUrl(blob), model, revisedPrompt: result.revisedPrompt, specification };
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('生成图片下载超过 60 秒，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Backward-compatible avatar entry point. */
export async function generateEmployeeAvatarImage(prompt: string, modelConfig = getImageGenerationModel()): Promise<GeneratedAvatarImage> {
  return generateImage(prompt, modelConfig);
}

export function generatedImageAttachment(image: GeneratedAvatarImage): Attachment {
  const comma = image.dataUrl.indexOf(',');
  const base64 = comma >= 0 ? image.dataUrl.slice(comma + 1) : image.dataUrl;
  return {
    name: `generated-${image.specification?.size ?? 'image'}-${Date.now()}.png`,
    mime: 'image/png',
    dataUrl: image.dataUrl,
    size: Math.floor(base64.length * 0.75),
    kind: 'image',
  };
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

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ChatContent;
  tool_call_id?: string;
  name?: string;
  /** DeepSeek thinking mode requires the assistant reasoning to round-trip with tool calls. */
  reasoning_content?: string;
}

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
  reasoningContent?: string;
  usage: TokenUsage;
  contextUsage: ContextUsage;
  model: string;
  toolCalls?: ToolCallResult[];  // function-calling 返回的工具调用
  outputDiagnostics?: {
    gatewayVersion: number;
    protocol: string;
    controlDetected: boolean;
    parseStatus: string;
    fatal: boolean;
    toolCallCount: number;
    errors: string[];
  };
  reliability?: { key: string; latencyMs: number; firstTokenMs?: number; outcome: 'success' | 'failure' };
}

export interface ChatCompletionRequestOptions {
  /** 默认 auto；任务编译等内核调用可强制指定一个函数。 */
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** 当前请求独立超时，不影响普通长任务的默认五分钟。 */
  timeoutMs?: number;
  /** 内核分类调用可关闭自动用户记忆注入，改用显式筛选后的上下文。 */
  injectUserContext?: boolean;
  /** Receives public answer text as it arrives. It is display-only until final validation completes. */
  onTextDelta?: (delta: string, accumulated: string) => void;
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
  const reliabilityConfig: ModelConfig = { provider: merged.provider, apiHost: merged.apiHost, apiKey: merged.apiKey, model,
    contextWindowTokens: merged.contextWindowTokens, refModelId: modelConfig?.refModelId };

  // 注入与当前问题相关的长期记忆和画像；内核调用可显式关闭，避免重复污染分类输入。
  const latestUserQuery = [...turns].reverse().find((turn) => turn.role === 'user');
  const latestUserQueryText = typeof latestUserQuery?.content === 'string'
    ? latestUserQuery.content
    : (latestUserQuery?.content ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text ?? '').join('\n');
  const userCtx = requestOptions.injectUserContext === false ? '' : buildUserContext(latestUserQueryText);
  const finalTurns = prepareChatRequestTurns(turns, { userContext: userCtx, extraSystemContext, attachments });
  const alternatives = (loadSettings().modelLibrary ?? [])
    .filter((entry) => entry.id !== reliabilityConfig.refModelId && getModelCapabilities(entry).includes('chat'))
    .map((entry) => ({ provider: entry.provider, apiHost: entry.apiHost, model: entry.model, refModelId: entry.id }));
  const reliable = await runReliableModelRequest(reliabilityConfig, alternatives, async ({ markFirstToken }) => {
    const streaming = typeof requestOptions.onTextDelta === 'function';
    const onTextDelta = streaming
      ? (delta: string, accumulated: string) => {
        if (delta) markFirstToken();
        requestOptions.onTextDelta?.(delta, accumulated);
      }
      : undefined;
    const res = await apiFetch('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: finalTurns,
        stream: streaming,
        ...(tools && tools.length > 0 ? { tools, tool_choice: requestOptions.toolChoice ?? 'auto' } : {}),
      }),
    }, requestOptions.timeoutMs ?? 300000, merged.apiKey, base, requestSignal); // Long-running model/tool requests may take minutes on a busy provider.
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const error = Object.assign(new Error(`模型响应 ${res.status}: ${txt.slice(0, 120)}`), { status: res.status, modelFailureDetail: txt });
      throw error;
    }
    const streamed = streaming
      ? await consumeOpenAIChatStream(res, { onTextDelta })
      : undefined;
    const data = streamed ? undefined : await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    const normalized = normalizeModelMessage(streamed ? {
      content: streamed.content,
      reasoning_content: streamed.reasoningContent,
      tool_calls: (streamed.toolCalls ?? []).map((call: ToolCallResult) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    } : msg, { toolsEnabled: Boolean(tools?.length) });
    if (normalized.diagnostics.fatal) {
      const error = Object.assign(new Error('模型输出包含无法解析的工具协议，已阻止其进入聊天'), { modelOutputDiagnostics: normalized.diagnostics, retryable: true });
      throw error;
    }
    const content: string | null = normalized.content;
    const reasoningContent = streamed?.reasoningContent
      ?? (typeof msg.reasoning_content === 'string' ? msg.reasoning_content : undefined);
    const u = streamed?.usage ?? data?.usage ?? {};
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
    const toolCalls: ToolCallResult[] | undefined = normalized.toolCalls.length
      ? normalized.toolCalls.map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }))
      : undefined;
    if (!content && !toolCalls) throw new Error('模型返回为空');
    return { value: { content, reasoningContent, usage, contextUsage, model: streamed?.model || model, toolCalls, outputDiagnostics: normalized.diagnostics }, status: res.status };
  });
  return { ...reliable.value, reliability: reliable.reliability };
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
  decisionContext: { activeTaskGoal?: string } = {},
): Promise<{ decision: TaskDecision; decisionAudit?: ReturnType<typeof buildTaskDecisionAudit>; usage: TokenUsage; contextUsage?: ContextUsage; model?: string }> {
  const userTurns = turns.filter((turn) => turn.role === 'user').map((turn) => typeof turn.content === 'string'
    ? turn.content
    : (turn.content ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text ?? '').join('\n'));
  const latestMessage = userTurns.at(-1) ?? '';
  const previousUserMessage = userTurns.at(-2) ?? '';
  const availableTools = tools.map((tool) => String(tool?.function?.name ?? '')).filter(Boolean);
  const fallback = createFallbackTaskDecision({ latestMessage, previousUserMessage, activeTaskGoal: decisionContext.activeTaskGoal, availableTools });
  const relevantTaskExperience = buildTaskLearningContext(fallback.goal);
  const recentHistory = turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').slice(-24).map((turn) => ({
    role: turn.role,
    content: typeof turn.content === 'string'
      ? turn.content
      : (turn.content ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text ?? '').join('\n'),
  }));
  const input = {
    latestMessage,
    previousUserMessage,
    activeTaskGoal: decisionContext.activeTaskGoal,
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
    const normalized = normalizeTaskDecision(candidate, input);
    const decisionAudit = buildTaskDecisionAudit(input, normalized, {
      fallback,
      candidate,
      modelAttempted: true,
    });
    const decision = { ...normalized, decisionAudit };
    return {
      decision,
      decisionAudit,
      usage: response.usage,
      contextUsage: response.contextUsage,
      model: response.model,
    };
  } catch (error) {
    const decisionAudit = buildTaskDecisionAudit(input, fallback, {
      fallback,
      modelAttempted: true,
      modelFailureClass: /保护窗口|暂时不可用|503|5\d\d/iu.test(error instanceof Error ? error.message : String(error)) ? 'server' : 'unavailable',
    });
    return {
      decision: { ...fallback, decisionAudit },
      decisionAudit,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}

// ===== Agent 循环：调模型 + 执行工具，直到产出最终回复 =====
export type { AgentLoopOpts } from './agentLoopRuntime';

export const runAgentLoop = createRunAgentLoop({
  chatCompletion,
  isUsefulToolOutcome,
  isConnectorTask,
  isConnectorSetupRequest,
  compileTaskDecision,
});
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
  const catalogPersonaMigration = normalizeCatalogEmployeePersonas(employees);
  employees = catalogPersonaMigration.employees;
  const distinctColors = ensureDistinctEmployeeColors(employees);
  employees = distinctColors.employees;
  const repairedStations = repairEmployeeStations(employees);
  employees = repairedStations.employees;
  if (catalogMigration.added.length || catalogPersonaMigration.changed || distinctColors.changed || repairedStations.changed) saveEmployees(employees);

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

// ===== 工具：找空闲工位 =====
export { findFreeStation } from './officeStations';

export {
  appendChat,
  appendDm,
  loadChat,
  loadDm,
  loadProjects,
  removeEmployee,
  replaceChat,
  replaceDm,
  saveEmployees,
  saveProjects,
  saveTeams,
  upsertEmployee,
};
