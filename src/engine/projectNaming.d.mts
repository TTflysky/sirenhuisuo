export interface ProjectNamingInput {
  goal?: string;
  originalGoal?: string;
  request?: string;
  fallback?: string;
}

export function deriveProjectTitle(input?: ProjectNamingInput): string;
export const TAIJI_PROJECT_NAMING_VERSION: number;
