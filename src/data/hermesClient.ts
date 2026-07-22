import type { Employee, Team, ChatMessage, AppState, AgentStatus, ModelConfig } from '../types';
import { MAX_STATIONS } from '../types';
import { seedEmployees } from './defaultEmployees';
import { seedTeams } from './defaultTeams';
import type { OutputScope } from './outputs';

const LS_EMPLOYEES = 'hermes_office_employees';
const LS_TEAMS = 'hermes_office_teams';
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
export interface AppSettings {
  provider?: string;  // 服务商 key（对应 PROVIDER_PRESETS），'custom' 为自定义
  apiHost?: string;   // 完整 base_url（可含路径），如 https://api.deepseek.com 或 https://dashscope.aliyuncs.com/compatible-mode/v1
  apiKey?: string;    // Bearer token
  model?: string;     // 模型名，如 deepseek-chat / qwen-plus / glm-4-flash
  autoDiscuss?: boolean; // 是否在发消息/任务后自动触发团队 AI 讨论（默认 false=手动）
  autoPilot?: boolean;   // 自主模式：推荐项目后自动执行最佳项目（默认 false=手动点执行）
  assistantModelConfig?: ModelConfig; // 助理机器人的独立模型配置（员工未配模型时默认使用此配置）
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
    if (raw) return JSON.parse(raw) as AppSettings;
  } catch {}
  return {};
}
export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  } catch {}
}

// ===== 用户长期记忆 =====
const LS_USER_MEMORY = 'hermes_office_user_memory';
const LS_USER_PROFILE = 'hermes_office_user_profile';
const MAX_MEMORY_ITEMS = 200;

export interface UserMemoryItem {
  ts: number;           // 记录时间
  content: string;      // 记忆内容（如"用户偏好红色主题"）
  source: string;       // 来源（如"私聊-张三"、"助手对话"）
}

