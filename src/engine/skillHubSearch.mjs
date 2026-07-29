const SEARCH_URL = 'https://api.skillhub.cn/api/skills';

function text(value, limit = 400) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, limit);
}

export function isSkillDiscoveryRequest(value) {
  const input = text(value, 2000);
  const mentionsSkill = /(?:\bskills?\b|技能|技能源|技能库)/iu.test(input);
  const discoveryAction = /(?:找|搜索|检索|查找|发现|推荐|有没有|适合|爆款|安装|更新|链接|地址|来源|详情)/u.test(input);
  return mentionsSkill && discoveryAction;
}

export function isSkillLinkRequest(value) {
  const input = text(value, 2000);
  return isSkillDiscoveryRequest(input)
    && /(?:链接|地址|来源|详情|安装地址)/u.test(input)
    && !/(?:读取正文|详细介绍|分析说明|使用方法)/u.test(input);
}

export function skillDiscoveryQuery(value) {
  const input = text(value, 500);
  const explicitSlug = input.match(/(?:^|[^a-z0-9])(@?[a-z][a-z0-9._-]{2,}(?:\/[a-z][a-z0-9._-]{2,})?)(?:$|[^a-z0-9])/iu)?.[1];
  if (explicitSlug && !['skill', 'skills', 'skillhub', 'link', 'url'].includes(explicitSlug.toLowerCase())) return explicitSlug;
  return input
    .replace(/(?:请|帮我|帮忙|给我|我想|我要|能不能|可以不可以)/gu, ' ')
    .replace(/(?:找|搜索|检索|查找|发现|推荐|有没有|一个|一个适合我的|相关的|链接|地址|来源|详情)/gu, ' ')
    .replace(/(?:skill|skills|技能|技能库|技能源)/giu, ' ')
    .replace(/[“”"'，。！？、:：]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 180) || input;
}

export async function searchSkillHub(value, fetchImpl = globalThis.fetch) {
  const query = skillDiscoveryQuery(value);
  if (!query) return { ok: false, error: 'SkillHub 检索词为空。' };
  if (typeof fetchImpl !== 'function') return { ok: false, error: '当前环境没有可用的网络请求能力。' };
  const queries = [...new Set([
    query,
    query.includes('视频') || /video|douyin|tiktok/iu.test(query) ? `${query} 短视频 video analysis` : '',
    query.includes('技能') || /skill|技能/iu.test(query) ? `${query} skill discovery` : '',
  ].map((item) => text(item, 180)).filter(Boolean))].slice(0, 4);
  const resultsBySlug = new Map();
  const failures = [];
  for (const candidateQuery of queries) {
    const url = `${SEARCH_URL}?keyword=${encodeURIComponent(candidateQuery)}&sortBy=score&pageSize=8`;
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'taiji-skill-runtime/1' },
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(15000) : undefined,
      });
      if (!response.ok) { failures.push(`HTTP ${response.status}`); continue; }
      const payload = await response.json();
      const rows = Array.isArray(payload?.data?.skills) ? payload.data.skills : [];
      for (const item of rows) {
        const slug = text(item?.slug, 180);
        if (!slug || resultsBySlug.has(slug)) continue;
        resultsBySlug.set(slug, {
          slug,
          name: text(item?.name || item?.displayName || slug, 180),
          description: text(item?.description_zh || item?.description || item?.summary, 600),
          category: text(item?.category, 100),
          downloads: Number(item?.downloads) || 0,
          installs: Number(item?.installs) || 0,
          version: text(item?.version, 80),
          homepage: `https://skillhub.cn/skills/${encodeURIComponent(slug)}`,
        });
      }
    } catch (error) {
      failures.push(text(error?.message || error, 180));
    }
  }
  const results = [...resultsBySlug.values()]
    .sort((left, right) => (right.downloads + right.installs) - (left.downloads + left.installs))
    .slice(0, 5);
  return {
    ok: results.length > 0 || failures.length === 0,
    query,
    queries,
    url: SEARCH_URL,
    results,
    error: results.length ? '' : failures.length ? `SkillHub 检索失败：${failures.join('; ')}` : '',
  };
}

export function formatSkillHubResults(result) {
  if (!result?.ok) return result?.error || 'SkillHub 检索失败。';
  if (!result.results?.length) return `SkillHub 没有找到与“${result.query}”直接匹配的 Skill。`;
  return result.results.map((item, index) => [
    `${index + 1}. ${item.name} (${item.slug})`,
    item.version ? `版本：${item.version}` : '',
    item.description ? `说明：${item.description}` : '',
    `分类：${item.category || '未分类'} | 下载：${item.downloads} | 安装：${item.installs}`,
    `主页：${item.homepage || `https://skillhub.cn/skills/${encodeURIComponent(item.slug)}`}`,
    `来源地址：https://api.skillhub.cn/api/v1/download?slug=${encodeURIComponent(item.slug)}`,
  ].filter(Boolean).join('\n')).join('\n\n');
}
