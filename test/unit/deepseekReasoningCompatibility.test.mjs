import { describe, expect, it } from 'vitest';
import { consumeOpenAIChatStream } from '../../src/engine/chatStream.mjs';
import { createAssistantToolHistoryMessage } from '../../src/engine/modelReasoningCompatibility.mjs';
import nativeCompatibility from '../../electron/modelReasoningCompatibility.cjs';

const { createNativeAssistantToolHistoryMessage } = nativeCompatibility;

function responseFrom(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }));
}

describe('DeepSeek thinking-mode compatibility', () => {
  it('keeps streamed reasoning content for the next tool-call round', async () => {
    const result = await consumeOpenAIChatStream(responseFrom([
      'data: {"choices":[{"delta":{"reasoning_content":"先检查"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"工作区","tool_calls":[{"index":0,"id":"call-1","function":{"name":"list_files","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    expect(result.reasoningContent).toBe('先检查工作区');
    expect(result.toolCalls).toEqual([{ id: 'call-1', name: 'list_files', arguments: '{}' }]);
  });

  it('passes reasoning_content back with frontend and native tool histories', () => {
    const tools = [{ id: 'call-1', type: 'function', function: { name: 'list_files', arguments: '{}' } }];
    expect(createAssistantToolHistoryMessage({ content: null, reasoningContent: '先检查工作区' }, tools)).toEqual({
      role: 'assistant', content: null, reasoning_content: '先检查工作区', tool_calls: tools,
    });
    expect(createNativeAssistantToolHistoryMessage({ content: null, reasoning_content: '先检查工作区' }, tools)).toEqual({
      role: 'assistant', content: null, reasoning_content: '先检查工作区', tool_calls: tools,
    });
    expect(createAssistantToolHistoryMessage({ content: null, reasoningContent: '' }, tools)).toHaveProperty('reasoning_content', '');
    expect(createNativeAssistantToolHistoryMessage({ content: null, reasoning_content: '' }, tools)).toHaveProperty('reasoning_content', '');
  });
});
