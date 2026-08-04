const path = require('path');
const { pathToFileURL } = require('url');

const ACTIVE_STATUSES = new Set(['queued', 'running', 'awaiting_user', 'paused']);
const TERMINAL_STATUSES = new Set(['failed', 'completed', 'stopped']);
let lifecycleEnginePromise;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function appendEvent(task, type, detail, payload = {}) {
  task.serviceEvents = Array.isArray(task.serviceEvents) ? task.serviceEvents : [];
  task.serviceEvents.push({ ts: Date.now(), type, detail: text(detail, 1000), payload: clone(payload) });
  task.serviceEvents = task.serviceEvents.slice(-500);
}

function normalizeLifecycle(input) {
  const lifecycle = input?.lifecycle;
  if (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)) throw new Error('TaskService: lifecycle snapshot is required');
  const sequence = Math.max(0, Number(lifecycle.sequence) || 0);
  const status = text(lifecycle.status, 40) || 'running';
  if (!['running', 'completed', 'waiting_user', 'paused', 'checkpointed', 'stopped', 'failed'].includes(status)) {
    throw new Error(`TaskService: invalid lifecycle status ${status}`);
  }
  return {
    ...clone(lifecycle),
    protocolVersion: Math.max(1, Number(lifecycle.protocolVersion) || 1),
    sequence,
    status,
    phase: text(lifecycle.phase, 80) || status,
    activity: text(lifecycle.activity, 500) || undefined,
    progressAt: Number(lifecycle.progressAt) || Date.now(),
    updatedAt: Number(lifecycle.updatedAt) || Date.now(),
  };
}

async function sanitizeLifecycleInput(input = {}) {
  if (!lifecycleEnginePromise) {
    const projectRoot = path.resolve(__dirname, '..');
    lifecycleEnginePromise = import(pathToFileURL(path.join(projectRoot, 'src/engine/turnLifecycle.mjs')).href);
  }
  const lifecycleEngine = await lifecycleEnginePromise;
  return {
    lifecycle: lifecycleEngine.sanitizeLifecycleValue(input.lifecycle),
    recovery: lifecycleEngine.sanitizeLifecycleValue(input.recovery),
  };
}

function createTaskServiceLifecycleCommands(update, options = {}) {
  const sanitizeInput = options.sanitizeInput || sanitizeLifecycleInput;

  async function recordLifecycle(taskId, input = {}) {
    const safeInput = await sanitizeInput(input);
    const incoming = normalizeLifecycle(safeInput);
    return update(taskId, (task) => {
      const currentSequence = Number(task.turnLifecycle?.sequence) || 0;
      if (task.turnLifecycle && incoming.sequence <= currentSequence) return;
      task.turnLifecycle = incoming;
      if (safeInput.recovery && typeof safeInput.recovery === 'object') task.lifecycleRecovery = clone(safeInput.recovery);
      if (incoming.status === 'waiting_user') {
        task.status = 'awaiting_user';
        task.phase = 'awaiting_user';
        task.waitingFor = text(incoming.exit?.waitingFor || incoming.recovery?.reason, 1200) || task.waitingFor;
      } else if (incoming.status === 'paused' || incoming.status === 'checkpointed') {
        task.status = 'paused';
        task.phase = 'blocked';
        task.waitingFor = undefined;
      } else if (incoming.status === 'stopped') {
        task.status = 'stopped';
        task.phase = 'blocked';
        task.waitingFor = undefined;
      } else if (incoming.status === 'failed') {
        task.status = 'failed';
        task.phase = 'blocked';
        task.waitingFor = undefined;
      }
      const previousType = task.serviceEvents?.at(-1)?.payload?.lifecycleType;
      const lifecycleType = incoming.events?.at(-1)?.type;
      if (lifecycleType && lifecycleType !== previousType) {
        appendEvent(task, 'lifecycle_advanced', incoming.activity || lifecycleType, {
          lifecycleType,
          sequence: incoming.sequence,
          phase: incoming.phase,
          status: incoming.status,
        });
      }
    }, `记录 Turn Lifecycle #${incoming.sequence}`);
  }

  async function heartbeat(taskId, input = {}) {
    const observedAt = Number(input.observedAt) || Date.now();
    const progressAt = Number(input.progressAt) || undefined;
    return update(taskId, (task) => {
      task.heartbeat = {
        state: text(input.state, 80) || 'running',
        detail: text(input.detail, 800) || undefined,
        activity: text(input.activity, 500) || task.heartbeat?.activity || undefined,
        workspaceId: text(input.workspaceId, 800) || undefined,
        observedAt,
        progressAt: progressAt ? Math.max(Number(task.heartbeat?.progressAt) || 0, progressAt) : task.heartbeat?.progressAt,
        leaseExpiresAt: observedAt + 90000,
      };
      if (task.status === 'queued') task.status = 'running';
      appendEvent(task, 'heartbeat', `Execution heartbeat: ${task.heartbeat.state}`, { observedAt, state: task.heartbeat.state });
    }, 'Record task execution heartbeat');
  }

  async function setStatus(taskId, status, detail) {
    if (!ACTIVE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status)) throw new Error(`TaskService: invalid status ${status}`);
    return update(taskId, (task) => {
      task.status = status;
      task.phase = status === 'completed' ? 'completed'
        : status === 'failed' || status === 'stopped' || status === 'paused' ? 'blocked'
          : status === 'awaiting_user' ? 'awaiting_user'
            : status === 'running' ? 'executing' : task.phase || 'preflight';
      if (status !== 'awaiting_user') task.waitingFor = undefined;
      appendEvent(task, `status_${status}`, detail || `任务状态变为 ${status}`);
    }, '更新任务状态');
  }

  return { recordLifecycle, heartbeat, setStatus };
}

module.exports = { createTaskServiceLifecycleCommands, normalizeLifecycle };
