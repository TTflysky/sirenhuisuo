const { ROLE_DUTY } = require('./nativeExecutionPolicy.cjs');

function createNativeExecutionPrompting({ text, clone, inferStepDeliverableType, toolRuntime }) {
  const redact = typeof toolRuntime?.redact === 'function'
    ? toolRuntime.redact.bind(toolRuntime)
    : (value) => value;

  function buildSystem(run, step, member, job, runtimeGuidance = '', advisorGuidance = '') {
    const prior = (run.executionMessages || []).filter((message) => message.kind === 'text').slice(-8)
      .map((message) => `${message.authorName || message.authorId}：${text(message.content, 2000)}`).join('\n\n');
    const dependencies = run.steps.filter((item) => step.dependsOnStepIds.includes(item.id))
      .map((item) => `- ${item.title}：${item.events?.at(-1)?.detail || item.status}`).join('\n');
    const reviewTargets = step.kind === 'review' ? run.steps.filter((item) => item.status === 'completed' && item.kind !== 'review')
      .map((item) => `- 步骤 ${item.id}；员工 ${item.employeeId}；${item.title}`).join('\n') : '';
    return [
      member.prompt || `你是「${member.name}」，${member.title || '团队成员'}。`,
      member.soul,
      ROLE_DUTY[member.role] || ROLE_DUTY.custom,
      '你正在太极主进程原生执行 Adapter 中工作。必须自主判断、调用真实工具、读取结果、更换失败路线并核对验收条件。工具有返回值不等于目标完成。',
      run.workspaceId
        ? '当前任务工作区已经建立。统一工具注册中心会将 write_file、read_file、list_files 和 run_command 绑定到该工作区；尚未产生文件不代表没有入口，必须实际调用工具并报告真实结果。'
        : '当前任务尚未建立工作区。不得声称已经写入或运行文件；需要文件交付时应由执行器先建立工作区或明确报告初始化失败。',
      '只在任务合同要求文件交付时使用 write_file 并校验磁盘文件；回答、连接、操作和决策任务使用各自对应的真实证据。审查步骤必须调用 submit_review。',
      inferStepDeliverableType(step, run) === 'file'
        ? '代码或多文件交付必须分批落盘：每次模型决策只生成一个主要文件或一组很小的紧密相关文件，工具返回后再继续下一个文件。不要在一次模型回复里塞入整套项目；每个关键文件写入后都要读取或运行验证。'
        : '',
      runtimeGuidance,
      advisorGuidance,
      job.compensating ? '当前处于补偿阶段：只执行当前补偿责任以撤销或降低已发生副作用，留下真实工具证据；不要继续原任务或虚构补偿完成。' : '',
      `用户原始目标：\n${run.goal || run.request}`,
      `当前步骤：${step.title}\n责任：${step.assignment}`,
      dependencies && `前置步骤摘要：\n${dependencies}`,
      reviewTargets && `审查可退回的责任步骤：\n${reviewTargets}`,
      prior && `团队最近结构化交接：\n${prior}`,
      job.extraSystemContext,
      job.steering.length ? `用户运行中新增约束（必须与原目标合并）：\n${job.steering.join('\n')}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 80000);
  }

  function buildUserTurn(run, step, job) {
    const prompt = `请直接执行当前步骤，不要只描述计划。\n\n老板原始要求：\n${run.request}\n\n当前责任：\n${step.assignment}`;
    const images = (job.attachments || []).filter((item) => item.kind === 'image' && item.dataUrl).slice(0, 8);
    if (!images.length) return { role: 'user', content: prompt };
    return { role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((item) => ({ type: 'image_url', image_url: { url: item.dataUrl } }))] };
  }

  function completeOutstandingToolMessages(messages, toolCalls, completedIds, reason) {
    for (const pendingCall of toolCalls) {
      const callId = String(pendingCall?.id || '');
      if (!callId || completedIds.has(callId)) continue;
      messages.push({ role: 'tool', tool_call_id: callId, content: `未执行：同一批次中的前置动作已暂停。${text(reason, 500)}` });
      completedIds.add(callId);
    }
  }

  function sanitizedRuntime(runtime) {
    const safe = clone(runtime);
    for (const evidence of safe?.evidence || []) evidence.arguments = redact(evidence.arguments);
    for (const decision of safe?.decisions || []) {
      for (const call of decision.toolCalls || []) call.args = redact(call.args);
    }
    return safe;
  }

  return { buildSystem, buildUserTurn, completeOutstandingToolMessages, sanitizedRuntime };
}

module.exports = { createNativeExecutionPrompting };
