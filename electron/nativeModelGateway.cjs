const path = require('path');
const { pathToFileURL } = require('url');

let outputGatewayPromise;

function loadOutputGateway() {
  if (!outputGatewayPromise) {
    outputGatewayPromise = import(pathToFileURL(path.join(__dirname, '../src/engine/modelOutputGateway.mjs')).href);
  }
  return outputGatewayPromise;
}

async function callNativeModel(input) {
  const {
    job, member, messages, tools, timeoutMs, fetchImpl, retryDelays, turnRuntime,
    resolveEndpoint, modelName, publicMember, reportActivity, assertCanContinue,
    timeoutPromise, createControlSignal, text, sleep,
  } = input;
  const config = member.modelConfig || {};
  const endpoint = resolveEndpoint(config);
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let lastError;
  const recoveryAttempts = new Map();
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    await assertCanContinue(job);
    if (retryDelays[attempt]) await sleep(retryDelays[attempt]);
    const controller = new AbortController();
    job.abortController = controller;
    await reportActivity(job, 'model_request_started', `${member.name} 正在请求模型 ${modelName(config)}（第 ${attempt + 1} 次）`, {
      stepId: job.currentStepId, member: publicMember(member), attempt: attempt + 1, timeoutMs,
    });
    const deadline = timeoutPromise(timeoutMs, `模型在 ${Math.ceil(timeoutMs / 1000)} 秒内没有返回`, () => controller.abort());
    try {
      const operation = (async () => {
        const response = await fetchImpl(endpoint, {
          method: 'POST', headers, signal: controller.signal,
          body: JSON.stringify({
            model: modelName(config), messages,
            ...(Array.isArray(tools) && tools.length ? { tools, tool_choice: 'auto' } : {}),
            stream: false,
          }),
        });
        const raw = await response.text();
        if (!response.ok) {
          const error = new Error(`模型 HTTP ${response.status}：${raw.slice(0, 1000)}`);
          error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
          throw error;
        }
        let data;
        try { data = JSON.parse(raw); } catch { throw new Error('模型返回了无效 JSON'); }
        const message = data?.choices?.[0]?.message;
        if (!message) throw new Error('模型没有返回可用消息');
        const gateway = await loadOutputGateway();
        const normalized = gateway.normalizeModelMessage(message, { toolsEnabled: Array.isArray(tools) && tools.length > 0 });
        if (normalized.diagnostics.fatal) {
          const error = new Error('模型输出包含无法解析的工具协议，已阻止执行');
          error.retryable = true;
          error.modelOutputDiagnostics = normalized.diagnostics;
          throw error;
        }
        return {
          message: normalized.message,
          outputDiagnostics: normalized.diagnostics,
          usage: data.usage || {},
          model: data.model || modelName(config),
        };
      })();
      const result = await Promise.race([operation, deadline.promise]);
      await assertCanContinue(job);
      await reportActivity(job, 'model_response_received', `${member.name} 已收到模型回复，正在检查下一步动作`, {
        stepId: job.currentStepId, member: publicMember(member), attempt: attempt + 1,
      });
      return result;
    } catch (error) {
      if (job.interruptReason === 'steer') throw createControlSignal('steer', '已收到新的要求，正在根据最新内容调整当前步骤。');
      if (job.control) throw createControlSignal(job.control, error?.message);
      lastError = error;
      const classified = turnRuntime.classifyExecutionError(error);
      const used = recoveryAttempts.get(classified.type) || 0;
      const limit = Number(turnRuntime.TAIJI_RECOVERY_LIMITS[classified.type] ?? 1);
      await reportActivity(job, 'model_retry', `${member.name} 的模型请求未成功，正在按恢复策略重试`, {
        stepId: job.currentStepId, attempt: used + 1, maxAttempts: limit + 1,
        errorType: classified.type, error: text(error?.message || error, 500),
      });
      if (error?.retryable === false || !classified.retryable || classified.needsUser || used >= limit) break;
      recoveryAttempts.set(classified.type, used + 1);
    } finally {
      deadline.clear();
      if (job.abortController === controller) job.abortController = undefined;
    }
  }
  throw lastError || new Error('模型请求失败');
}

module.exports = { callNativeModel };
