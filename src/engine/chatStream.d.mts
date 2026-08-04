export interface StreamedToolCall { id: string; name: string; arguments: string }
export interface StreamedChatResult {
  content: string | null;
  reasoningContent?: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  toolCalls: StreamedToolCall[];
}
export function consumeOpenAIChatStream(
  response: Response,
  options?: { onTextDelta?: (delta: string, accumulated: string) => void },
): Promise<StreamedChatResult>;
