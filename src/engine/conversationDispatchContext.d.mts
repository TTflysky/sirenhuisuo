export interface DispatchContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DispatchContinuity {
  contextual: boolean;
  request: string;
  originalGoal: string;
  proposal: string;
  requiredCapabilities: string[];
}

export function resolveDispatchRequest(current: string, recentMessages?: DispatchContextMessage[]): string;
export function resolveDispatchContinuity(current: string, recentMessages?: DispatchContextMessage[]): DispatchContinuity;
export const TAIJI_DISPATCH_CONTEXT_VERSION: number;
