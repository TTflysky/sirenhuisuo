import { createStreamingContentFilter, normalizeModelMessage } from './modelOutputGateway.mjs';

function mergeToolCall(target, delta, fallbackIndex) {
  const index = Number.isInteger(delta?.index) ? delta.index : fallbackIndex;
  const current = target.get(index) ?? { id: '', name: '', arguments: '' };
  if (delta?.id) current.id = delta.id;
  if (delta?.function?.name) current.name += delta.function.name;
  if (delta?.function?.arguments) current.arguments += delta.function.arguments;
  target.set(index, current);
}

function parseEvent(eventText, state, onTextDelta) {
  const data = eventText.split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return data === '[DONE]';
  let payload;
  try { payload = JSON.parse(data); }
  catch { return false; }
  if (payload.model) state.model = payload.model;
  if (payload.usage) state.usage = payload.usage;
  for (const choice of payload.choices ?? []) {
    const delta = choice?.delta ?? {};
    if (typeof delta.reasoning_content === 'string') {
      state.reasoningSeen = true;
      state.reasoningContent += delta.reasoning_content;
    }
    if (typeof delta.content === 'string' && delta.content) {
      state.content += delta.content;
      onTextDelta?.(delta.content, state.content);
    }
    (delta.tool_calls ?? []).forEach((toolCall, index) => mergeToolCall(state.toolCalls, toolCall, index));
  }
  return false;
}

export async function consumeOpenAIChatStream(response, options = {}) {
  if (!response?.body?.getReader) throw new Error('当前接口没有返回可读取的流式响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const filter = createStreamingContentFilter(options.onTextDelta);
  const state = { content: '', reasoningContent: '', reasoningSeen: false, model: '', usage: undefined, toolCalls: new Map() };
  let buffer = '';
  let doneEvent = false;
  while (!doneEvent) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/u);
    buffer = events.pop() ?? '';
    for (const event of events) {
      if (parseEvent(event, state, (delta) => filter.push(delta))) {
        doneEvent = true;
        break;
      }
    }
    if (done) break;
  }
  if (buffer.trim()) parseEvent(buffer, state, (delta) => filter.push(delta));
  filter.finish();
  const normalized = normalizeModelMessage({
    content: state.content,
    reasoning_content: state.reasoningContent,
    tool_calls: [...state.toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call], index) => ({
        id: call.id || `tc-stream-${Date.now()}-${index}`,
        type: 'function',
        function: { name: call.name, arguments: call.arguments || '{}' },
      }))
      .filter((call) => call.function.name),
  }, { toolsEnabled: true });
  return {
    content: normalized.content,
    reasoningContent: state.reasoningSeen ? state.reasoningContent : undefined,
    model: state.model,
    usage: state.usage,
    toolCalls: normalized.toolCalls.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    outputDiagnostics: normalized.diagnostics,
  };
}
