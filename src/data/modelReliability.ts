import type { ModelConfig } from '../types';
import {
  classifyModelFailure,
  createModelReliabilityRegistry,
  getModelAdmission,
  getModelRecoveryAdvice,
  modelKey,
  recordModelAttempt,
  recordModelFirstToken,
  startModelAttempt,
  summarizeModelReliability,
  type ModelReliabilityRegistry,
} from '../engine/modelReliability.mjs';

export const MODEL_RELIABILITY_STORAGE_KEY = 'taiji_model_reliability_v1';
const MAX_MODEL_ENTRIES = 40;

function storage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

export function loadModelReliabilityRegistry(): ModelReliabilityRegistry {
  const target = storage();
  if (!target) return createModelReliabilityRegistry();
  try {
    const raw = target.getItem(MODEL_RELIABILITY_STORAGE_KEY);
    return createModelReliabilityRegistry(raw ? JSON.parse(raw) : undefined);
  } catch {
    return createModelReliabilityRegistry();
  }
}

export function saveModelReliabilityRegistry(registry: ModelReliabilityRegistry): void {
  const target = storage();
  if (!target) return;
  try {
    const entries = Object.entries(registry.models ?? {}).slice(-MAX_MODEL_ENTRIES);
    target.setItem(MODEL_RELIABILITY_STORAGE_KEY, JSON.stringify({ ...registry, models: Object.fromEntries(entries) }));
  } catch {}
}

export interface ModelAttemptHandle {
  key: string;
  startedAt: number;
  admitted: boolean;
  state: string;
  retryAfterMs: number;
}

export function beginModelRequest(config: ModelConfig, now = Date.now()): ModelAttemptHandle {
  const registry = loadModelReliabilityRegistry();
  const key = modelKey(config);
  const admission = getModelAdmission(registry, key, now);
  if (admission.allowed) startModelAttempt(registry, key, now);
  saveModelReliabilityRegistry(registry);
  return {
    key,
    startedAt: now,
    admitted: admission.allowed,
    state: String(admission.state ?? 'closed'),
    retryAfterMs: Number(admission.retryAfterMs ?? 0),
  };
}

export function markModelFirstToken(handle: ModelAttemptHandle, now = Date.now()): void {
  if (!handle.admitted) return;
  const registry = loadModelReliabilityRegistry();
  recordModelFirstToken(registry, handle.key, Math.max(0, now - handle.startedAt), now);
  saveModelReliabilityRegistry(registry);
}

export function recordModelSuccess(handle: ModelAttemptHandle, event: { now?: number; latencyMs?: number; status?: number } = {}): void {
  if (!handle.admitted) return;
  const now = event.now ?? Date.now();
  const registry = loadModelReliabilityRegistry();
  recordModelAttempt(registry, { key: handle.key, success: true, now, latencyMs: event.latencyMs ?? now - handle.startedAt, status: event.status });
  saveModelReliabilityRegistry(registry);
}

export function recordModelFailure(handle: ModelAttemptHandle, event: { now?: number; latencyMs?: number; status?: number; failureClass?: string; error?: string; timeout?: boolean; network?: boolean; protocol?: boolean; cancelled?: boolean } = {}): void {
  if (!handle.admitted) return;
  const now = event.now ?? Date.now();
  const registry = loadModelReliabilityRegistry();
  recordModelAttempt(registry, { key: handle.key, success: false, now, latencyMs: event.latencyMs ?? now - handle.startedAt, ...event });
  saveModelReliabilityRegistry(registry);
}

export function getModelHealthSnapshot(config?: ModelConfig): Array<Record<string, unknown>> {
  const registry = loadModelReliabilityRegistry();
  const all = summarizeModelReliability(registry);
  if (!config) return all;
  const key = modelKey(config);
  return all.filter((item) => item.key === key);
}

export function getModelRecoveryAdviceForConfig(config: ModelConfig, alternatives: ModelConfig[] = []): Record<string, unknown> {
  const registry = loadModelReliabilityRegistry();
  return getModelRecoveryAdvice(registry, modelKey(config), alternatives, Date.now());
}

export interface ReliableModelRequestContext {
  startedAt: number;
  markFirstToken: () => void;
}

export interface ReliableModelRequestResult<T> {
  value: T;
  reliability: { key: string; latencyMs: number; firstTokenMs?: number; outcome: 'success' };
}

export async function runReliableModelRequest<T>(
  config: ModelConfig,
  alternatives: ModelConfig[],
  execute: (context: ReliableModelRequestContext) => Promise<{ value: T; status?: number }>,
): Promise<ReliableModelRequestResult<T>> {
  const handle = beginModelRequest(config);
  if (!handle.admitted) {
    const advice = getModelRecoveryAdviceForConfig(config, alternatives);
    const retrySeconds = Math.max(1, Math.ceil(handle.retryAfterMs / 1000));
    const error = new Error(`模型服务暂时不可用，已进入保护窗口。约 ${retrySeconds} 秒后可再次探测。${Array.isArray(advice.alternatives) && advice.alternatives.length ? '可以切换已配置的备用模型。' : ''}`);
    error.name = 'ModelCircuitOpenError';
    throw error;
  }

  let firstTokenMs: number | undefined;
  try {
    const result = await execute({
      startedAt: handle.startedAt,
      markFirstToken: () => {
        if (firstTokenMs !== undefined) return;
        firstTokenMs = Date.now() - handle.startedAt;
        markModelFirstToken(handle);
      },
    });
    const latencyMs = Date.now() - handle.startedAt;
    recordModelSuccess(handle, { latencyMs, status: result.status });
    return {
      value: result.value,
      reliability: { key: handle.key, latencyMs, ...(firstTokenMs === undefined ? {} : { firstTokenMs }), outcome: 'success' },
    };
  } catch (error) {
    const failure = error as Error & { status?: number; modelFailureDetail?: string };
    const message = failure.modelFailureDetail || failure.message || String(error);
    const event = {
      status: failure.status,
      error: message,
      timeout: /超时|timeout/u.test(message),
      network: /network|fetch|网络|连接/u.test(message),
      protocol: /返回为空|流式|json|protocol/iu.test(message),
      cancelled: failure.name === 'ExternalAbortError' || failure.name === 'AbortError',
    };
    recordModelFailure(handle, {
      ...event,
      latencyMs: Date.now() - handle.startedAt,
      failureClass: classifyModelFailure(event),
    });
    throw error;
  }
}
