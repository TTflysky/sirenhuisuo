export interface ReasoningCompatibleResponse {
  content?: string | null;
  reasoningContent?: string;
}

export function createAssistantToolHistoryMessage<T>(
  response: ReasoningCompatibleResponse,
  toolCalls: T[],
): { role: 'assistant'; content: string | null; reasoning_content?: string; tool_calls: T[] };
