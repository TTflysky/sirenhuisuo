const fs = require('fs/promises');
const path = require('path');

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_RUNS = 120;

function isTaskRun(value) {
  return value && typeof value === 'object'
    && typeof value.id === 'string'
    && typeof value.teamId === 'string'
    && typeof value.status === 'string'
    && Array.isArray(value.steps);
}

function createTaskRuntimeStore(rootDir, options = {}) {
  const maxRuns = Number.isInteger(options.maxRuns) && options.maxRuns > 0
    ? options.maxRuns
    : DEFAULT_MAX_RUNS;
  const filePath = path.join(rootDir, 'task-runs.json');
  let writeQueue = Promise.resolve();

  async function read() {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.runs)) {
        return { ok: false, exists: true, runs: [], error: '任务快照格式或版本无效' };
      }
      if (!parsed.runs.every(isTaskRun)) {
        return { ok: false, exists: true, runs: [], error: '任务快照包含无效任务记录' };
      }
      return { ok: true, exists: true, schemaVersion: SCHEMA_VERSION, runs: parsed.runs.slice(-maxRuns) };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { ok: true, exists: false, schemaVersion: SCHEMA_VERSION, runs: [] };
      }
      return { ok: false, exists: true, runs: [], error: `读取任务快照失败：${error?.message ?? String(error)}` };
    }
  }

  function write(runs) {
    if (!Array.isArray(runs) || !runs.every(isTaskRun)) {
      return Promise.resolve({ ok: false, error: '任务快照写入内容无效' });
    }
    const nextRuns = runs.slice(-maxRuns);
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(rootDir, { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt: Date.now(), runs: nextRuns }, null, 2);
      try {
        await fs.writeFile(tempPath, payload, 'utf8');
        await fs.rename(tempPath, filePath);
        return { ok: true, schemaVersion: SCHEMA_VERSION, count: nextRuns.length };
      } catch (error) {
        try { await fs.rm(tempPath, { force: true }); } catch {}
        throw error;
      }
    });
    return writeQueue
      .then((result) => result)
      .catch((error) => ({ ok: false, error: `写入任务快照失败：${error?.message ?? String(error)}` }));
  }

  return { filePath, read, write };
}

module.exports = { SCHEMA_VERSION, DEFAULT_MAX_RUNS, createTaskRuntimeStore };
