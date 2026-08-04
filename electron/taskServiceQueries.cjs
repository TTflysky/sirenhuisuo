const { buildTaskObservability } = require('./executionObservability.cjs');

const ACTIVE_STATUSES = new Set(['queued', 'running', 'awaiting_user', 'paused']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function taskTreeNode(task, depth, children) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const compensation = Array.isArray(task.compensation) ? task.compensation : [];
  return {
    id: task.id,
    parentTaskId: task.parentTaskId,
    depth,
    taskType: task.taskType,
    title: text(task.title || task.goal, 240),
    status: task.status,
    phase: task.phase,
    blocked: text(task.handoff?.blocked || task.waitingFor || task.lastError, 1200) || undefined,
    nextAction: text(task.handoff?.nextAction, 1200) || undefined,
    childTaskIds: children.map((child) => child.id),
    steps: {
      total: steps.length,
      completed: steps.filter((step) => step.status === 'completed').length,
      failed: steps.filter((step) => step.status === 'failed').length,
      active: steps.filter((step) => ['running', 'queued', 'paused'].includes(step.status)).length,
    },
    artifacts: {
      verified: (task.artifacts || []).filter((artifact) => artifact.verified === true).length,
      final: (task.artifacts || []).filter((artifact) => artifact.category === 'final' && artifact.verified === true).length,
    },
    compensation: {
      completed: compensation.filter((item) => item.status === 'completed' || item.status === 'already_completed').length,
      blocked: compensation.filter((item) => item.status === 'blocked' || item.status === 'missing').length,
      failed: compensation.filter((item) => item.status === 'failed').length,
    },
    updatedAt: task.updatedAt,
  };
}

