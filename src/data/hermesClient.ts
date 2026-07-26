import type { Employee, Team, ChatMessage, AppState, AgentStatus, ModelConfig } from '../types';
import { MAX_STATIONS } from '../types';
import { seedEmployees } from './defaultEmployees';
import { seedTeams } from './defaultTeams';
import type { OutputScope } from './outputs';
import { loadTaskRuns } from './taskRuns';
import { ensureDistinctEmployeeColors } from './employeeColors';
import {
  AUTONOMOUS_EXECUTION_GUIDE,
  BEGINNER_RESPONSE_GUIDE,
  EXECUTION_SELF_REVIEW_GUIDE,
  buildContinuationGuide,
  buildRecoveryGuide,
  getToolStage,
  guardInstallationSummary,
  humanizeExecutionError,
  isToolResultSuccessful,
} from './assistantPresentation';

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
  showThoughtChain?: boolean;   // 助理是否显示思维链（默认 true）
  followUpMode?: 'queue' | 'steer'; // 运行中收到新消息：排队或引导当前执行
}

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

// ===== 多模型库辅助 =====
/** 获取当前激活的全局模型配置（优先从 modelLibrary 查找，回退到旧字段） */
export function getActiveModel(): ModelConfig {
  const s = loadSettings();
  if (s.modelLibrary && s.modelLibrary.length > 0) {
    const active = s.modelLibrary.find(m => m.id === s.activeModelId) ?? s.modelLibrary[0];
    return { provider: active.provider, apiHost: active.apiHost, apiKey: active.apiKey, model: active.model };
  }
  // 向后兼容：旧版直接用 provider/apiHost/apiKey/model 字段
  return { provider: s.provider, apiHost: s.apiHost, apiKey: s.apiKey, model: s.model };
}