export function loadUserMemory(): UserMemoryItem[] {
  try {
    const raw = localStorage.getItem(LS_USER_MEMORY);
    if (raw) return JSON.parse(raw) as UserMemoryItem[];
  } catch {}
  return [];
}
export function saveUserMemory(items: UserMemoryItem[]): void {
  try {
    localStorage.setItem(LS_USER_MEMORY, JSON.stringify(items.slice(-MAX_MEMORY_ITEMS)));
  } catch {}
}
export function appendUserMemory(item: UserMemoryItem): void {
  const list = loadUserMemory();
  list.push(item);
  saveUserMemory(list);
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
    const recent = memory.slice(-10).map(m => `- ${m.content}`).join('\n');
    ctx += `## 长期记忆（最近 ${Math.min(memory.length, 10)} 条）\n${recent}\n`;
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
  const existingMemory = loadUserMemory().slice(-5).map(m => m.content).join('; ');

  try {
    const r = await chatCompletion([
      { role: 'system', content: `你是用户洞察分析师。分析以下对话，提取关于这个用户的新认知。

已有用户画像：${existingProfile || '（无）'}
已有记忆：${existingMemory || '（无）'}

请以 JSON 格式回复：
{
  "newMemories": ["一条具体的用户习惯/偏好/思维模式...", "另一条..."],
  "profileDelta": "对用户画像的更新描述（一段话，涵盖性格、偏好、思维特点等）"
}

注意：
- newMemories 每条 10-30 字，具体的、可验证的事实
- profileDelta 是 50-150 字的综合描述
- 只提取对话中确实体现的信息，不要臆想
- 如果对话没有有效信息，newMemories 返回空数组
- 用中文回复` },
      { role: 'user', content: `对话记录（${source}）：\n\n${conversation.slice(0, 3000)}` },
    ], 'extract', '用户洞察提炼');
    if (!r.content) return;

    // 尝试解析 JSON
    const jsonMatch = r.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const data = JSON.parse(jsonMatch[0]);

    if (Array.isArray(data.newMemories) && data.newMemories.length > 0) {
      const now = Date.now();
      for (const mem of data.newMemories) {
        appendUserMemory({ ts: now, content: mem, source });
      }
    }
    if (data.profileDelta && typeof data.profileDelta === 'string' && data.profileDelta.length > 10) {
      saveUserProfile(data.profileDelta);
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
 * 2. 助理机器人配置 (assistantModelConfig in AppSettings)
 * 3. 全局设置 (loadSettings)
 */
export function resolveChatSettings(empConfig?: ModelConfig): AppSettings {
  const global = loadSettings();
  const assistant = global.assistantModelConfig;
  if (!empConfig) {
    // 没有员工配置：回退到助理配置 → 全局
    if (assistant) {
      return {
        provider: assistant.provider ?? global.provider,
        apiHost: assistant.apiHost ?? global.apiHost,
        apiKey: assistant.apiKey ?? global.apiKey,
        model: assistant.model ?? global.model,
        autoDiscuss: global.autoDiscuss,
      };
    }
    return global;
  }
  // 有员工配置：员工优先 → 助理 → 全局
  return {
    provider: empConfig.provider ?? assistant?.provider ?? global.provider,
    apiHost: empConfig.apiHost ?? assistant?.apiHost ?? global.apiHost,
    apiKey: empConfig.apiKey ?? assistant?.apiKey ?? global.apiKey,
    model: empConfig.model ?? assistant?.model ?? global.model,
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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    throw e;
  }
}

// ===== 探测后端 =====
export async function checkBackend(): Promise<boolean> {
  const base = resolveApiBase();
  if (!base) {
    _backendOnline = false;
    return false;
  }
  try {
    const res = await apiFetch('/models', { method: 'GET' }, 2500);
    _backendOnline = res.ok;
    return res.ok;
  } catch {
    _backendOnline = false;
    return false;
  }
}

// 测试连接（供设置面板用，返回详细结果）
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const base = resolveApiBase();
  if (!base) return { ok: false, message: '请先填写 API 地址' };
  try {
    // OpenAI 兼容接口探测 /models
    const res = await apiFetch('/models', { method: 'GET' }, 5000);
    if (res.ok) return { ok: true, message: `连接成功 ✓ (${endpointUrl(base, '/models')})` };
    return { ok: false, message: `服务器响应 ${res.status}（${endpointUrl(base, '/models')}）` };
  } catch (e: any) {
    return { ok: false, message: `无法连接 ${base}：${e?.message ?? '网络错误'}` };
  }
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
        sys += `\n\n## 你的核心人格\n${extraSystemContext}`;
      }
      if (userCtx) {
        sys += `\n\n## 关于当前用户\n${userCtx}\n（注意：每次对话后系统会自动更新用户画像和记忆。如果你注意到用户的新习惯或偏好，可以在回复末尾悄悄提醒「📝 已记录」）`;
      }
      finalTurns = finalTurns.map((t, i) => i === sysIdx ? { ...t, content: sys } : t);
    } else {
      // 没有 system 消息则新建一条
      let content = '';
      if (extraSystemContext) content += `## 你的核心人格\n${extraSystemContext}\n\n`;
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
      temperature: 0.7,
      stream: false,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    }),
  }, 30000, merged.apiKey, base); // 传入合并后的 apiKey 和 base
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
  onToolResult?: (name: string, args: string, result: string) => void;
  modelConfig?: ModelConfig;  // 可选员工独立模型配置
  extraSystemContext?: string; // 额外的系统上下文（如 soul.md）
  scope?: OutputScope;        // 产出物作用域
  attachments?: Attachment[];  // 用户上传/粘贴的图片附件（多模态视觉）
  shouldStop?: () => boolean;  // 自主执行中断信号（如用户点「停止」）
}
export async function runAgentLoop(opts: AgentLoopOpts): Promise<{ content: string; usage: TokenUsage; model: string }> {
  const { turns, tools, scene, label, onToolCall, onToolResult, modelConfig, extraSystemContext, scope, attachments, shouldStop } = opts;
  let currentTurns = [...turns];

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

  let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finalContent: string | null = null;
  let finalModel = '';
  const maxIter = 6; // 最多6轮工具调用循环
  const callLog: Array<{ name: string; args: string; result: string }> = [];
  let stopped = false;

  for (let iter = 0; iter < maxIter; iter++) {
    if (shouldStop?.()) { stopped = true; break; } // 用户停止：本轮前中止
    const r = await chatCompletion(currentTurns, scene, label, tools, modelConfig, extraSystemContext);
    totalUsage.promptTokens += r.usage.promptTokens;
    totalUsage.completionTokens += r.usage.completionTokens;
    totalUsage.totalTokens += r.usage.totalTokens;
    if (!finalModel) finalModel = r.model;

    if (r.toolCalls && r.toolCalls.length > 0) {
      // 模型返回了工具调用：执行，结果加入对话继续
      const { executeTool } = await import('../engine/tools');
      for (const tc of r.toolCalls) {
        onToolCall?.(tc.name, tc.arguments);
        const result = await executeTool({
          id: tc.id,
          name: tc.name,
          args: (() => { try { return JSON.parse(tc.arguments); } catch { return {}; } })(),
          scope,
        });
        onToolResult?.(tc.name, tc.arguments, result.output);
        callLog.push({ name: tc.name, args: tc.arguments, result: result.output.slice(0, 200) });
        // 对 tool output 长度做上限，防止下游模型调用因上下文超长失败
        const truncated = result.output.slice(0, 1500);
        currentTurns.push({ role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }] } as any);
        currentTurns.push({ role: 'tool', content: truncated, tool_call_id: tc.id } as any);
        if (shouldStop?.()) { stopped = true; break; } // 用户停止：工具执行后中止
      }
      if (stopped) break;
    } else if (r.content) {
      // 模型返回了文本：完成
      finalContent = r.content;
      break;
    } else {
      break;
    }
  }

  // 工具循环用尽但模型未产出最终文本 → 构造简洁的摘要
  if (!finalContent) {
    if (stopped) {
      finalContent = '⛔ 已手动停止执行。已完成的部分已保存在工作区，可重新执行继续。';
    } else if (callLog.length > 0) {
      const blocks = callLog.map((c, i) => {
        // 从 result 中提取有用的结论摘要
        let status = '✅ 成功';
        if (c.result.match(/❌|退出码 \d+|error|not found/i)) status = '❌ 失败';
        // 从结果中提取有效信息（去掉技术噪音）
        let detail = c.result
          .replace(/STDOUT：[\s\S]*?STDERR：/g, '')
          .replace(/输出已保存到 outputs\/cmd-.*/g, '')
          .replace(/目录：.*/g, '')
          .replace(/状态：(成功|失败).*/g, '')
          .trim()
          .slice(0, 200);
        if (!detail) detail = status === '❌ 失败' ? '命令执行出错' : '已执行';
        return `${i + 1}. ${c.name} → ${status}\n   ${detail}`;
      });
      finalContent = `助手执行了 ${callLog.length} 个操作，以下是关键结果：\n\n${blocks.join('\n\n')}\n\n---\n如需要更详细的说明，请继续描述你的需求。`;
    } else {
      finalContent = '模型未调用任何工具也未给出回复，请重试或检查 API 配置。';
    }
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

  return { employees, teams, status };
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
export function loadChat(id: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${LS_CHAT_PREFIX}${id}`);
    if (raw) return JSON.parse(raw) as ChatMessage[];
  } catch {}
  return [];
}

export function appendChat(id: string, msgs: ChatMessage[]): void {
  try {
    const existing = loadChat(id);
    // 按消息 id 去重：同一 action 可能在多个窗口各执行一次，避免重复落盘
    const existingIds = new Set(existing.map((m) => m.id));
    const toAdd = msgs.filter((m) => !existingIds.has(m.id));
    if (toAdd.length === 0) return;
    const merged = [...existing, ...toAdd].slice(-MAX_CHAT);
    localStorage.setItem(`${LS_CHAT_PREFIX}${id}`, JSON.stringify(merged));
  } catch (e) {
    console.warn('[hermesClient] Failed to append chat:', e);
  }
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
    if (raw) return JSON.parse(raw) as ChatMessage[];
  } catch {}
  return [];
}
export function appendDm(empId: string, msgs: ChatMessage[]): void {
  try {
    const existing = loadDm(empId);
    // 去重：避免同一消息在多个窗口重复落盘
    const existingIds = new Set(existing.map((m) => m.id));
    const toAdd = msgs.filter((m) => !existingIds.has(m.id));
    if (toAdd.length === 0) return;
    const merged = [...existing, ...toAdd].slice(-MAX_CHAT);
    localStorage.setItem(`${LS_DM_PREFIX}${empId}`, JSON.stringify(merged));
  } catch (e) {
    console.warn('[hermesClient] Failed to append dm:', e);
  }
}
