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

function githubRepositoryUrl(value) {
  const candidate = clean(value, 512).replace(/^@/u, '');
  if (/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,99}$/iu.test(candidate)) {
    return `https://github.com/${candidate.replace(/\.git$/iu, '')}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLocaleLowerCase() !== 'github.com') return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || !parts[0] || !parts[1]) return '';
    return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/iu, '')}`;
  } catch {
    return '';
  }
}

/** Parse skills CLI input without starting its interactive installer. */
export function parseSkillCliInstall(value) {
  const source = clean(value, 12000);
  const match = source.match(/(?:^|\s)(?:npx\s+)?skills\s+add\s+([^\s`'"<>]+)/iu);
  if (!match) return undefined;
  const repositoryUrl = githubRepositoryUrl(match[1].replace(/[),.;!?]+$/gu, ''));
  if (!repositoryUrl) return { error: 'skills add 只支持 GitHub 仓库地址或 owner/repo 格式。' };
  const skillNames = [...source.matchAll(/(?:--skill|--skills?)\s*(?:=|\s)\s*([^\s,]+(?:\s*,\s*[^\s,]+)*)/giu)]
    .flatMap((item) => String(item[1] || '').split(','))
    .map((item) => item.trim().replace(/^['"`]|['"`]$/gu, ''))
    .filter(Boolean)
    .slice(0, 40);
  return {
    sourceUrl: repositoryUrl,
    repositoryUrl,
    skillNames,
    installAll: skillNames.length === 0 || /(?:^|\s)--all(?:\s|$)/iu.test(source),
    command: 'skills add',
  };
}

export function isExplicitSkillInstallOperation(text) {
  const source = clean(text, 12000);
  const cli = parseSkillCliInstall(source);
  if (cli) {
    if (/[?？]|(?:什么(?:意思|命令)?|怎么用|如何用|为什么|能否|可以吗|是否|解释|介绍)/u.test(source)) return false;
    if (/^\s*(?:`{1,3}\s*)?(?:npx\s+)?skills\s+add\s+[^\s`'"<>]+(?:\s+--?[^\s`'"<>]+(?:\s+[^\s`'"<>]+)?)?\s*`{0,3}\s*[。！!]?\s*$/iu.test(source)) return true;
    return /(?:请|帮我|替我|直接|现在|继续).{0,24}(?:执行|运行|安装|装上|装好)/u.test(source);
  }
  return Boolean(resolveSkillInstallRequest(source)?.sourceUrl);
}

/**
 * Detect a real install request independently from whether the source lives in
 * the current text. The latter is important for a follow-up such as “安装它”:
 * the source is carried by the conversation-reference contract, not guessed
 * from the model's prose.
 */
export function isSkillInstallAction(text, options = {}) {
  const source = clean(text, 12000);
  if (!source) return false;
  if (isExplicitSkillInstallOperation(source)) return true;
  if (/[?？]|(?:什么(?:意思|命令)?|怎么用|如何用|为什么|能否|可以吗|是否|解释|介绍)/u.test(source)) return false;
  if (!/(?:安装|装上|装好|部署|install)/iu.test(source)) return false;
  if (/(?:没有|未|无法|不能|失败).{0,16}(?:安装|装上|装好|部署|install)/iu.test(source)
      && !/(?:请|帮我|给我|替我|现在|直接|立即|重新|继续|接着)/u.test(source)) return false;
  if (/(?:skill|技能|插件)/iu.test(source)) return true;
  if (options.allowBoundReference !== true) return false;
  const refersToBoundObject = /(?:它|这个(?:技能|插件)?|该(?:技能|插件)?|上面那个(?:技能|插件)?|刚才那个(?:技能|插件)?|前面那个(?:技能|插件)?)/u.test(source);
  const imperative = /(?:^|[，,。；;]\s*)(?:请(?:你)?|帮我|给我|替我|现在|直接|立即|重新|继续|接着|把|安装|装上|装好|部署|install)/iu.test(source);
  return refersToBoundObject && imperative;
}

function isSkillInstallContinuationMessage(text) {
  const source = clean(text, 12000);
  if (!source) return false;
  if (isExplicitSkillInstallOperation(source)) return true;
  if (/[?？]|(?:什么(?:意思|命令)?|怎么用|如何用|为什么|能否|可以吗|是否|解释|介绍)/u.test(source)) return false;
  return /(?:继续|重试|重新|接着|开始|直接|立即|现在|代理|网络).{0,36}(?:安装|执行|尝试|完成|处理|继续)|(?:安装|装上|装好|部署).{0,28}(?:继续|重试|重新|开始|执行)/iu.test(source);
}

/**
 * Recover an explicit installation source without asking a planning model to
 * reconstruct it from prose. This is deliberately narrow: only an explicit
 * install command/source or an install-oriented continuation may inherit the
 * nearest earlier source.
 */
export function resolveSkillInstallContinuation(messages = [], options = {}) {
  const history = (Array.isArray(messages) ? messages : [])
    .map((item) => clean(item, 12000))
    .filter(Boolean)
    .slice(-12);
  const latest = clean(options.latestMessage || history.at(-1), 12000);
  const direct = isSkillInstallAction(latest) ? resolveSkillInstallRequest(latest) : undefined;
  if (direct?.sourceUrl) return { ...direct, requestText: latest, resumed: false };
  if (!isSkillInstallContinuationMessage(latest)) return undefined;

  const active = resolveSkillInstallRequest(clean(options.activeTaskGoal, 12000));
  if (active?.sourceUrl) return { ...active, requestText: clean(options.activeTaskGoal, 12000), resumed: true };

  for (let index = history.length - 2; index >= 0; index -= 1) {
    const requestText = history[index];
    const candidate = resolveSkillInstallRequest(requestText);
    if (candidate?.sourceUrl) return { ...candidate, requestText, resumed: true };
  }
  return undefined;
}

function githubRepositoryDetails(value) {
  try {
    const parsed = new URL(clean(value));
    if (parsed.protocol !== 'https:' || parsed.hostname.toLocaleLowerCase() !== 'github.com') return undefined;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[1].toLocaleLowerCase() === 'tree') return undefined;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/iu, '') };
  } catch {
    return undefined;
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
  const cli = requestText ? parseSkillCliInstall(requestText) : undefined;
  if (cli?.error) return { error: cli.error };
  const rawSource = clean(input?.sourceUrl ?? input?.url, 2048);
  const request = requestText ? resolveSkillInstallRequest(requestText) : undefined;
  let slug = normalizeSkillHubSlug(input?.slug)
    || skillHubSlugFromUrl(rawSource)
    || (!rawSource ? normalizeSkillHubSlug(input?.name) : '')
    || normalizeSkillHubSlug(request?.slug);
  let sourceUrl = rawSource || clean(cli?.sourceUrl, 2048) || clean(request?.sourceUrl, 2048);
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
    ...(githubRepositoryDetails(sourceUrl) ? {
      repository: { type: 'github-repository', ...githubRepositoryDetails(sourceUrl) },
      skillNames: (Array.isArray(input?.skillNames) ? input.skillNames : (cli?.skillNames || []))
        .map((item) => clean(item, 120)).filter(Boolean).slice(0, 40),
      installAll: input?.installAll ?? cli?.installAll ?? true,
    } : {}),
  };
}

export function resolveSkillInstallRequest(text) {
  const cli = parseSkillCliInstall(text);
  if (cli?.error) return cli;
  if (cli) return resolveSkillInstallInput(cli);
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

export function isSkillInstallOnlyRequest(text, options = {}) {
  const source = clean(text, 12000)
    .replace(/https:\/\/\S+/giu, ' ')
    .replace(/[`'"“”]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!isSkillInstallAction(text, options)) return false;
  return !/(?:并|然后|之后|安装后|装好后).{0,24}(?:使用|运行|执行|创建|生成|写|搜索|查询|验证业务|完成任务)/iu.test(source);
}
