export type ParsedGeneratedAvatar =
  | { kind: 'data'; dataUrl: string; revisedPrompt?: string }
  | { kind: 'url'; url: string; revisedPrompt?: string };

/** Normalize the two response shapes used by OpenAI-compatible image APIs. */
export function parseGeneratedAvatarPayload(payload: unknown): ParsedGeneratedAvatar {
  const candidate = (payload as { data?: Array<{ b64_json?: unknown; url?: unknown; revised_prompt?: unknown }> })?.data?.[0];
  if (!candidate) throw new Error('生图接口没有返回图片');
  const revisedPrompt = typeof candidate.revised_prompt === 'string' ? candidate.revised_prompt : undefined;
  if (typeof candidate.b64_json === 'string' && candidate.b64_json.length > 20) {
    return { kind: 'data', dataUrl: `data:image/png;base64,${candidate.b64_json}`, revisedPrompt };
  }
  if (typeof candidate.url === 'string' && /^https?:\/\//iu.test(candidate.url)) {
    return { kind: 'url', url: candidate.url, revisedPrompt };
  }
  throw new Error('生图接口既没有返回 Base64，也没有返回可下载地址');
}
