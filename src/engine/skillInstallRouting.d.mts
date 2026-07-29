export interface ResolvedSkillInstallRequest {
  instructionUrl?: string;
  sourceUrl?: string;
  name?: string;
  provider?: 'skillhub' | 'direct';
  slug?: string;
  error?: string;
}
export function skillHubDownloadUrl(slug: string): string;
export function isSkillHubDownloadUrl(value: string): boolean;
export function skillHubSlugFromRequest(text: string): string;
export function resolveSkillInstallRequest(text: string): ResolvedSkillInstallRequest | undefined;
export function isSkillInstallOnlyRequest(text: string): boolean;
