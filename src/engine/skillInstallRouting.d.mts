export interface ResolvedSkillInstallRequest {
  instructionUrl?: string;
  sourceUrl?: string;
  name?: string;
  provider?: 'skillhub' | 'direct';
  slug?: string;
  repository?: { type: 'github-repository'; owner: string; repo: string };
  skillNames?: string[];
  installAll?: boolean;
  command?: 'skills add';
  error?: string;
  /** Original explicit request retained for a safe continuation. */
  requestText?: string;
  /** True when a later continuation inherited a previously explicit source. */
  resumed?: boolean;
}
export interface SkillInstallInput {
  sourceUrl?: string;
  url?: string;
  slug?: string;
  name?: string;
  skillNames?: string[];
  installAll?: boolean;
}
export function normalizeSkillHubSlug(value?: string): string;
export function skillHubSlugFromUrl(value?: string): string;
export function skillHubDownloadUrl(slug: string): string;
export function isSkillHubDownloadUrl(value: string): boolean;
export function parseSkillCliInstall(value: string): ResolvedSkillInstallRequest | undefined;
export function isExplicitSkillInstallOperation(text: string): boolean;
export function isSkillInstallAction(text: string, options?: { allowBoundReference?: boolean }): boolean;
export function skillHubSlugFromRequest(text: string): string;
export function resolveSkillInstallInput(input?: SkillInstallInput, requestText?: string): ResolvedSkillInstallRequest;
export function resolveSkillInstallRequest(text: string): ResolvedSkillInstallRequest | undefined;
export function resolveSkillInstallContinuation(messages?: string[], options?: { latestMessage?: string; activeTaskGoal?: string }): ResolvedSkillInstallRequest | undefined;
export function isSkillInstallOnlyRequest(text: string, options?: { allowBoundReference?: boolean }): boolean;
export function isSkillInstallOnlyRequest(text: string): boolean;
