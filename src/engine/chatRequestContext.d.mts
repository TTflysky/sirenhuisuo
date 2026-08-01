export interface ChatRequestContextOptions {
  userContext?: string;
  extraSystemContext?: string;
  attachments?: Array<{ kind?: string; dataUrl?: string }>;
}

export function prepareChatRequestTurns<T extends { role: string; content: unknown }>(
  turns: T[],
  options?: ChatRequestContextOptions,
): T[];