/** 获取助理机器人模型配置（优先从 modelLibrary 查找，回退到 assistantModelConfig，再回退到全局） */
export function getAssistantModel(): ModelConfig {
  const s = loadSettings();
  if (s.modelLibrary && s.modelLibrary.length > 0 && s.assistantModelId) {
    const am = s.modelLibrary.find(m => m.id === s.assistantModelId);
    if (am) return { provider: am.provider, apiHost: am.apiHost, apiKey: am.apiKey, model: am.model };
  }
  // 助理手动配置优先于全局激活模型
  if (s.assistantModelConfig) return s.assistantModelConfig;
  // 模型库启用后，旧字段通常为空。助理未单独指定模型时必须继承当前激活模型，
  // 否则会误判为“未配置 API”并持续返回本地兜底文案。
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
        refModelId: custom.refModelId,
      };
    }
  }

  return {
    provider: custom.provider ?? active.provider,
    apiHost: custom.apiHost ?? active.apiHost,
    apiKey: custom.apiKey ?? active.apiKey,
    model: custom.model ?? active.model,
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
export function buildUserContext(): string {
  const profile = loadUserProfile().trim();
  const memory = loadUserMemory();
  let ctx = '';
  if (profile) {
    ctx += `## 用户画像\n${profile}\n\n`;
  }
  if (memory.length > 0) {
    const selected: UserMemoryItem[] = [];
    const ranked = [...memory].sort((a, b) =>
      (b.importance ?? 3) - (a.importance ?? 3) || (b.updatedAt ?? b.ts) - (a.updatedAt ?? a.ts));
    for (const category of Object.keys(MEMORY_CATEGORY_LABELS) as UserMemoryCategory[]) {
      const candidate = ranked.find((item) => item.category === category && (item.confidence ?? 0.8) >= 0.65);
      if (candidate) selected.push(candidate);
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
async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = 4000, overrideKey?: string, overrideBase?: string): Promise<Response> {
  const base = overrideBase ?? resolveApiBase();
  if (!base) throw new Error('no api base');
  const url = endpointUrl(base, path);
  const controller = new AbortController();
  let timedOut = false;
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
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (timedOut) throw new Error(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）。请检查模型服务负载、网络或稍后重试。`);
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('模型请求已取消。');
    throw e;
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
export interface ToolCallResult {
  id: string;
  name: string;
  arguments: string;  // JSON string
}
export interface ChatResult {
  content: string | null;        // null = 模型返回了 tool_calls 无文本
  usage: TokenUsage;
  model: string;
  toolCalls?: ToolCallResult[];  // function-calling 返回的工具调用
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
): Promise<ChatResult> {
  const merged = resolveChatSettings(modelConfig); // 合并配置
  const base = resolveApiBase(merged);
  if (!base) throw new Error('未配置 API');
  const model = merged.model?.trim() || getProvider(merged.provider).defaultModel || 'gpt-4o-mini';

  // 注入用户长期记忆和画像到系统提示中
  const userCtx = buildUserContext();
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
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    }),
  }, 300000, merged.apiKey, base); // Long-running model/tool requests may take minutes on a busy provider.
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`模型响应 ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message ?? {};
  const content: string | null = typeof msg.content === 'string' && msg.content.trim() ? msg.content.trim() : null;
  const u = data?.usage ?? {};
  const usage: TokenUsage = {
    promptTokens: u.prompt_tokens ?? estimateTokens(turns.map((t) => t.content).join('')),
    completionTokens: u.completion_tokens ?? (content ? estimateTokens(content) : 50),
    totalTokens: u.total_tokens ?? 0,
  };
  if (!usage.totalTokens) usage.totalTokens = usage.promptTokens + usage.completionTokens;
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
  return { content, usage, model, toolCalls };
}

// 粗略估算 token（中文≈1.5字/token，英文≈4字符/token）
function estimateTokens(text: string): number {
  let n = 0;
  for (const ch of text) {
    n += /[一-鿿]/.test(ch) ? 0.67 : 0.25;
  }
  return Math.max(1, Math.round(n));
}

// ===== Agent 循环：调模型 + 执行工具，直到产出最终回复 =====
export interface AgentLoopOpts {
  turns: ChatTurn[];
  tools: any[];
  scene: string;
  label: string;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, args: string, result: string, success?: boolean) => void;
  modelConfig?: ModelConfig;  // 可选员工独立模型配置
  extraSystemContext?: string; // 额外的系统上下文（如 soul.md）
  scope?: OutputScope;        // 产出物作用域
  attachments?: Attachment[];  // 用户上传/粘贴的图片附件（多模态视觉）
  shouldStop?: () => boolean;  // 自主执行中断信号（如用户点「停止」）
  consumeSteeringMessages?: () => string[]; // 运行中追加的老板指令
}

function getUserActionForFailure(raw: string): string {
  if (/401|403|unauthorized|forbidden|api\s*key|鉴权|密钥/iu.test(raw)) {
    return '打开“设置 → 模型”，检查接口地址和 API Key，保存后回复“继续”，我会从连接验证开始。';
  }
  if (/验证码|verification\s*code|captcha|登录|sign[ -]?in|oauth|授权/iu.test(raw)) {
    return '先在对应服务完成登录、验证码或授权，完成后回复“继续”，我会接着验证。';
  }
  if (/EACCES|EPERM|permission|权限|拒绝访问|administrator/iu.test(raw)) {
    return '请用管理员身份重新打开私人办公会所，然后回复“继续”，我会从失败步骤接着做。';
  }
  if (/timeout|timed out|ECONN|ENOTFOUND|network|网络|连接失败/iu.test(raw)) {
    return '先确认电脑能正常访问对应网站或服务，然后回复“继续”，我会重新连接并验证。';
  }
  if (/ENOENT|not found|not recognized|找不到|不存在/iu.test(raw)) {
    return '需要的程序或文件没有找到。请回复“继续”，我会保留现有成果并改用另一种安装或查找方式。';
  }
  return '请回复“继续”，我会保留已经完成的内容并换一条不同路线；需要核对细节时，可展开下方最后一条失败记录。';
}

export async function runAgentLoop(opts: AgentLoopOpts): Promise<{ content: string; usage: TokenUsage; model: string }> {
  const { turns, tools, scene, label, onToolCall, onToolResult, modelConfig, extraSystemContext, scope, attachments, shouldStop, consumeSteeringMessages } = opts;
  let currentTurns = [...turns];
  const originalUserContent = [...turns].reverse().find((turn) => turn.role === 'user')?.content;
  const originalUserText = typeof originalUserContent === 'string'
    ? originalUserContent
    : (originalUserContent ?? []).filter((part): part is ContentPart => part.type === 'text').map((part) => part.text).join('\n');
  const isInstallationTask = /安装|装好|装上|安装包|部署/u.test(originalUserText);
  const isSkillInstallation = isInstallationTask && /skill|技能|插件/iu.test(originalUserText);
  currentTurns = [{ role: 'system', content: AUTONOMOUS_EXECUTION_GUIDE }, ...currentTurns];

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

  let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finalContent: string | null = null;
  let finalModel = '';
  const iterationsPerPhase = 8;
  const maxIter = 128;
  const maxToolCallsPerPhase = 24;
  const maxAutonomousToolPhases = 5;
  const callLog: Array<{ name: string; args: string; result: string; success: boolean }> = [];
  const toolResultCache = new Map<string, { output: string; success: boolean }>();
  const successfulCalls = new Set<string>();
  let stopped = false;
  let finalReviewRequested = false;
  let consecutiveFailures = 0;
  let phaseStartSuccessCount = 0;
  let phaseStartLogIndex = 0;
  let stalledPhases = 0;
  let executionBudgetReached = false;
  let toolCallsThisPhase = 0;
  let completedToolPhases = 0;
  let phaseToolBudgetReached = false;

  for (let iter = 0; iter < maxIter; iter++) {
    if (shouldStop?.()) { stopped = true; break; } // 用户停止：本轮前中止
    if (phaseToolBudgetReached) {
      const phaseCalls = callLog.slice(phaseStartLogIndex);
      const madeProgress = successfulCalls.size > phaseStartSuccessCount;
      stalledPhases = madeProgress ? 0 : stalledPhases + 1;
      const summaryRows = phaseCalls.slice(-14).map((call, index) => {
        const state = call.success ? '完成' : `未完成（${humanizeExecutionError(call.result)}）`;
        return `${index + 1}. ${getToolStage(call.name)}：${state}`;
      });
      const summary = summaryRows.length > 0 ? summaryRows.join('\n') : '这一阶段没有产生有效操作。';
      if (stalledPhases >= 2 || completedToolPhases >= maxAutonomousToolPhases - 1) {
        executionBudgetReached = true;
        break;
      }
      completedToolPhases += 1;
      currentTurns = [
        ...checkpointBaseTurns,
        { role: 'system', content: `${buildContinuationGuide(summary, stalledPhases)}\n\n已自动完成第 ${completedToolPhases} 个执行阶段的上下文压缩。不要向用户索要“继续”，请直接从未完成目标进入下一阶段，并优先验证能否换工具、换路径或补齐验收。` },
      ];
      phaseStartSuccessCount = successfulCalls.size;
      phaseStartLogIndex = callLog.length;
      consecutiveFailures = 0;
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
      const summary = summaryRows.length > 0 ? summaryRows.join('\n') : '这一阶段没有产生有效操作。';
      if (stalledPhases >= 2) {
        executionBudgetReached = true;
        break;
      }
      currentTurns = [
        ...checkpointBaseTurns,
        { role: 'system', content: buildContinuationGuide(summary, stalledPhases) },
      ];
      phaseStartSuccessCount = successfulCalls.size;
      phaseStartLogIndex = callLog.length;
      consecutiveFailures = 0;
      finalReviewRequested = false;
    }
    const beforeCallGuidance = consumeSteeringMessages?.() ?? [];
    if (beforeCallGuidance.length) {
      currentTurns.push({ role: 'user', content: `## 老板刚刚追加的指令（优先于之前要求）\n${beforeCallGuidance.join('\n')}` });
    }
    const r = await chatCompletion(currentTurns, scene, label, tools, modelConfig, extraSystemContext);
    totalUsage.promptTokens += r.usage.promptTokens;
    totalUsage.completionTokens += r.usage.completionTokens;
    totalUsage.totalTokens += r.usage.totalTokens;
    if (!finalModel) finalModel = r.model;

    // HTTP 请求无法在生成中途改写，但返回后必须先吸收最新指令，
    // 不能继续执行已经过时的工具调用或下一步骤。
    const afterCallGuidance = consumeSteeringMessages?.() ?? [];
    if (afterCallGuidance.length) {
      currentTurns.push({ role: 'user', content: `## 老板在你思考期间追加的指令（立即调整当前执行）\n${afterCallGuidance.join('\n')}` });
      continue;
    }

    if (r.toolCalls && r.toolCalls.length > 0) {
      // 模型返回了工具调用：执行，结果加入对话继续
      const { executeTool } = await import('../engine/tools');
      let iterationHadFailure = false;
      for (const tc of r.toolCalls) {
        if (toolCallsThisPhase >= maxToolCallsPerPhase) {
          phaseToolBudgetReached = true;
          break;
        }
        onToolCall?.(tc.name, tc.arguments);
        const cacheKey = `${tc.name}:${tc.arguments}`;
        const cached = toolResultCache.get(cacheKey);
        const result = cached !== undefined
          ? { toolCallId: tc.id, name: tc.name, success: cached.success, output: `相同工具调用已执行过，复用结果：\n${cached.output}` }
          : await executeTool({ id: tc.id, name: tc.name, args: (() => { try { return JSON.parse(tc.arguments); } catch { return {}; } })(), scope });
        const resultSuccess = result.success && isToolResultSuccessful(result.output, result.success);
        if (resultSuccess) successfulCalls.add(cacheKey);
        if (resultSuccess) {
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          iterationHadFailure = true;
        }
        if (cached === undefined) toolResultCache.set(cacheKey, { output: result.output.slice(0, 6000), success: resultSuccess });
        onToolResult?.(tc.name, tc.arguments, result.output, resultSuccess);
        callLog.push({ name: tc.name, args: tc.arguments, result: result.output.slice(0, 1200), success: resultSuccess });
        toolCallsThisPhase += 1;
        if (toolCallsThisPhase >= maxToolCallsPerPhase) phaseToolBudgetReached = true;
        // 对 tool output 长度做上限，防止下游模型调用因上下文超长失败
        const truncated = result.output.slice(0, 1500);
        currentTurns.push({ role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }] } as any);
        currentTurns.push({ role: 'tool', content: truncated, tool_call_id: tc.id } as any);
        if (shouldStop?.()) { stopped = true; break; } // 用户停止：工具执行后中止
      }
      if (stopped) break;
      if (phaseToolBudgetReached) continue;
      if (iterationHadFailure) {
        currentTurns.push({ role: 'system', content: buildRecoveryGuide(consecutiveFailures) });
      }
    } else if (r.content) {
      if (callLog.length > 0 && !finalReviewRequested) {
        currentTurns.push({ role: 'assistant', content: r.content });
        currentTurns.push({ role: 'system', content: EXECUTION_SELF_REVIEW_GUIDE });
        finalReviewRequested = true;
        continue;
      }
      // 执行过工具的任务必须经过一次独立自检，再接受最终答复。
      finalContent = r.content;
      break;
    } else {
      break;
    }
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
        { role: 'user', content: `用户最初目标：\n${originalUserText.slice(0, 4000)}\n\n已成功的阶段：\n${successfulStages.length ? successfulStages.join('、') : '暂时没有可确认的完成项'}\n\n最近失败证据：\n${failureEvidence || '没有明确失败，但执行预算已经用完。'}\n\n是否达到执行预算：${executionBudgetReached ? '是' : '否'}\n\n请用通俗中文交接，必须包含：\n1. 第一行明确整个目标成功还是没有成功；\n2. 已经完成并保留了什么；\n3. 最后卡在哪一类事情和通俗原因；\n4. 用户现在唯一最省事的下一步，明确点哪里、提供什么或回复什么。\n如果不需要用户提供账号、授权、文件或选择，就直说用户不需要改设置，并说明回复“继续”后你会换哪类路线。不要只说“重新验收”“请重试”或“查看执行过程”。` },
      ], scene, `${label} · 失败交接`, undefined, modelConfig, extraSystemContext);
      totalUsage.promptTokens += handoff.usage.promptTokens;
      totalUsage.completionTokens += handoff.usage.completionTokens;
      totalUsage.totalTokens += handoff.usage.totalTokens;
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
        finalContent = isSkillInstallation
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
  if (isInstallationTask) {
    finalContent = guardInstallationSummary(finalContent, originalUserText, callLog.map((call) => call.result).join('\n'));
  }
  return { content: finalContent, usage: totalUsage, model: finalModel };
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
  const distinctColors = ensureDistinctEmployeeColors(employees);
  employees = distinctColors.employees;
  if (distinctColors.changed) saveEmployees(employees);

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
export function findFreeStation(employees: Employee[]): number {
  const occupied = new Set(employees.map((e) => e.stationIndex).filter((i) => i >= 0));
  for (let i = 0; i < MAX_STATIONS; i++) {
    if (!occupied.has(i)) return i;
  }
  return employees.length % MAX_STATIONS;
}

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
