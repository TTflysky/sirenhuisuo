const SKILLHUB_INSTALL_HOSTS = new Set(['skillhub.cn', 'www.skillhub.cn']);
const SKILLHUB_API_HOST = 'api.skillhub.cn';

function clean(value, max = 2048) {
  return String(value ?? '').trim().slice(0, max);
}

function httpsUrls(text) {
  return [...clean(text, 12000).matchAll(/https:\/\/[^\s，。；、）)\]}>"']+/giu)]
    .map((match) => match[0].replace(/[,.!?;:]+$/u, ''));
}

export function normalizeSkillHubSlug(value) {
  const candidate = clean(value, 160).replace(/^[`'"“”]+|[`'"“”。，、；：!?！?]+$/gu, '');
  if (!candidate) return '';
  if (/^@[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,79}$/iu.test(candidate)) return candidate;
  return /^[a-z0-9][a-z0-9._-]{0,79}$/iu.test(candidate) ? candidate : '';
}

export function skillHubSlugFromUrl(value) {
  try {
    const parsed = new URL(clean(value));
    const host = parsed.hostname.toLocaleLowerCase();
    if (host === SKILLHUB_API_HOST && parsed.pathname === '/api/v1/download') {
      return normalizeSkillHubSlug(parsed.searchParams.get('slug'));
    }
    if (!SKILLHUB_INSTALL_HOSTS.has(host)) return '';
    const detail = parsed.pathname.match(/^\/skills\/(.+?)\/?$/iu)?.[1];
    if (!detail) return '';
    try { return normalizeSkillHubSlug(decodeURIComponent(detail)); } catch { return ''; }
  } catch {
    return '';
  }
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
    const raw = source.match(pattern)?.[1] || '';
    const slug = normalizeSkillHubSlug(raw);
    if (slug
        && raw === raw.toLocaleLowerCase()
        && !['skill', 'skills', 'plugin', 'install', 'ui', 'ux', 'pro', 'max'].includes(slug.toLocaleLowerCase())) return slug;
  }
  return '';
}

/**
 * Normalize every supported install entry into one atomic native-install request.
 * The model may provide a slug, a SkillHub page, the SkillHub instruction page,
 * or a direct HTTPS package. Runtime code must not require it to hand-craft the
 * final download URL.
 */
export function resolveSkillInstallInput(input = {}, requestText = '') {
  const rawSource = clean(input?.sourceUrl ?? input?.url, 2048);
  const request = requestText ? resolveSkillInstallRequest(requestText) : undefined;
  let slug = normalizeSkillHubSlug(input?.slug)
    || skillHubSlugFromUrl(rawSource)
    || (!rawSource ? normalizeSkillHubSlug(input?.name) : '')
    || normalizeSkillHubSlug(request?.slug);
  let sourceUrl = rawSource || clean(request?.sourceUrl, 2048);
  const name = clean(input?.name, 160) || clean(request?.name, 160) || slug;

  if (sourceUrl && !/^https:\/\//iu.test(sourceUrl)) {
    const sourceSlug = normalizeSkillHubSlug(sourceUrl);
    if (!sourceSlug) return { error: 'Skill 来源必须是 HTTPS 地址或有效的 SkillHub slug。' };
    slug = slug || sourceSlug;
    sourceUrl = skillHubDownloadUrl(slug);
  }

  if (sourceUrl) {
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { return { error: 'Skill 来源不是有效地址。' }; }
    if (parsed.protocol !== 'https:') return { error: 'Skill 来源必须使用 HTTPS。' };
    const host = parsed.hostname.toLocaleLowerCase();
    if (SKILLHUB_INSTALL_HOSTS.has(host)) {
      const isInstruction = /^\/install\/skillhub\.md\/?$/iu.test(parsed.pathname);
      const pageSlug = skillHubSlugFromUrl(sourceUrl);
      slug = slug || pageSlug;
      if (isInstruction || pageSlug) {
        if (!slug) return { error: '已识别 SkillHub 安装说明，但没有识别出要安装的技能名。' };
        sourceUrl = skillHubDownloadUrl(slug);
      }
    } else if (host === SKILLHUB_API_HOST && parsed.pathname === '/api/v1/download') {
      slug = slug || normalizeSkillHubSlug(parsed.searchParams.get('slug'));
      if (!slug) return { error: 'SkillHub 下载地址缺少有效 slug。' };
      sourceUrl = skillHubDownloadUrl(slug);
    }
  } else if (slug) {
    sourceUrl = skillHubDownloadUrl(slug);
  }

  if (!sourceUrl) return { error: '请提供 SkillHub slug、技能名或官方 HTTPS 来源地址。' };
  return {
    sourceUrl,
    name: name || slug || undefined,
    slug: slug || undefined,
    provider: slug ? 'skillhub' : 'direct',
  };
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
  // A concrete package location is stronger evidence than a generic install
  // manual pasted alongside it. Preserve the user's explicitly chosen source.
  const directUrl = urls.find((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && (
        /\.zip$/iu.test(parsed.pathname)
        || /(?:^|\/)SKILL\.md$/iu.test(parsed.pathname)
        || parsed.hostname.toLocaleLowerCase() === 'github.com'
        || (SKILLHUB_INSTALL_HOSTS.has(parsed.hostname.toLocaleLowerCase()) && /^\/skills\//iu.test(parsed.pathname))
        || isSkillHubDownloadUrl(value)
      );
    } catch {
      return false;
    }
  });
  if (directUrl) {
    // A slug mentioned in prose must not reclassify a GitHub/ZIP package as a
    // SkillHub download. Only a SkillHub URL may supply a SkillHub slug here.
    const slug = skillHubSlugFromUrl(directUrl);
    return { ...(instructionUrl ? { instructionUrl } : {}), ...resolveSkillInstallInput({ sourceUrl: directUrl, slug, name: slug || undefined }) };
  }
  if (instructionUrl) {
    const slug = skillHubSlugFromRequest(source);
    if (!slug) return { instructionUrl, error: '已识别 SkillHub 安装说明，但没有识别出要安装的技能名。' };
    return { instructionUrl, ...resolveSkillInstallInput({ sourceUrl: instructionUrl, slug, name: slug }) };
  }
  const slug = skillHubSlugFromRequest(source) || skillHubSlugFromUrl(directUrl);
  if (!directUrl && !slug) return undefined;
  return resolveSkillInstallInput({ sourceUrl: directUrl, slug, name: slug || undefined });
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
