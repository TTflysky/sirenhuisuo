const MAX_REFERENCES = 24;

function text(value, limit = 240) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, limit);
}

function uniqueReferences(items = []) {
  const seen = new Set();
  return items
    .filter((item) => item && item.kind && item.id && item.label)
    .map((item) => ({
      kind: item.kind,
      id: text(item.id, 240),
      label: text(item.label, 240),
      sourceUrl: /^https:\/\//iu.test(item.sourceUrl ?? '') ? text(item.sourceUrl, 2048) : undefined,
      state: item.state || 'unknown',
      messageId: item.messageId ? text(item.messageId, 240) : undefined,
    }))
    .filter((item) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_REFERENCES);
}

function urls(value) {
  return [...String(value ?? '').matchAll(/https?:\/\/[^\s<>\][)"']+/giu)].map((match) => match[0].replace(/[.,;:!?]+$/u, ''));
}

function referencesFromMessage(message) {
  const result = Array.isArray(message?.references) ? [...message.references] : [];
  for (const skill of message?.skillRefs ?? []) {
    result.push({ kind: 'skill', id: skill.id, label: skill.name, state: 'local', messageId: message.id });
  }
  for (const attachment of message?.attachments ?? []) {
    if (!attachment?.name) continue;
    result.push({ kind: 'file', id: attachment.path || attachment.name, label: attachment.name, state: 'local', messageId: message.id });
  }
  if (message?.taskRef) result.push({ kind: 'task', id: message.taskRef, label: message.taskRef, state: 'unknown', messageId: message.id });
  for (const url of urls(message?.content)) {
    result.push({ kind: 'web', id: url, label: url, sourceUrl: url, state: 'unknown', messageId: message.id });
  }
  if (message?.roleId !== 'human' && text(message?.content)) {
    result.push({ kind: 'answer', id: message.id, label: text(message.content, 120), state: 'completed', messageId: message.id });
  }
  return result;
}

function actionFor(input) {
  const value = text(input, 1600);
  if (/(?:链接|地址|来源|主页|下载地址)/u.test(value)) return 'share-link';
  if (/(?:安装|装上|装好|部署)/u.test(value)) return 'install';
  if (/(?:读取|读一下|打开|查看|规则|说明)/u.test(value)) return 'read';
  if (/(?:继续|恢复|接着做|继续做)/u.test(value)) return 'continue';
  return 'refer';
}

function refersToPrior(input) {
  return /(?:它|这个|这份|这个东西|刚才那个|上面那个|上述|前面那个|该技能|该文件|该链接|这个技能|这个文件|这个团队)/u.test(text(input, 1600));
}

function requestedKind(input, action) {
  const value = text(input, 1600);
  if (/(?:skill|技能|插件)/iu.test(value) || (action === 'install' && !/(?:软件|应用|客户端|文件)/u.test(value))) return 'skill';
  if (/(?:文件|附件|文档|表格|图片|代码)/u.test(value)) return 'file';
  if (/(?:团队|群聊|项目组)/u.test(value)) return 'team';
  if (/(?:员工|成员|同事)/u.test(value)) return 'employee';
  if (/(?:任务|项目|步骤)/u.test(value)) return 'task';
  if (/(?:网页|网站|页面|文章)/u.test(value)) return 'web';
  return '';
}

/**
 * Resolve deictic follow-ups before tool routing. The resolver only uses actual
 * chat metadata and never manufactures a URL or a resource identity.
 */
export function resolveConversationReferences({ input, history = [], selectedSkillRefs = [] } = {}) {
  const action = actionFor(input);
  const kind = requestedKind(input, action);
  const explicit = selectedSkillRefs.map((skill) => ({ kind: 'skill', id: skill.id, label: skill.name, state: 'local' }));
  const available = uniqueReferences([
    ...explicit,
    ...[...history].reverse().flatMap(referencesFromMessage),
  ]);
  const named = text(input, 1600).toLocaleLowerCase();
  const direct = available.filter((item) => named.includes(item.id.toLocaleLowerCase()) || named.includes(item.label.toLocaleLowerCase()));
  let candidates = (direct.length ? direct : available)
    .filter((item) => !kind || item.kind === kind);
  // A request for a link refers to a concrete source, never the prose answer
  // that happened to mention it. This also works for webpages and files with URLs.
  if (!kind && action === 'share-link') {
    const sourceCandidates = candidates.filter((item) => item.sourceUrl);
    if (sourceCandidates.length) candidates = sourceCandidates;
  }
  const needsBinding = refersToPrior(input) || direct.length > 0;
  if (!needsBinding) return { status: 'none', action, references: [], skillRefs: [], context: '' };
  if (!candidates.length) return { status: 'missing', action, references: [], skillRefs: [], context: '' };
  const sameKind = uniqueReferences(candidates);
  if (sameKind.length > 1 && !direct.length) {
    return { status: 'ambiguous', action, references: sameKind, skillRefs: [], context: '' };
  }
  const references = sameKind.slice(0, 1);
  const skillRefs = references.filter((item) => item.kind === 'skill').map((item) => ({ id: item.id, name: item.label }));
  const summary = references.map((item) => `- ${item.kind}: ${item.label} (ID: ${item.id}; state: ${item.state}${item.sourceUrl ? `; source: ${item.sourceUrl}` : ''})`).join('\n');
  return {
    status: 'resolved',
    action,
    references,
    skillRefs,
    context: `## Bound conversation reference\nThe user is referring to this exact existing object. Do not search for a similarly named replacement and do not invent a source URL.\n${summary}\nFor a link request, return sourceUrl only when it is present; otherwise explain that this is a local object without a public source URL.`,
  };
}

/** Extract durable objects from observed tool results, including SkillHub candidates. */
export function referencesFromToolResult(name, argsText, output, success = true) {
  if (!success) return [];
  const args = (() => { try { return JSON.parse(argsText || '{}'); } catch { return {}; } })();
  const result = [];
  if (name === 'search_skills') {
    const sections = String(output ?? '').split(/\n\s*\n/gu);
    for (const section of sections) {
      const heading = section.match(/^\s*\d+\.\s+(.+?)\s*\(([^()\s]+)\)\s*$/mu);
      if (!heading) continue;
      const sourceUrl = section.match(/https:\/\/api\.skillhub\.cn\/api\/v1\/download\?slug=[^\s]+/iu)?.[0];
      const homepage = section.match(/https:\/\/skillhub\.cn\/skills\/[^\s]+/iu)?.[0];
      result.push({ kind: 'skill', id: heading[2], label: heading[1], sourceUrl: sourceUrl || homepage, state: 'candidate' });
    }
  } else if (name === 'install_skill') {
    const id = String(output ?? '').match(/(?:^|\n)ID:\s*([^\n]+)/u)?.[1]?.trim();
    const label = String(output ?? '').match(/(?:^|\n)(?:名称|Name):\s*([^\n]+)/u)?.[1]?.trim() || args.name || id;
    const sourceUrl = String(output ?? '').match(/(?:^|\n)来源:\s*(https:\/\/[^\s]+)/u)?.[1] || args.sourceUrl;
    if (id && label) result.push({ kind: 'skill', id, label, sourceUrl, state: 'installed' });
  } else if (name === 'read_skill' && args.id) {
    const label = String(output ?? '').match(/Skill[“"]([^”"]+)/u)?.[1] || args.id;
    result.push({ kind: 'skill', id: args.id, label, state: 'local' });
  } else if (name === 'read_file' && args.path) {
    result.push({ kind: 'file', id: args.path, label: args.path, state: 'local' });
  } else if (name === 'read_web_page' && args.url) {
    result.push({ kind: 'web', id: args.url, label: args.url, sourceUrl: args.url, state: 'verified' });
  } else if (name === 'web_search') {
    for (const url of urls(output).slice(0, 5)) result.push({ kind: 'web', id: url, label: url, sourceUrl: url, state: 'candidate' });
  }
  return uniqueReferences(result);
}

export function referenceClarification(result) {
  const labels = result.references.map((item, index) => `${index + 1}. ${item.label}`).join('\n');
  return `我还不能确定“它”具体指哪一个真实对象。请直接回复名称或序号：\n${labels}`;
}
