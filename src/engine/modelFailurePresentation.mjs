/** Produce a clear next step without exposing transport details to the user. */
export function presentModelFailure(errorType) {
  if (errorType === 'server') {
    return '模型服务暂时不可用（HTTP 5xx）。当前目标、已完成证据和未决问题已经保存；请稍后点击“继续执行”重试，无需重新填写模型。';
  }
  return `模型请求已按“${errorType}”分类恢复，但仍没有返回有效结果。当前目标、已完成证据和未决问题已经保存；请检查模型连接或切换可用模型后继续。`;
}
