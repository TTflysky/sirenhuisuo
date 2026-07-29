export interface ResolvedSkillInstallRequest {
  instructionUrl?: string;
  sourceUrl?: string;
  name?: string;
  provider?: 'skillhub' | 'direct';
  slug?: string;
  error?: string;
}
export interface SkillInstallInput {
  sourceUrl?: string;
  url?: string;
  slug?: string;
  name?: string;
}
export function normalizeSkillHubSlug(value?: string): string;
export function skillHubSlugFromUrl(value?: string): string;
export function skillHubDownloadUrl(slug: string): string;
export function isSkillHubDownloadUrl(value: string): boolean;
export function skillHubSlugFromRequest(text: string): string;
export function resolveSkillInstallInput(input?: SkillInstallInput, requestText?: string): ResolvedSkillInstallRequest;
export function resolveSkillInstallRequest(text: string): ResolvedSkillInstallRequest | undefined;
export function isSkillInstallOnlyRequest(text: string): boolean;
