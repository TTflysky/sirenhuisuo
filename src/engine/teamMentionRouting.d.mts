export type TeamMentionRoute = 'reply' | 'task' | 'control';
export function classifyTeamMention(text: string, options?: { assistantRelay?: boolean }): TeamMentionRoute;
export function isTeamMentionTask(text: string): boolean;
