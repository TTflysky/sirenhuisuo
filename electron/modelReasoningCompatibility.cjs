function createNativeAssistantToolHistoryMessage(message = {}, toolCalls = []) {
  const history = {
    role: 'assistant',
    content: message.content || null,
    tool_calls: toolCalls,
  };
  if (typeof message.reasoning_content === 'string') {
    history.reasoning_content = message.reasoning_content;
  }
  return history;
}

module.exports = { createNativeAssistantToolHistoryMessage };
