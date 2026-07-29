const SKILLHUB_INSTALL_HOSTS = new Set(['skillhub.cn', 'www.skillhub.cn']);
const SKILLHUB_API_HOST = 'api.skillhub.cn';

function clean(value, max = 2048) {
  return String(value ?? '').trim().slice(0, max);
}

function httpsUrls(text) {
  return [...clean(text, 12000).matchAll(/https:\/\/[^\s，。；、）)\]}>"']+/giu)]
    .map((match) => match[0].replace(/[,.!?;:]+$/u, ''));
}

function normalizeSkillHubSlug(value) {
  const candidate = clean(value, 160).replace(/^[`'"“”]+|[`'"“”。，、；：!?！?]+$/gu, '');
  if (!candidate) return '';
  if (/^@[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,79}$/iu.test(candidate)) return candidate;
  return /^[a-z0-9][a-z0-9._-]{0,79}$/iu.test(candidate) ? candidate : '';
}

export function skillHubDownloadUrl(slug) {
  const normalized = normalizeSkillHubSlug(slug);
  if (!normalized) return '';
  return `https://${SKILLHUB_API_HOST}/api/v1/download?slug=${encodeURIComponent(normalized)}`;
}

export function isSkillHubDownloadUrl(value) {
  try {
    const parsed = new URL(clean(value));
    return parsed.protocol === 'https:'
      && parsed.hostname.toLocaleLowerCase() === SKILLHUB_API_HOST
      && parsed.pathname === '/api/v1/download'
      && Boolean(normalizeSkillHubSlug(parsed.searchParams.get('slug')));
  } catch {
    return false;
  }
}

export function skillHubSlugFromRequest(text) {
  const source = clean(text, 12000);
  const patterns = [
    /(?:安装|装上|装好|install)\s*(?:技能|skill|插件)?\s*[`'"“”]?(@?[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,79})?)[`'"“”]?/iu,
    /(?:技能|skill|插件)\s*[`'"“”]?(@?[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,79})?)[`'"“”]?\s*(?:安装|装上|装好)/iu,
  ];
  for (const pattern of patterns) {
    const slug = normalizeSkillHubSlug(source.match(pattern)?.[1]);
    if (slug && !['skill', 'skills', 'plugin', 'install'].includes(slug.toLocaleLowerCase())) return slug;
  }
  return '';
}

export function resolveSkillInstallRequest(text) {
  const source = clean(text, 12000);
  if (!/(?:安装|装上|装好|install|部署)/iu.test(source) || !/(?:skill|技能|插件)/iu.test(source)) return undefined;
  const urls = httpsUrls(source);
  const instructionUrl = urls.find((value) => {
    try {
      const parsed = new URL(value);
      return SKILLHUB_INSTALL_HOSTS.has(parsed.hostname.toLocaleLowerCase())
        && /^\/install\/skillhub\.md$/iu.test(parsed.pathname);
    } catch {
      return false;
    }
  });
  if (instructionUrl) {
    const slug = skillHubSlugFromRequest(source);
    if (!slug) return { instructionUrl, error: '已识别 SkillHub 安装说明，但没有识别出要安装的技能名。' };
    return { instructionUrl, sourceUrl: skillHubDownloadUrl(slug), name: slug, provider: 'skillhub', slug };
  }
  const directUrl = urls.find((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && (
        /\.zip$/iu.test(parsed.pathname)
        || /(?:^|\/)SKILL\.md$/iu.test(parsed.pathname)
        || parsed.hostname.toLocaleLowerCase() === 'github.com'
        || isSkillHubDownloadUrl(value)
      );
    } catch {
      return false;
    }
  });
  if (!directUrl) return undefined;
  const slug = isSkillHubDownloadUrl(directUrl)
    ? normalizeSkillHubSlug(new URL(directUrl).searchParams.get('slug'))
    : '';
  return { sourceUrl: directUrl, name: slug || undefined, provider: slug ? 'skillhub' : 'direct', slug: slug || undefined };
}

export function isSkillInstallOnlyRequest(text) {
  const source = clean(text, 12000)
    .replace(/https:\/\/\S+/giu, ' ')
    .replace(/[`'"“”]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!resolveSkillInstallRequest(text)) return false;
  return !/(?:并|然后|之后|安装后|装好后).{0,24}(?:使用|运行|执行|创建|生成|写|搜索|查询|验证业务|完成任务)/iu.test(source);
}
