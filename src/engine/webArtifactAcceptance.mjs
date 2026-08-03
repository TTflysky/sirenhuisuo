function parseArgs(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function createWebArtifactAcceptanceCycle() {
  return { path: '', mutationAfterFailure: false };
}

export function webArtifactAcceptanceGate(state, toolName) {
  if (!state?.path || !state.mutationAfterFailure || toolName === 'verify_web_artifact') return '';
  return `网页产出物已经根据失败证据完成一轮修改。现在必须立即调用 verify_web_artifact 复验 ${state.path}；复验前禁止继续读取、写入或运行其他命令。只有复验仍失败时才能开始下一轮修改。`;
}

export function observeWebArtifactAcceptanceCycle(state, event = {}) {
  const next = { ...createWebArtifactAcceptanceCycle(), ...(state || {}) };
  if (event.name === 'verify_web_artifact' && event.executed) {
    const path = String(parseArgs(event.args).path || next.path || '').trim();
    if (event.success) return createWebArtifactAcceptanceCycle();
    return { path, mutationAfterFailure: false };
  }
  if (!event.success || !next.path) return next;
  if (event.name === 'write_file') {
    const path = String(parseArgs(event.args).path || '').toLowerCase();
    if (/\.(?:html?|css|m?js)$/u.test(path)) return { ...next, mutationAfterFailure: true };
  }
  if (event.name === 'run_command' && /工作区文件已同步到产出物|workspace files? (?:were )?synced/iu.test(String(event.output || ''))) {
    return { ...next, mutationAfterFailure: true };
  }
  return next;
}