function createTaskServiceQueries(store) {
  async function metrics(taskId) {
    const snapshot = await store.read({ taskId });
    if (!snapshot.ok || !snapshot.runs?.[0]) throw new Error(snapshot.error || `找不到任务：${taskId}`);
    const task = snapshot.runs[0];
    const attempts = task.toolAttempts || [];
    const failures = attempts.filter((item) => item.status === 'failed');
    const startedAt = Number(task.startedAt || task.createdAt) || Date.now();
    const endedAt = Number(task.completedAt || task.updatedAt) || startedAt;
    return {
      ok: true,
      taskId,
      status: task.status,
      durationMs: Math.max(0, endedAt - startedAt),
      active: ACTIVE_STATUSES.has(task.status),
      steps: { total: task.steps?.length || 0, completed: (task.steps || []).filter((step) => step.status === 'completed').length, failed: (task.steps || []).filter((step) => step.status === 'failed').length },
      compensation: {
        total: (task.compensation || []).length,
        completed: (task.compensation || []).filter((item) => item.status === 'completed' || item.status === 'already_completed').length,
        blocked: (task.compensation || []).filter((item) => item.status === 'blocked' || item.status === 'missing').length,
        failed: (task.compensation || []).filter((item) => item.status === 'failed').length,
      },
      tools: {
        total: attempts.length,
        succeeded: attempts.filter((item) => item.status === 'succeeded').length,
        failed: failures.length,
        byErrorClass: Object.fromEntries([...new Set(failures.map((item) => item.errorClass || 'unknown'))]
          .map((key) => [key, failures.filter((item) => (item.errorClass || 'unknown') === key).length])),
      },
      artifacts: { total: task.artifacts?.length || 0, verified: (task.artifacts || []).filter((item) => item.verified).length, final: (task.artifacts || []).filter((item) => item.category === 'final').length },
      usage: clone(task.usage || {}),
      approvals: { total: task.approvals?.length || 0, pending: (task.approvals || []).filter((item) => item.status === 'pending').length },
      observability: buildTaskObservability(task),
      integrity: snapshot.integrity,
    };
  }

  async function tree(taskId) {
    const rootId = text(taskId, 180);
    if (!rootId) throw new Error('TaskService: taskId is required');
    const snapshot = await store.read();
    if (!snapshot.ok) throw new Error(snapshot.error || '无法读取任务账本');
    const root = (snapshot.runs || []).find((task) => task.id === rootId);
    if (!root) throw new Error(`找不到任务：${rootId}`);
    const byParent = new Map();
    for (const task of snapshot.runs || []) {
      if (!task.parentTaskId) continue;
      const children = byParent.get(task.parentTaskId) || [];
      children.push(task);
      byParent.set(task.parentTaskId, children);
    }
    const nodes = [];
    const visit = (task, depth) => {
      const children = (byParent.get(task.id) || []).sort((left, right) => (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0));
      nodes.push(taskTreeNode(task, depth, children));
      children.forEach((child) => visit(child, depth + 1));
    };
    visit(root, 0);
    return {
      ok: true,
      rootTaskId: rootId,
      tree: {
        nodes,
        totals: {
          tasks: nodes.length,
          completed: nodes.filter((node) => node.status === 'completed').length,
          active: nodes.filter((node) => ACTIVE_STATUSES.has(node.status)).length,
          failed: nodes.filter((node) => node.status === 'failed' || node.status === 'stopped').length,
          blocked: nodes.filter((node) => node.blocked || node.compensation.blocked || node.compensation.failed).length,
        },
        generatedAt: Date.now(),
      },
      integrity: snapshot.integrity,
    };
  }

  async function recoveryPlan(taskId) {
    const projection = await tree(taskId);
    const nodes = projection.tree.nodes;
    const root = nodes[0];
    const blockers = nodes.filter((node) => node.status === 'awaiting_user' || node.blocked || node.compensation.blocked || node.compensation.failed)
      .map((node) => ({ taskId: node.id, title: node.title, depth: node.depth, status: node.status, reason: node.blocked || (node.compensation.failed ? '补偿执行失败' : node.compensation.blocked ? '补偿尚未可执行' : '等待用户操作'), nextAction: node.nextAction }));
    const compensationOrder = nodes.filter((node) => node.compensation.blocked || node.compensation.failed)
      .sort((left, right) => right.depth - left.depth || String(left.id).localeCompare(String(right.id)))
      .map((node) => ({ taskId: node.id, title: node.title, depth: node.depth, action: 'resolve_compensation', reason: node.compensation.failed ? '存在失败的补偿步骤' : '存在受阻的补偿步骤' }));
    const resumable = ['queued', 'paused', 'failed', 'awaiting_user'].includes(root.status) && compensationOrder.length === 0;
    const resumeOrder = resumable
      ? nodes
        .filter((node) => node.id === root.id || ['queued', 'paused', 'failed', 'awaiting_user'].includes(node.status))
        .sort((left, right) => right.depth - left.depth || String(left.id).localeCompare(String(right.id)))
        .map((node) => ({
          taskId: node.id,
          action: node.id === root.id ? 'resume_root' : 'resume_descendant',
          reason: node.id === root.id ? '所有可恢复子任务已先入队，恢复根任务' : '先恢复被父任务依赖的子任务',
        }))
      : [];
    return {
      ok: true,
      taskId: root.id,
      plan: {
        rootTaskId: root.id,
        rootStatus: root.status,
        ready: resumable,
        resumeOrder,
        blockers,
        compensationOrder,
        nextAction: resumable
          ? '可以继续。系统会先恢复可恢复的子任务，再恢复根任务，并从已持久化的未完成步骤继续。'
          : compensationOrder.length
            ? '先按补偿顺序解决最深层的受阻或失败补偿，再重新计算恢复计划。'
            : blockers.length
              ? '先完成列出的授权、配置或业务选择，再重新计算恢复计划。'
              : `根任务当前为 ${root.status}，不需要恢复操作。`,
        generatedAt: Date.now(),
      },
      integrity: projection.integrity,
    };
  }

  return { metrics, tree, recoveryPlan };
}

module.exports = { createTaskServiceQueries };
