const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const WORKER_PROTOCOL_VERSION = 1;
const COMMAND_RECORD_VERSION = 1;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_SWEEP_MS = 10_000;
const COMMAND_TYPES = new Set(['claim', 'heartbeat', 'release', 'pause', 'resume', 'stop', 'close']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stableValue(value[key])]));
}

function recordHash(record) {
  const copy = { ...record };
  delete copy.hash;
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(copy))).digest('hex');
}

function isActiveLease(worker) {
  return worker?.state === 'leased' || worker?.state === 'running';
}

function normalizeCommand(input, sessionId) {
  const type = String(input?.type || '');
  const taskId = String(input?.taskId || '');
  if (!COMMAND_TYPES.has(type)) throw new Error(`未知 Worker 命令：${type || '空'}`);
  if (!taskId) throw new Error('Worker 命令缺少 taskId');
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    commandId: String(input.commandId || `task-command-${Date.now()}-${crypto.randomUUID()}`),
    taskId,
    type,
    requestedAt: Number(input.requestedAt) || Date.now(),
    requestedBy: String(input.requestedBy || 'renderer').slice(0, 80),
    sessionId: String(input.sessionId || sessionId).slice(0, 160),
    payload: clone(input.payload ?? {}),
  };
}

function createTaskWorker(options) {
  const rootDir = options.rootDir;
  const store = options.store;
  const sessionId = String(options.sessionId || 'main-process');
  const leaseMs = Math.max(5_000, Number(options.leaseMs) || DEFAULT_LEASE_MS);
  const sweepMs = Math.max(1_000, Number(options.sweepMs) || DEFAULT_SWEEP_MS);
  const journalPath = path.join(rootDir, 'task-commands.jsonl');
  let queue = Promise.resolve();
  let initialized = false;
  let initializationPromise;
  let records = [];
  let head = { sequence: 0, hash: '' };
  let recovered = false;
  let corruptPath;
  let sweepTimer;
  const pending = new Map();
  const results = new Map();

  function emit(event) {
    try { options.onChanged?.(clone(event)); } catch {}
  }

  function enqueue(work) {
    const operation = queue.then(work);
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  function makeRecord(type, command, result) {
    const base = {
      recordVersion: COMMAND_RECORD_VERSION,
      sequence: head.sequence + 1,
      recordId: `worker-record-${head.sequence + 1}-${crypto.randomUUID()}`,
      occurredAt: Date.now(),
      type,
      commandId: command.commandId,
      taskId: command.taskId,
      commandType: command.type,
      ...(type === 'command_submitted' ? { command: clone(command) } : {}),
      ...(result ? { result: clone(result) } : {}),
      previousHash: head.hash,
    };
    return { ...base, hash: recordHash(base) };
  }

  async function appendRecord(type, command, result) {
    const record = makeRecord(type, command, result);
    await fs.mkdir(rootDir, { recursive: true });
    await fs.appendFile(journalPath, `${JSON.stringify(record)}\n`, 'utf8');
    records.push(record);
    head = { sequence: record.sequence, hash: record.hash };
    if (type === 'command_submitted') pending.set(command.commandId, command);
    else {
      pending.delete(command.commandId);
      results.set(command.commandId, result);
    }
    return record;
  }

  async function initializeOnce() {
    await fs.mkdir(rootDir, { recursive: true });
    let raw = '';
    try { raw = await fs.readFile(journalPath, 'utf8'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
    const validLines = [];
    let previousHash = '';
    let previousSequence = 0;
    let invalidIndex = -1;
    for (let index = 0; index < lines.length; index += 1) {
      try {
        const record = JSON.parse(lines[index]);
        if (record.recordVersion !== COMMAND_RECORD_VERSION || record.sequence !== previousSequence + 1) throw new Error('命令记录序号无效');
        if (record.previousHash !== previousHash || record.hash !== recordHash(record)) throw new Error('命令记录哈希无效');
        records.push(record);
        validLines.push(lines[index]);
        previousSequence = record.sequence;
        previousHash = record.hash;
        if (record.type === 'command_submitted') pending.set(record.commandId, record.command);
        else if (record.type === 'command_completed' || record.type === 'command_failed') {
          pending.delete(record.commandId);
          results.set(record.commandId, record.result);
        } else throw new Error('命令记录类型无效');
      } catch {
        invalidIndex = index;
        break;
      }
    }
    head = { sequence: previousSequence, hash: previousHash };
    if (invalidIndex >= 0) {
      const invalidLines = lines.slice(invalidIndex);
      corruptPath = path.join(rootDir, `task-commands-corrupt-${Date.now()}.jsonl`);
      await fs.writeFile(corruptPath, invalidLines.join('\n'), 'utf8');
      await fs.writeFile(journalPath, validLines.length ? `${validLines.join('\n')}\n` : '', 'utf8');
      recovered = true;
    }
    initialized = true;
  }

  async function initialize() {
    if (initialized) return;
    if (!initializationPromise) {
      initializationPromise = initializeOnce().catch((error) => {
        initializationPromise = undefined;
        throw error;
      });
    }
    await initializationPromise;
  }

  async function currentRun(taskId) {
    const snapshot = await store.read();
    if (!snapshot.ok) throw new Error(snapshot.error || '读取任务投影失败');
    return snapshot.runs.find((run) => run.id === taskId);
  }

  function commandMetadata(command, detail) {
    return {
      source: 'task-worker',
      sessionId,
      detail,
      command: {
        protocolVersion: command.protocolVersion,
        commandId: command.commandId,
        type: command.type,
        requestedAt: command.requestedAt,
        requestedBy: command.requestedBy,
      },
    };
  }

  async function executeCommand(command) {
    const existing = await currentRun(command.taskId);
    if (!existing) {
      if (command.type === 'close') return { ok: true, taskId: command.taskId, commandId: command.commandId, type: command.type, removed: true };
      throw new Error(`找不到任务：${command.taskId}`);
    }
    if (existing.worker?.lastCommandId === command.commandId) {
      return { ok: true, taskId: command.taskId, commandId: command.commandId, type: command.type, run: existing, idempotencyHit: true };
    }
    const now = Date.now();
    if (command.type === 'close') {
      const removed = await store.removeTask(command.taskId, commandMetadata(command, `Worker 已关闭任务：${existing.title || existing.id}`));
      if (!removed.ok) throw new Error(removed.error);
      return { ok: true, taskId: command.taskId, commandId: command.commandId, type: command.type, removed: true, events: removed.events };
    }
    const detailByType = {
      claim: 'Worker 已领取任务并建立执行租约',
      heartbeat: 'Worker 执行租约心跳已更新',
      release: 'Worker 已释放任务执行租约',
      pause: 'Worker 已暂停任务并保留当前进度',
      resume: 'Worker 已将任务恢复到待执行队列',
      stop: 'Worker 已停止任务',
    };
    const result = await store.updateTask(command.taskId, (run) => {
      const worker = run.worker ?? { protocolVersion: WORKER_PROTOCOL_VERSION, state: 'idle', adapter: 'renderer-team-discussion' };
      if (command.type === 'claim') {
        if (!['queued', 'running', 'paused'].includes(run.status)) throw new Error(`任务状态 ${run.status} 不能领取执行租约`);
        if (isActiveLease(worker) && worker.ownerSessionId !== command.sessionId && Number(worker.expiresAt) > now) {
          throw new Error('任务已被另一个执行会话领取');
        }
        const leaseId = String(command.payload.leaseId || `task-lease-${crypto.randomUUID()}`);
        run.status = 'running';
        run.phase = 'executing';
        run.executionSessionId = command.sessionId;
        run.worker = {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          state: 'running',
          adapter: String(command.payload.adapter || 'renderer-team-discussion').slice(0, 80),
          leaseId,
          ownerSessionId: command.sessionId,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt: now + leaseMs,
          lastCommandId: command.commandId,
        };
        if (run.recoveryContext) {
          run.recoveryContext.summary = '后台 Worker 已领取任务，正在执行。';
          run.recoveryContext.interruptedAt = undefined;
          run.recoveryContext.interruptionReason = undefined;
        }
        return;
      }
      if (command.type === 'heartbeat') {
        if (!isActiveLease(worker) || worker.leaseId !== command.payload.leaseId) throw new Error('Worker 心跳租约不匹配');
        run.worker = { ...worker, state: 'running', heartbeatAt: now, expiresAt: now + leaseMs, lastCommandId: command.commandId };
        return;
      }
      if (command.type === 'release') {
        if (isActiveLease(worker) && command.payload.leaseId && worker.leaseId !== command.payload.leaseId) throw new Error('Worker 释放租约不匹配');
        run.worker = { ...worker, state: 'released', heartbeatAt: now, releasedAt: now, expiresAt: undefined, lastCommandId: command.commandId };
        return;
      }
      if (command.type === 'pause') {
        run.status = 'paused';
        run.phase = 'blocked';
        run.steps.forEach((step) => {
          if (step.status === 'queued' || step.status === 'running') {
            step.status = 'paused';
            step.events.push({ ts: now, type: 'status', detail: 'Worker 已暂停任务' });
          }
        });
        run.worker = { ...worker, state: 'paused', releasedAt: now, expiresAt: undefined, lastCommandId: command.commandId };
        if (run.recoveryContext) run.recoveryContext.summary = '任务已暂停，工作区和上下文均已保留。';
        return;
      }
      if (command.type === 'resume') {
        if (!['paused', 'failed'].includes(run.status)) throw new Error(`任务状态 ${run.status} 不能恢复`);
        run.status = 'queued';
        run.phase = 'preflight';
        run.lastError = undefined;
        run.handoff = undefined;
        run.steps.forEach((step) => { if (step.status === 'paused' || step.status === 'failed') step.status = 'queued'; });
        run.worker = { ...worker, state: 'idle', leaseId: undefined, ownerSessionId: undefined, expiresAt: undefined, releasedAt: now, lastCommandId: command.commandId };
        if (run.recoveryContext) {
          run.recoveryContext.summary = 'Worker 已接收继续命令，等待执行适配器领取任务。';
          run.recoveryContext.interruptedAt = undefined;
          run.recoveryContext.interruptionReason = undefined;
        }
        return;
      }
      if (command.type === 'stop') {
        run.status = 'stopped';
        run.phase = 'blocked';
        run.lastError = undefined;
        run.steps.forEach((step) => {
          if (step.status === 'queued' || step.status === 'running' || step.status === 'paused') {
            step.status = 'stopped';
            step.events.push({ ts: now, type: 'status', detail: 'Worker 已停止任务' });
          }
        });
        run.worker = { ...worker, state: 'stopped', releasedAt: now, expiresAt: undefined, lastCommandId: command.commandId };
        run.handoff = {
          ts: now,
          completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
          blocked: '任务已由用户停止。',
          nextAction: '已完成内容会保留；需要继续时请重新发起任务。',
        };
      }
    }, commandMetadata(command, detailByType[command.type]));
    if (!result.ok) throw new Error(result.error);
    return { ok: true, taskId: command.taskId, commandId: command.commandId, type: command.type, run: result.run, events: result.events };
  }

  async function applySubmitted(command) {
    try {
      const result = await executeCommand(command);
      await appendRecord('command_completed', command, {
        ok: true, taskId: command.taskId, commandId: command.commandId, type: command.type,
        status: result.run?.status, leaseId: result.run?.worker?.leaseId, removed: result.removed, idempotencyHit: result.idempotencyHit,
      });
      emit({ kind: 'command_completed', command, result });
      return result;
    } catch (error) {
      const result = { ok: false, taskId: command.taskId, commandId: command.commandId, type: command.type, error: error?.message ?? String(error) };
      await appendRecord('command_failed', command, result);
      emit({ kind: 'command_failed', command, result });
      return result;
    }
  }

  async function recoverExpiredLeases() {
    const snapshot = await store.read();
    if (!snapshot.ok) return [];
    const recoveredTasks = [];
    const now = Date.now();
    for (const run of snapshot.runs) {
      if (!isActiveLease(run.worker)) continue;
      const foreignSession = run.worker.ownerSessionId && run.worker.ownerSessionId !== sessionId;
      const expired = Number(run.worker.expiresAt) <= now;
      if (!foreignSession && !expired) continue;
      const result = await store.updateTask(run.id, (next) => {
        if (!isActiveLease(next.worker)) return;
        next.status = 'paused';
        next.phase = 'blocked';
        next.steps.forEach((step) => {
          if (step.status === 'running' || step.status === 'queued') {
            step.status = 'paused';
            step.events.push({ ts: now, type: 'error', detail: 'Worker 租约失效，步骤已安全暂停' });
          }
        });
        next.worker = { ...next.worker, state: 'expired', expiredAt: now, expiresAt: undefined };
        if (next.recoveryContext) {
          next.recoveryContext.summary = '后台 Worker 租约已失效，任务已安全暂停。';
          next.recoveryContext.interruptedAt = now;
          next.recoveryContext.interruptionReason = foreignSession ? '客户端进程已更换' : 'Worker 心跳超时';
        }
        next.handoff = {
          ts: now,
          completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title),
          blocked: '后台 Worker 执行租约失效，任务没有继续跳步。',
          nextAction: '检查模型和工作区后点击“继续执行”。',
        };
      }, { source: 'task-worker', sessionId, detail: foreignSession ? 'Worker 检测到旧执行会话并安全回收' : 'Worker 心跳超时并安全回收' });
      if (result.ok && !result.unchanged) {
        recoveredTasks.push(run.id);
        emit({ kind: 'lease_recovered', taskId: run.id, run: result.run });
      }
    }
    return recoveredTasks;
  }

  async function start() {
    return enqueue(async () => {
      await initialize();
      for (const command of [...pending.values()]) await applySubmitted(command);
      const recoveredTasks = await recoverExpiredLeases();
      if (!sweepTimer) {
        sweepTimer = setInterval(() => { void enqueue(recoverExpiredLeases); }, sweepMs);
      }
      return { ok: true, recoveredTasks, pendingCommands: pending.size };
    });
  }

  function dispatch(input) {
    return enqueue(async () => {
      await initialize();
      let command;
      try { command = normalizeCommand(input, sessionId); }
      catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
      if (results.has(command.commandId)) return { ...clone(results.get(command.commandId)), idempotencyHit: true };
      if (!pending.has(command.commandId)) await appendRecord('command_submitted', command);
      return applySubmitted(command);
    });
  }

  function readCommands(options = {}) {
    return enqueue(async () => {
      await initialize();
      const taskId = String(options.taskId || '');
      const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
      return {
        ok: true,
        protocolVersion: WORKER_PROTOCOL_VERSION,
        records: records.filter((record) => !taskId || record.taskId === taskId).slice(-limit).map(clone),
        integrity: { ok: true, recovered, corruptPath, lastSequence: head.sequence, lastHash: head.hash, recordCount: records.length },
      };
    });
  }

  function status() {
    return enqueue(async () => {
      await initialize();
      const snapshot = await store.read();
      const activeRuns = snapshot.ok ? snapshot.runs.filter((run) => isActiveLease(run.worker)).map((run) => ({
        taskId: run.id, status: run.status, worker: clone(run.worker),
      })) : [];
      return {
        ok: true,
        protocolVersion: WORKER_PROTOCOL_VERSION,
        sessionId,
        pendingCommands: pending.size,
        activeRuns,
        integrity: { ok: true, recovered, corruptPath, lastSequence: head.sequence, lastHash: head.hash, recordCount: records.length },
      };
    });
  }

  function stop() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = undefined;
  }

  return { journalPath, start, stop, dispatch, status, readCommands, recoverExpiredLeases };
}

module.exports = {
  WORKER_PROTOCOL_VERSION,
  COMMAND_RECORD_VERSION,
  DEFAULT_LEASE_MS,
  createTaskWorker,
  recordHash,
};
