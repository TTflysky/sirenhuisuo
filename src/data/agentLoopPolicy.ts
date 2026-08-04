export function getUserActionForFailure(raw: string): string {
  if (/连接器|知识库|MCP|Obsidian|Vault|服务地址|认证凭据/iu.test(raw)) {
    if (/缺少|未配置|还需要|不能为空/iu.test(raw)) return '在已经打开的连接器配置窗口中填写提示的地址、目录或认证凭据，然后点击“一键配置”；保存后助手会继续做连接测试。';
    return '打开主界面左侧“连接器”，找到对应服务并点击设置，核对地址和认证信息后保存；助手会重新测试并告诉你是否真正可用。';
  }
  if (/401|403|unauthorized|forbidden|api\s*key|鉴权|密钥/iu.test(raw)) {
    return '打开“设置 → 模型”，检查接口地址和 API Key，保存后回复“继续”，我会从连接验证开始。';
  }
  if (/验证码|verification\s*code|captcha|登录|sign[ -]?in|oauth|授权/iu.test(raw)) {
    return '先在对应服务完成登录、验证码或授权，完成后回复“继续”，我会接着验证。';
  }
  if (/EACCES|EPERM|permission|权限|拒绝访问|administrator/iu.test(raw)) {
    return '请用管理员身份重新打开太极，然后回复“继续”，我会从失败步骤接着做。';
  }
  if (/timeout|timed out|ECONN|ENOTFOUND|network|网络|连接失败/iu.test(raw)) {
    return '先确认电脑能正常访问对应网站或服务，然后回复“继续”，我会重新连接并验证。';
  }
  if (/ENOENT|not found|not recognized|找不到|不存在/iu.test(raw)) {
    return '需要的程序、文件或技能来源没有找到。请提供正确的文件位置或官方下载地址；已有成果会保留。';
  }
  return '请展开最后一条“执行过程”查看通俗原因；如果需要你提供账号、授权、文件或选择，助手会明确说明具体缺少哪一项。';
}

function sourceUrlParts(value: string): { host: string; pathname: string } | undefined {
  try {
    const parsed = new URL(value);
    return { host: parsed.hostname.toLocaleLowerCase(), pathname: parsed.pathname.replace(/\/+$/u, '') };
  } catch {
    return undefined;
  }
}

function githubRepository(value: ReturnType<typeof sourceUrlParts>): string {
  if (!value) return '';
  const parts = value.pathname.split('/').filter(Boolean);
  if (value.host === 'api.github.com' && parts[0] === 'repos') return parts.slice(1, 3).join('/');
  if (value.host === 'github.com' || value.host === 'raw.githubusercontent.com') return parts.slice(0, 2).join('/');
  return '';
}

export function isAllowedPinnedSkillSource(value: unknown, pinnedSource: string): boolean {
  const candidate = sourceUrlParts(String(value || ''));
  const pinned = sourceUrlParts(pinnedSource);
  if (!candidate || !pinned) return false;
  if (candidate.host === pinned.host && candidate.pathname === pinned.pathname) return true;
  const pinnedRepository = githubRepository(pinned);
  const candidateRepository = githubRepository(candidate);
  return Boolean(pinnedRepository && candidateRepository && pinnedRepository === candidateRepository);
}

export function isPinnedSkillRuleDocument(value: unknown, pinnedSource: string): boolean {
  const candidate = sourceUrlParts(String(value || ''));
  const pinned = sourceUrlParts(pinnedSource);
  if (!candidate || !pinned || !isAllowedPinnedSkillSource(value, pinnedSource)) return false;
  return /(?:^|\/)SKILL\.md$/iu.test(candidate.pathname);
}

export function pinnedSkillSourcePath(sourceUrl: string): string {
  return sourceUrlParts(sourceUrl)?.pathname ?? '';
}

export function buildPinnedSkillInstruction(pinnedSkillSource: string): string {
  if (!pinnedSkillSource) return '';
  return `\n\n## 指定 Skill 来源合同\n用户已指定唯一来源：${pinnedSkillSource}\n先读取该来源的 SKILL.md，并按其中的引用关系读取必要配套文件，自己完成用途、规则和风险判断；禁止搜索 SkillsMP、SkillHub 或其他替代来源，禁止使用 npx/skills CLI。完成阅读与风险判断后，调用 install_skill，且 sourceUrl 必须保持为上述来源。客户端原生安装器会复制并校验完整目录。`;
}
