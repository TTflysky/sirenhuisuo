const fs = require('fs/promises');
const path = require('path');
const { searchSkillHub, formatSkillHubResults } = require('./skillHubSearch.cjs');

const NATIVE_TOOL_DEFINITIONS = [
  tool('write_file', '把真实文件写入当前任务工作区。category: final/工作稿 working/参考 reference。', {
    path: stringField('文件名或相对路径'), content: stringField('文件内容'),
    category: { type: 'string', enum: ['final', 'working', 'reference'] },
  }, ['path', 'content', 'category']),
  tool('read_file', '读取当前任务工作区中的文件。', {
    path: stringField('文件相对路径'), offset: stringField('开始字符位置'), limit: stringField('最多读取字符数'),
  }, ['path']),
  tool('list_files', '列出当前任务工作区的真实文件。', { filter: stringField('可选文件名过滤词') }, []),
  tool('web_search', '搜索互联网获取最新资料。', { query: stringField('必须保留用户原始目标中的地点、时间和主题') }, ['query']),
  tool('read_web_page', '读取指定 HTTP/HTTPS 网页正文。', { url: stringField('完整网页地址') }, ['url']),
  tool('search_skills', '搜索可用 Skill；技能发现请求会同时检索 SkillHub 官方市场。', { query: stringField('任务或技能关键词') }, ['query']),
  tool('read_skill', '读取已安装 Skill 的完整说明。', { id: stringField('Skill ID') }, ['id']),
  tool('install_skill', '使用客户端原生安装器从可信 HTTPS、GitHub、SkillHub 或 ZIP 来源安装完整 Skill；禁止改用 skillhub 命令。', {
    sourceUrl: stringField('官方来源地址'), name: stringField('可选名称'),
  }, ['sourceUrl']),
  tool('inspect_connectors', '检查已配置连接器的真实状态，不返回密钥。', { query: stringField('可选服务名') }, []),
  tool('test_connector', '对已配置连接器执行最小真实验证。', { connector: stringField('连接器 ID 或名称') }, ['connector']),
  tool('prepare_connector', '报告连接器配置所需字段。需用户填写密钥时必须明确等待用户。', {
    preset: stringField('连接器预设或名称'),
  }, ['preset']),
  tool('submit_review', '提交结构化审查 PASS/REJECT；审查步骤必须调用。', {
    decision: { type: 'string', enum: ['PASS', 'REJECT'] }, reason: stringField('基于真实产出的审查理由'),
    responsibleStepId: stringField('退回的责任步骤'), responsibleEmployeeId: stringField('退回的责任员工'),
    checkedArtifacts: { type: 'array', items: { type: 'string' } },
  }, ['decision', 'reason']),
  tool('delegate_subtask', '将明确、可验收的子任务委派给当前团队成员。必须指定实际工作内容；系统会创建可恢复子任务和责任记录。', {
    assignment: stringField('子任务的具体工作内容'), employeeId: stringField('可选：当前团队成员 ID；不填由系统按职责选择'),
    title: stringField('可选：子任务标题'), acceptanceCriteria: { type: 'array', items: { type: 'string' } },
  }, ['assignment']),
  tool('prepare_git_worktree', '仅用于本地 Git 代码任务：从指定仓库创建当前任务独占的分支与 Worktree，后续文件和命令都在隔离工作树执行。', {
    sourceRepo: stringField('本地 Git 仓库绝对路径'), baseRef: stringField('可选：基线分支、Tag 或提交'),
  }, ['sourceRepo']),
  tool('checkpoint_git_worktree', '保存当前代码工作树的 HEAD、差异补丁和未跟踪文件清单，形成可校验恢复点。', {
    label: stringField('可选恢复点名称'),
  }, []),
  tool('run_command', '在当前任务工作区执行 Windows PowerShell 命令，必须遵守沙盒与审批策略。', {
    cmd: stringField('完整 PowerShell 命令'), verification: { type: 'boolean' }, connector: stringField('可选连接器 ID'),
  }, ['cmd']),
];

