export interface SkillHubResult {
  slug: string;
  name: string;
  description: string;
  category: string;
  downloads: number;
  installs: number;
  version: string;
  homepage: string;
}

export interface SkillHubSearchResult {
  ok: boolean;
  query: string;
  queries: string[];
  url: string;
  results: SkillHubResult[];
  error: string;
}

export function isSkillDiscoveryRequest(value: string): boolean;
export function isSkillLinkRequest(value: string): boolean;
export function skillDiscoveryQuery(value: string): string;
export function searchSkillHub(value: string, fetchImpl?: typeof fetch): Promise<SkillHubSearchResult>;
export function formatSkillHubResults(result: SkillHubSearchResult): string;
