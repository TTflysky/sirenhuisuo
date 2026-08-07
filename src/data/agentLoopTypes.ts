import type { ModelConfig, SkillReference } from '../types';
import type { OutputScope } from './outputs';
import type { ConnectorProtocolResult } from '../engine/connectorProtocol.mjs';
import type { ToolExecutionEvidence } from '../engine/executionEvidence.mjs';
import type { TaskDecision } from '../engine/taskDecisionKernel.mjs';
import type { ExecutionControllerSnapshot } from '../engine/executionController.mjs';
import type { TurnLifecycleState } from '../engine/turnLifecycle.mjs';
import type { Attachment, ChatTurn, ContextUsage, TokenUsage } from './hermesClient';

export interface AgentLoopOpts {
  turns: ChatTurn[];
  tools: any[];
  scene: string;
  label: string;
  onToolCall?: (name: string, args: string) => Promise<void> | void;
  onToolResult?: (name: string, args: string, result: string, success?: boolean, protocolEvidence?: ConnectorProtocolResult, structuredEvidence?: ToolExecutionEvidence) => void;
  modelConfig?: ModelConfig;
  extraSystemContext?: string;
  scope?: OutputScope;
  workspaceId?: string;
  skillRefs?: SkillReference[];
  referenceContext?: string;
  referenceSourceUrl?: string;
  attachments?: Attachment[];
  shouldStop?: () => boolean;
  waitIfPaused?: () => Promise<void>;
  consumeSteeringMessages?: () => string[];
  getModelRequestSignal?: () => AbortSignal;
  onSteeringReply?: (content: string, usage: TokenUsage, contextUsage?: ContextUsage) => void;
  onModelRetry?: (attempt: number, maxAttempts: number, error: string, nextDelayMs: number) => void;
  onTextDelta?: (delta: string, accumulated: string) => void;
  initialExecutionState?: ExecutionControllerSnapshot;
  onExecutionState?: (state: ExecutionControllerSnapshot) => void;
  onTurnLifecycle?: (state: TurnLifecycleState) => void;
  onTaskPrepared?: (decision: TaskDecision) => Promise<void> | void;
  taskDecisionCompilation?: Awaited<ReturnType<typeof import('./hermesClient').compileTaskDecision>>;
  executionRouteScope?: string;
}
