export function prepareChatRequestTurns(turns = [], options = {}) {
  const userContext = String(options.userContext ?? '').trim();
  const extraSystemContext = String(options.extraSystemContext ?? '').trim();
  let finalTurns = turns.map((turn) => ({ ...turn }));

  if (userContext || extraSystemContext) {
    const systemIndex = finalTurns.findIndex((turn) => turn.role === 'system');
    let addition = '';
    if (extraSystemContext) addition += `## 扩展上下文\n${extraSystemContext.slice(0, 160000)}`;
    if (userContext) {
      addition += `${addition ? '\n\n' : ''}## 关于当前用户\n${userContext}\n（用户画像是用户主动确认的高优先级事实；长期记忆已经过筛选。不要自行声称“已记录”，记忆写入由独立提炼流程负责。）`;
    }
    if (systemIndex >= 0) {
      const current = typeof finalTurns[systemIndex].content === 'string' ? finalTurns[systemIndex].content : '';
      finalTurns[systemIndex] = { ...finalTurns[systemIndex], content: `${current}${current ? '\n\n' : ''}${addition}` };
    } else if (addition) {
      finalTurns.unshift({ role: 'system', content: addition });
    }
  }

  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  if (attachments.length > 0) {
    const lastUserIndex = finalTurns.map((turn) => turn.role).lastIndexOf('user');
    if (lastUserIndex >= 0) {
      const turn = finalTurns[lastUserIndex];
      const imageParts = attachments
        .filter((attachment) => attachment?.kind === 'image' && attachment.dataUrl)
        .map((attachment) => ({ type: 'image_url', image_url: { url: attachment.dataUrl } }));
      if (imageParts.length > 0) {
        const textPart = { type: 'text', text: typeof turn.content === 'string' ? turn.content : '' };
        finalTurns[lastUserIndex] = { ...turn, content: [textPart, ...imageParts] };
      }
    }
  }

  return finalTurns;
}
