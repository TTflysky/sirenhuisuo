import type { ChatMessage, ConversationReference, SkillReference } from '../types';

export type ConversationReferenceAction = 'share-link' | 'install' | 'read' | 'continue' | 'refer';
export interface ConversationReferenceResolution {
  status: 'none' | 'missing' | 'ambiguous' | 'resolved';
  action: ConversationReferenceAction;
  references: ConversationReference[];
  skillRefs: SkillReference[];
  context: string;
}

export function resolveConversationReferences(input?: {
  input?: string;
  history?: ChatMessage[];
  selectedSkillRefs?: SkillReference[];
}): ConversationReferenceResolution;

export function referencesFromToolResult(
  name: string,
  argsText: string | undefined,
  output: string | undefined,
  success?: boolean,
): ConversationReference[];

export function referenceClarification(result: ConversationReferenceResolution): string;
