const DATA_URL_RE = /data:[^\s)]+;base64,[A-Za-z0-9+/=]+/giu;
const LONG_ENCODED_RE = /[A-Za-z0-9+/_-]{180,}={0,2}/gu;

/** Keep execution bubbles readable without changing durable task evidence. */
export function cleanExecutionDisplay(value, limit = 1800) {
  let text = String(value ?? '');
  text = text.replace(DATA_URL_RE, '[已省略二进制数据]');
  text = text.replace(LONG_ENCODED_RE, (match) => `[已省略长编码 ${match.length} 字符]`);
  text = text.replace(/\r\n/gu, '\n').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 18))}…[内容已折叠]` : text;
}