function stringField(description) { return { type: 'string', description }; }
function tool(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

function normalizeRelative(value, fallback = '') {
  const parts = String(value || fallback).replace(/\\/g, '/').split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*\p{Cc}]/gu, '_'));
  return parts.join('/') || fallback;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, 'Bearer [已隐藏]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/giu, '[已隐藏的敏感信息]')
      .replace(/((?:api.?key|access.?token|auth.?token|client.?secret|password|secret)\s*[:=]\s*['"]?)[^\s'",;]{6,}/giu, '$1[已隐藏]');
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /(?:api.?key|token|secret|password|authorization|cookie|credential)/iu.test(key) ? '[已隐藏]' : redact(item),
  ]));
}

function containsSensitiveLiteral(value) {
  const text = String(value || '');
  return /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu.test(text)
    || /\bsk-[A-Za-z0-9_-]{8,}/iu.test(text)
    || /(?:api.?key|access.?token|auth.?token|client.?secret|password|secret)\s*[:=]\s*['"]?[^\s'",;]{6,}/iu.test(text);
}

function isRoutineCommand(command) {
  const value = String(command || '').trim();
  if (/[;|&`<>]/u.test(value) || /\$[({]/u.test(value)) return false;
  return /^(?:dir|ls|get-childitem|test-path)(?:\s+[-\w.*?\\/.:'"]+)*$/iu.test(value)
    || /^git\s+(?:status|log|diff|branch)(?:\s+[-\w.*?\\/.:'"]+)*$/iu.test(value)
    || /^npm(?:\.cmd)?\s+(?:run\s+(?:build|lint|test|check|typecheck|verify:[\w-]+)|test|--version)(?:\s+[-\w.*?\\/.:'"]+)*$/iu.test(value)
    || /^(?:node|npm|npm\.cmd|python|py)\s+--version$/iu.test(value);
}

function connectorMatches(connector, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return [connector.id, connector.label, connector.kind, connector.mcpServerName, connector.installedSkillId]
    .some((value) => String(value || '').toLowerCase().includes(needle));
}

function connectorConfigured(connector) {
  if (!connector?.enabled) return { ok: false, reason: '已禁用' };
  if (connector.kind === 'obsidian') return connector.localPath ? { ok: true } : { ok: false, reason: '未选择 Vault 目录' };
  if (connector.kind === 'knowledge-url') return connector.baseUrl ? { ok: true } : { ok: false, reason: '未填写知识库链接' };
  const required = (connector.credentialFields || []).filter((field) => field.required && !connector.credentials?.[field.key]);
  if (required.length) return { ok: false, reason: `缺少 ${required.map((field) => field.label).join('、')}` };
  if (connector.auth?.type && connector.auth.type !== 'none' && !connector.auth.token && Object.keys(connector.credentials || {}).length === 0) {
    return { ok: false, reason: '缺少认证凭据' };
  }
  if (connector.runtime === 'http' || connector.baseUrl) return connector.baseUrl ? { ok: true } : { ok: false, reason: '未填写服务地址' };
  if (connector.kind === 'skill-bridge') return connector.installedSkillId ? { ok: true } : { ok: false, reason: '未安装对应 Skill' };
  return connector.status === 'connected' ? { ok: true } : { ok: false, reason: connector.error || '尚未通过真实验证' };
}

function interpolate(template, args, encode = false) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_match, key) => {
    const value = args[key] == null ? '' : typeof args[key] === 'string' ? args[key] : JSON.stringify(args[key]);
    return encode ? encodeURIComponent(value) : value;
  });
}

function authHeaders(connector) {
  const headers = { ...(connector.headers || {}) };
  if (connector.auth?.token) {
    const name = connector.auth.headerName || 'Authorization';
    const prefix = connector.auth.prefix ?? (connector.auth.type === 'bearer' ? 'Bearer ' : '');
    headers[name] = `${prefix}${connector.auth.token}`;
  }
  return headers;
}

function createNativeToolRuntime(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const projectRoot = path.resolve(options.projectRoot);

  function taskRoot(context) {
    const id = normalizeRelative(context.workspaceId || context.scope || 'global', 'global');
    const root = path.resolve(workspaceRoot, id);
    if (!inside(workspaceRoot, root)) throw new Error('工作区路径越界');
    return root;
  }

  function taskPath(context, relativePath, fallback = '') {
    const root = taskRoot(context);
    const target = path.resolve(root, normalizeRelative(relativePath, fallback));
    if (!inside(root, target)) throw new Error('文件路径越界');
    return { root, target };
  }

  async function listWorkspace(context, filter = '') {
    const root = taskRoot(context);
    await fs.mkdir(root, { recursive: true });
    const rows = [];
    async function walk(directory, prefix = '') {
      let entries = [];
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(directory, entry.name);
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(full, relative);
        else {
          const stat = await fs.stat(full);
          if (!filter || relative.toLowerCase().includes(String(filter).toLowerCase())) rows.push({ path: relative, size: stat.size, modifiedAt: stat.mtimeMs });
        }
      }
    }
    await walk(root);
    return rows.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
  }

  async function executeConnectorAction(name, args, context) {
    const binding = (context.connectorActions || []).find((item) => item.name === name);
    if (!binding) return null;
    const connector = (context.connectors || []).find((item) => item.id === binding.connectorId);
    if (!connector) return failed(name, '连接器不存在或已删除');
    const state = connectorConfigured(connector);
    if (!state.ok) return failed(name, `${connector.label}未就绪：${state.reason}`);
    const action = binding.action || {};
    if (action.sideEffect && context.executionPolicy?.connectorApprovalMode !== 'full') {
      return failed(name, `等待用户批准：${connector.label} 的“${action.name || name}”会修改外部服务。`, { awaitingApproval: true });
    }
    try {
      if (action.local === 'knowledge-fetch-url') {
        const result = await options.fetchKnowledgeUrl(connector.baseUrl, { fetchImpl: options.fetchImpl });
        return result.ok ? succeeded(name, result.content || result.data || '读取成功', connectionEvidence(connector, name, true)) : failed(name, result.error || '读取失败');
      }
      if (action.local === 'obsidian-search') {
        const result = await options.searchObsidianVault(connector.localPath, args.query);
        return result.ok ? succeeded(name, JSON.stringify(result.results || [], null, 2), connectionEvidence(connector, name, true)) : failed(name, result.error || '搜索失败');
      }
      if (action.local === 'obsidian-read') {
        const result = await options.readObsidianNote(connector.localPath, args.path);
        return result.ok ? succeeded(name, result.content || '', connectionEvidence(connector, name, true)) : failed(name, result.error || '读取失败');
      }
      if (!action.http || !connector.baseUrl) return failed(name, '该连接器动作还没有主进程可执行端点');
      const endpoint = new URL(interpolate(action.http.path || '', args, true), connector.baseUrl).toString();
      const headers = { Accept: 'application/json', ...authHeaders(connector) };
      let body;
      if (action.http.bodyTemplate) {
        body = interpolate(action.http.bodyTemplate, args, false);
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      }
      const response = await options.fetchImpl(endpoint, { method: action.http.method || 'GET', headers, body });
      const text = await response.text();
      if (!response.ok) return failed(name, `HTTP ${response.status}：${text.slice(0, 1600)}`);
      return succeeded(name, text.slice(0, 12000) || '连接器调用成功', connectionEvidence(connector, name, true));
    } catch (error) {
      return failed(name, error?.message || String(error));
    }
  }

  async function execute(name, rawArgs, context = {}) {
    const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
    const dynamic = await executeConnectorAction(name, args, context);
    if (dynamic) return dynamic;
    try {
      if (name === 'write_file') {
        const relative = normalizeRelative(args.path, 'untitled.txt');
        const { target } = taskPath(context, relative, 'untitled.txt');
        await fs.mkdir(path.dirname(target), { recursive: true });
        const content = String(args.content ?? '');
        let validation = 'read_back';
        if (path.extname(target).toLowerCase() === '.docx') {
          await options.createWordDocument(target, content);
          validation = 'document_parse';
        } else {
          await fs.writeFile(target, content, 'utf8');
          const readBack = await fs.readFile(target, 'utf8');
          if (readBack !== content) return failed(name, `文件写入后校验不一致：${relative}`);
        }
        const stat = await fs.stat(target);
        return succeeded(name, `文件已写入：${relative}（${stat.size} 字节）`, {
          artifacts: [{ path: relative, filename: path.basename(relative), workspaceId: context.workspaceId, diskPath: target, bytes: stat.size,
            category: ['final', 'working', 'reference'].includes(args.category) ? args.category : 'working', persistence: 'disk', verification: validation, verified: true, recordedAt: Date.now() }],
        });
      }
      if (name === 'read_file') {
        const relative = normalizeRelative(args.path);
        if (!relative) return failed(name, '请提供文件路径');
        const { target } = taskPath(context, relative);
        const stat = await fs.stat(target);
        if (!stat.isFile()) return failed(name, '目标不是文件');
        if (stat.size > 50 * 1024 * 1024) return failed(name, '文件超过 50MB 读取上限');
        const offset = Math.max(0, Number.parseInt(args.offset || '0', 10) || 0);
        const limit = Math.min(50000, Math.max(1000, Number.parseInt(args.limit || '12000', 10) || 12000));
        let content;
        if (options.readWorkspaceFile) {
          content = await options.readWorkspaceFile(target);
          if (content?.ok === false) return failed(name, content.error || '文件读取失败');
        }
        else content = await fs.readFile(target, 'utf8');
        const text = String(content?.content ?? content ?? '');
        return succeeded(name, `文件：${relative}\n字符范围：${offset}-${Math.min(text.length, offset + limit)}/${text.length}\n\n${text.slice(offset, offset + limit)}`);
      }
      if (name === 'list_files') {
        const rows = await listWorkspace(context, args.filter);
        return succeeded(name, rows.length ? rows.map((item) => `- ${item.path} (${item.size} 字节)`).join('\n') : '工作区目前没有可交付文件。');
      }
      if (name === 'web_search') {
        const result = await options.searchWeb(String(args.query || ''), { fetchImpl: options.fetchImpl });
        if (result?.ok === false) return failed(name, result.error || '搜索失败');
        const rows = result.results || [];
        const output = rows.map((item, index) => `${index + 1}. ${item.title}\n${item.url}\n${item.snippet || ''}`).join('\n\n');
        return rows.length ? succeeded(name, output) : failed(name, '搜索源没有返回结果');
      }
      if (name === 'read_web_page') {
        const result = await options.fetchKnowledgeUrl(String(args.url || ''), { fetchImpl: options.fetchImpl });
        return result?.ok ? succeeded(name, String(result.content || result.data || '').slice(0, 50000)) : failed(name, result?.error || '网页读取失败');
      }
      if (name === 'search_skills') {
        const skills = await options.listSkills(projectRoot);
        const query = String(args.query || '').trim().toLowerCase();
        const tokens = query.split(/[\s，。；、]+/u).filter((item) => item.length > 1);
        const matches = skills.filter((skill) => {
          const text = `${skill.id} ${skill.name} ${skill.description || ''}`.toLowerCase();
          return !tokens.length || tokens.some((token) => text.includes(token));
        }).slice(0, 12);
        const localOutput = matches.length
          ? matches.map((skill) => `- ${skill.id} | ${skill.name} | ${skill.health || 'unknown'} | ${skill.description || ''}`).join('\n')
          : '本机没有直接匹配的 Skill。';
        if (!/(?:\bskills?\b|技能|技能源|技能库)/iu.test(query) || !/(?:找|搜索|检索|查找|发现|推荐|有没有|适合|爆款|安装|更新)/u.test(query)) {
          return succeeded(name, `${localOutput}\n来源范围：本机已安装技能。`);
        }
        const market = await searchSkillHub(query, options.fetchImpl);
        if (!market.ok) return failed(name, `SkillHub 官方检索失败：${market.error}\n本机结果不能替代市场结果。`);
        return market.results?.length
          ? succeeded(name, `SkillHub 官方市场结果（查询：${market.query}）：\n${formatSkillHubResults(market)}\n\n候选尚未安装或验证。\n\n本机已安装匹配：\n${localOutput}`)
          : failed(name, `SkillHub 没有找到与“${market.query}”直接匹配的 Skill。\n${localOutput}`);
      }
      if (name === 'read_skill') {
        const skill = await options.readSkill(projectRoot, String(args.id || ''));
        const documents = (skill.documents || []).map((item) => `\n\n## ${item.path}\n${item.content}`).join('');
        return succeeded(name, `# ${skill.name}\n${skill.content}${documents}`.slice(0, 70000), {
          skill: { action: 'read', id: String(args.id || ''), name: skill.name, documentCount: (skill.documents || []).length, verified: true },
        });
      }
      if (name === 'install_skill') {
        if (!/^https:\/\//iu.test(String(args.sourceUrl || ''))) return failed(name, '只允许从 HTTPS 来源安装 Skill');
        if (context.executionPolicy?.approvalMode !== 'full') {
          return failed(name, `等待用户批准安装 Skill：${String(args.sourceUrl).slice(0, 500)}`, { awaitingApproval: true });
        }
        const result = await options.installSkill(projectRoot, { sourceUrl: args.sourceUrl, name: args.name });
        return result.ok
          ? succeeded(name, `Skill 已安装。\nID: ${result.skill?.id || ''}\n名称: ${result.skill?.name || args.name || args.sourceUrl}\n来源: ${result.resolvedUrl || args.sourceUrl}`, {
            skill: { id: result.skill?.id, name: result.skill?.name || args.name, sourceUrl: result.resolvedUrl || args.sourceUrl, verified: true },
          })
          : failed(name, result.error || 'Skill 安装失败');
      }
      if (name === 'inspect_connectors') {
        const rows = (context.connectors || []).filter((item) => connectorMatches(item, args.query)).map((connector) => {
          const state = connectorConfigured(connector);
          return `- ${connector.id} | ${connector.label} | ${state.ok ? '可用' : `未就绪：${state.reason}`} | 接入方式：${connector.runtime || connector.kind || connector.type}`;
        });
        return succeeded(name, rows.length ? rows.join('\n') : '没有找到匹配的连接器。');
      }
      if (name === 'prepare_connector') {
        const connector = (context.connectors || []).find((item) => connectorMatches(item, args.preset));
        if (!connector) return failed(name, '没有找到连接器预设');
        const state = connectorConfigured(connector);
        return state.ok
          ? succeeded(name, `${connector.label}配置已就绪，请继续调用 test_connector 验证。`)
          : failed(name, `${connector.label}还需要用户配置：${state.reason}。当前任务已保留，等待用户在连接器页完成设置。`, { awaitingUser: true });
      }
      if (name === 'test_connector') {
        const connector = (context.connectors || []).find((item) => connectorMatches(item, args.connector));
        if (!connector) return failed(name, '没有找到已保存的连接器');
        const state = connectorConfigured(connector);
        if (!state.ok) return failed(name, `${connector.label}未就绪：${state.reason}`, { awaitingUser: true });
        if (connector.kind === 'obsidian') {
          const result = await options.testObsidianVault(connector.localPath);
          return result.ok ? succeeded(name, `${connector.label}连接成功，可读取 ${result.noteCount || 0} 篇笔记。`, connectionEvidence(connector, 'test', true)) : failed(name, result.error || '验证失败');
        }
        if (connector.kind === 'knowledge-url') {
          const result = await options.fetchKnowledgeUrl(connector.baseUrl, { fetchImpl: options.fetchImpl });
          return result.ok ? succeeded(name, `${connector.label}连接成功。`, connectionEvidence(connector, 'test', true)) : failed(name, result.error || '验证失败');
        }
        if (connector.kind === 'skill-bridge' && options.verifyConnectorAdapter) {
          const adapter = connector.adapter
            || connector.preset
            || (connector.mcpServerName === 'ima-skill' ? 'ima' : connector.id);
          const result = await options.verifyConnectorAdapter({ adapter, credentials: connector.credentials }, { fetchImpl: options.fetchImpl });
          return result.ok ? succeeded(name, `${connector.label}连接成功。`, connectionEvidence(connector, 'test', true)) : failed(name, result.error || `失败于 ${result.stage || '验证'}`);
        }
        if (connector.baseUrl) {
          const response = await options.fetchImpl(connector.baseUrl, { method: 'GET', headers: authHeaders(connector) });
          return response.ok ? succeeded(name, `${connector.label}连接成功（HTTP ${response.status}）。`, connectionEvidence(connector, 'test', true)) : failed(name, `${connector.label}返回 HTTP ${response.status}`);
        }
        return connector.status === 'connected' ? succeeded(name, `${connector.label}已有可用验证记录。`, connectionEvidence(connector, 'test', true)) : failed(name, connector.error || '连接器尚未验证');
      }
      if (name === 'submit_review') {
        const decision = String(args.decision || '').toUpperCase();
        const reason = String(args.reason || '').trim().slice(0, 1200);
        if (!['PASS', 'REJECT'].includes(decision) || !reason) return failed(name, '审查必须包含 PASS/REJECT 和具体理由');
        const review = { decision: decision === 'PASS' ? 'pass' : 'reject', reason,
          responsibleStepId: String(args.responsibleStepId || '').trim() || undefined,
          responsibleEmployeeId: String(args.responsibleEmployeeId || '').trim() || undefined,
          checkedArtifacts: Array.isArray(args.checkedArtifacts) ? args.checkedArtifacts.map(String).slice(0, 20) : [], submittedAt: Date.now() };
        return succeeded(name, decision === 'PASS' ? `结构化审查已通过：${reason}` : `结构化审查已退回：${reason}`, { review });
      }
      if (name === 'run_command') {
        const command = String(args.cmd || '').trim();
        if (!command) return failed(name, '命令不能为空');
        if (isSkillHubCliCommand(command)) return failed(name, 'SkillHub CLI 路线已停用：Windows 的 skillhub.bat 可能依赖不可用的 python3。请直接调用客户端原生 install_skill，安装不依赖终端命令。');
        if (containsSensitiveLiteral(command)) return failed(name, '命令中包含疑似明文密钥、Token 或密码，已拒绝执行。请改用连接器凭据或受限环境变量。');
        const policy = context.executionPolicy || {};
        if (policy.approvalMode === 'ask' || (policy.approvalMode !== 'full' && !isRoutineCommand(command))) {
          return failed(name, `等待用户批准命令：${command.slice(0, 500)}`, { awaitingApproval: true });
        }
        const before = await listWorkspace(context);
        const result = await options.runCommand({ cmd: command, scope: context.workspaceId || context.scope, sandboxEnabled: policy.sandboxEnabled !== false });
        const after = await listWorkspace(context);
        const previous = new Map(before.map((item) => [item.path, `${item.size}:${item.modifiedAt}`]));
        const artifacts = after.filter((item) => previous.get(item.path) !== `${item.size}:${item.modifiedAt}`).map((item) => ({
          path: item.path, filename: path.basename(item.path), workspaceId: context.workspaceId, diskPath: path.join(taskRoot(context), item.path), bytes: item.size,
          category: 'working', persistence: 'disk', verification: 'write_ack', verified: true, recordedAt: Date.now(),
        }));
        const output = [`退出码：${result.exitCode}`, result.stdout && `stdout:\n${result.stdout}`, result.stderr && `stderr:\n${result.stderr}`].filter(Boolean).join('\n\n');
        return result.success ? succeeded(name, output, { command: { exitCode: result.exitCode, verified: true }, artifacts }) : failed(name, output || '命令执行失败');
      }
      return failed(name, `主进程还没有注册工具：${name}`);
    } catch (error) {
      return failed(name, error?.message || String(error));
    }
  }

  return { definitions: NATIVE_TOOL_DEFINITIONS, execute, listWorkspace, redact };
}

function connectionEvidence(connector, action, ok) {
  return { connection: { connectorId: connector.id, connectorLabel: connector.label, action, ok, verified: ok, checkedAt: Date.now() } };
}
function isSkillHubCliCommand(command) { return /(?:^|[;&|]\s*)skillhub(?:\.bat)?\s+(?:install|update)\b/iu.test(String(command || '').trim()); }
function succeeded(name, output, structuredEvidence) { return { name, success: true, output: String(output || ''), structuredEvidence }; }
function failed(name, output, metadata) { return { name, success: false, output: String(output || ''), ...metadata }; }

module.exports = { NATIVE_TOOL_DEFINITIONS, createNativeToolRuntime, redact, isRoutineCommand, containsSensitiveLiteral, isSkillHubCliCommand };
