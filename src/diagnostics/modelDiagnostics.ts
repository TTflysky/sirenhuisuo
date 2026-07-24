import type { ModelConfig } from '../types';

export interface ModelDiagnosticOptions {
  contextChars?: number;
  timeoutMs?: number;
}

function endpoint(base: string, path: string): string {
  const clean = base.replace(/\/+$/, '');
  return /\/v\d+(\/|$)/u.test(clean) ? `${clean}${path}` : `${clean}/v1${path}`;
}

export async function diagnoseModel(modelConfig?: ModelConfig, options: ModelDiagnosticOptions = {}): Promise<string> {
  const base = modelConfig?.apiHost?.trim().replace(/\/+$/, '');
  const model = modelConfig?.model || modelConfig?.refModelId || '未指定';
  const contextChars = options.contextChars ?? 0;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!base) return `诊断结果：未配置独立 API 地址，当前应使用全局模型配置。模型：${model}`;

  const started = Date.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(base, '/models'), {
      method: 'GET',
      headers: { Accept: 'application/json', ...(modelConfig?.apiKey ? { Authorization: `Bearer ${modelConfig.apiKey}` } : {}) },
      signal: controller.signal,
    });
    const body = (await response.text()).slice(0, 500);
    const elapsed = Date.now() - started;
    const advice = response.ok
      ? contextChars > 60000 ? '接口可连通，但本次上下文过大，建议压缩历史消息、减少工具输出或提高请求超时。' : '接口连通，建议检查模型名称、响应速度和代理稳定性。'
      : response.status === 401 || response.status === 403 ? '鉴权失败，请检查 API Key。'
        : response.status === 404 ? '接口地址或 /v1 路径不正确。'
          : response.status >= 500 ? '服务端错误，等待服务恢复或切换模型。' : '请根据响应内容检查服务商配置。';
    return `模型诊断：${response.ok ? '接口可连通' : '接口返回错误'}\n地址：${base}\n模型：${model}\n耗时：${elapsed}ms\nHTTP：${response.status}\n上下文字符数：${contextChars}\n建议：${advice}\n响应摘要：${body || '(空)'}`;
  } catch (error: any) {
    const elapsed = Date.now() - started;
    const timeout = error?.name === 'AbortError';
    return `模型诊断：${timeout ? '连接超时' : '连接失败'}\n地址：${base}\n模型：${model}\n耗时：${elapsed}ms\n上下文字符数：${contextChars}\n建议：${timeout ? '接口在诊断时间内没有响应，检查代理、服务端负载或延长请求超时。' : '检查网络、代理、API 地址和 API Key。'}\n错误：${error?.message ?? String(error)}`;
  } finally {
    window.clearTimeout(timer);
  }
}
