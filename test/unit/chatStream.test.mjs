import { describe, expect, it } from 'vitest';
import { consumeOpenAIChatStream } from '../../src/engine/chatStream.mjs';

function responseFrom(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }));
}

describe('OpenAI compatible chat stream', () => {
  it('assembles text, split events, tools and usage', async () => {
    const deltas = [];
    const response = responseFrom([
      'data: {"model":"gpt-test","choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好","tool_calls":[{"index":0,"id":"call-1","function":{"name":"write_","arguments":"{\\"path\\":"}}]}}]}\n',
      '\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"\\"a.md\\"}"}}]}}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await consumeOpenAIChatStream(response, { onTextDelta: (delta, accumulated) => deltas.push([delta, accumulated]) });
    expect(result.content).toBe('你好');
    expect(result.model).toBe('gpt-test');
    expect(result.toolCalls).toEqual([{ id: 'call-1', name: 'write_file', arguments: '{"path":"a.md"}' }]);
    expect(result.usage.total_tokens).toBe(14);
    expect(deltas).toEqual([['你', '你'], ['好', '你好']]);
  });
});
