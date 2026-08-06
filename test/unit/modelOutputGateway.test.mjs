import { describe, expect, it } from 'vitest';
import {
  createStreamingContentFilter,
  normalizeModelMessage,
} from '../../src/engine/modelOutputGateway.mjs';
import nativeGateway from '../../electron/nativeModelGateway.cjs';

const fullwidthPipe = '\uFF5C';

describe('model output gateway', () => {
  it('keeps native tool calls in one canonical shape', () => {
    const result = normalizeModelMessage({
      content: null,
      reasoning_content: '先检查工作区',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'list_files', arguments: '{}' } }],
    }, { toolsEnabled: true });

    expect(result.diagnostics.protocol).toBe('native');
    expect(result.diagnostics.fatal).toBe(false);
    expect(result.toolCalls[0].function.name).toBe('list_files');
    expect(result.message.reasoning_content).toBe('先检查工作区');
  });

  it('parses the rendered DSML marker and removes it from public content', () => {
    const marker = `<${fullwidthPipe}${fullwidthPipe}DSML${fullwidthPipe}${fullwidthPipe}tool_calls>`;
    const result = normalizeModelMessage({
      content: `我先检查工作区。${marker}${JSON.stringify({ name: 'list_files', arguments: {} })}`,
    }, { toolsEnabled: true });

    expect(result.diagnostics.protocol).toBe('marked');
    expect(result.diagnostics.controlDetected).toBe(true);
    expect(result.message.content).toBe('我先检查工作区。');
    expect(result.toolCalls[0].function.name).toBe('list_files');
    expect(result.diagnostics.fatal).toBe(false);
  });

  it('parses DeepSeek-style begin/sep/end tool blocks', () => {
    const value = `<\uFF5Ctool\u2581call\u2581begin\uFF5C>functions.write_file<\uFF5Ctool\u2581sep\uFF5C>{"path":"report.md","content":"ok"}<\uFF5Ctool\u2581call\u2581end\uFF5C>`;
    const result = normalizeModelMessage({ content: value }, { toolsEnabled: true });

    expect(result.toolCalls[0].function.name).toBe('write_file');
    expect(JSON.parse(result.toolCalls[0].function.arguments)).toEqual({ path: 'report.md', content: 'ok' });
    expect(result.message.content).toBe(null);
  });

  it('blocks malformed protocol output instead of displaying it as an answer', () => {
    const marker = `<${fullwidthPipe}${fullwidthPipe}DSML${fullwidthPipe}${fullwidthPipe}tool_calls>`;
    const result = normalizeModelMessage({ content: `${marker}{not-json}` }, { toolsEnabled: true });

    expect(result.diagnostics.fatal).toBe(true);
    expect(result.diagnostics.parseStatus).toBe('malformed');
    expect(result.message.content).toBe(null);
  });

  it('holds a split marker while streaming and emits only public text', () => {
    const deltas = [];
    const filter = createStreamingContentFilter((delta, accumulated) => deltas.push([delta, accumulated]));
    filter.push('前言');
    filter.push(`<${fullwidthPipe}`);
    filter.push(`${fullwidthPipe}DSML${fullwidthPipe}${fullwidthPipe}tool_calls>`);
    filter.push('{"name":"list_files","arguments":{}}');
    filter.finish();

    expect(deltas).toEqual([['前言', '前言']]);
  });

  it('routes native executor responses through the same gateway', async () => {
    const marker = `<${fullwidthPipe}${fullwidthPipe}DSML${fullwidthPipe}${fullwidthPipe}tool_calls>`;
    const result = await nativeGateway.callNativeModel({
      job: {},
      member: { name: '测试员工', modelConfig: { apiHost: 'https://example.test/v1', model: 'deepseek-chat' } },
      messages: [{ role: 'user', content: '检查工作区' }],
      tools: [{ type: 'function', function: { name: 'list_files', description: 'list files', parameters: { type: 'object', properties: {} } } }],
      timeoutMs: 1000,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: `${marker}${JSON.stringify({ name: 'list_files', arguments: {} })}` } }] }), { status: 200 }),
      retryDelays: [0],
      turnRuntime: { classifyExecutionError: () => ({ type: 'unknown', retryable: false }), TAIJI_RECOVERY_LIMITS: {} },
      resolveEndpoint: (config) => `${config.apiHost}/chat/completions`,
      modelName: (config) => config.model,
      publicMember: (member) => member,
      reportActivity: async () => {},
      assertCanContinue: async () => {},
      timeoutPromise: () => ({ promise: new Promise(() => {}), clear: () => {} }),
      createControlSignal: (_kind, message) => new Error(message),
      text: (value) => String(value ?? ''),
      sleep: async () => {},
    });

    expect(result.message.tool_calls[0].function.name).toBe('list_files');
    expect(result.outputDiagnostics.protocol).toBe('marked');
    expect(result.message.content).toBe(null);
  });
});
