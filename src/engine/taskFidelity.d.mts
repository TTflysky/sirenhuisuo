export interface TaskRequirement { id: string; kind: 'time' | 'location' | 'topic' | 'artifact' | 'entity'; label: string; terms: string[]; evidencePattern?: RegExp }
export interface FidelityAssessment { passed: boolean; issues: string[]; requirements: TaskRequirement[] }
export function extractTaskRequirements(goal: string): TaskRequirement[];
export function taskRequirementLabels(goal: string): string[];
export function validateSearchQueryAgainstGoal(goal: string, query: string): FidelityAssessment;
export function validateToolCallAgainstGoal(goal: string, toolName: string, argumentsText: string): { allowed: boolean; reason: string };
export function assessEvidenceAlignment(goal: string, evidence: string, options?: { requireTime?: boolean }): FidelityAssessment;
export function assessTaskCompletion(goal: string, finalContent: string, callLog?: Array<{ name: string; args: string; result: string; success: boolean }>): FidelityAssessment;
