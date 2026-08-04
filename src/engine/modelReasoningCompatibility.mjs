export function createAssistantToolHistoryMessage(response = {}, toolCalls = []) {
  const message = {
    role: 'assistant',
    content: response.content || null,
    tool_calls: toolCalls,
  };
  if (typeof response.reasoningContent === 'string') {
    message.reasoning_content = response.reasoningContent;
  }
  return message;
}
