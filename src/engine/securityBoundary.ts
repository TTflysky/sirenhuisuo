const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|secret|client[_-]?secret|验证码|校验码|密码|密钥|令牌)/iu;
const EXTERNAL_SEND = /(?:^|[_-])(?:send|publish|post|mail|message|notify)(?:$|[_-])|发送|发布|投稿|邮件/iu;
const DELETION = /(?:^|[_-])(?:delete|remove|destroy|purge)(?:$|[_-])|删除|清空|销毁/iu;
const PAYMENT = /pay(?:ment)?|purchase|checkout|billing|charge|付款|支付|购买|扣费|充值/iu;

function redactValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[已隐藏的敏感信息]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/giu, 'Bearer [已隐藏]')
    .replace(/((?:api[_-]?key|token|password|secret|验证码|密码|密钥)\s*[:=：]\s*)[^\s,;，；}]{4,}/giu, '$1[已隐藏]');
}

export function redactToolArguments(raw: string): string {
  try { return JSON.stringify(redactValue(JSON.parse(raw))); }
  catch { return String(redactValue(raw)); }
}

export function redactToolArgsObject(args: Record<string, string>): string {
  return JSON.stringify(redactValue(args), null, 2);
}

export function containsInlineSecret(value: string): boolean {
  return /\bBearer\s+[A-Za-z0-9._~+/-]{8,}|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s'";]{6,}/iu.test(value);
}

export function classifySensitiveAction(name: string, args: Record<string, string>): string[] {
  const serialized = `${name}\n${Object.keys(args).join('\n')}\n${Object.values(args).join('\n')}`;
  const risks: string[] = [];
  if (DELETION.test(serialized)) risks.push('删除或清空数据');
  if (PAYMENT.test(serialized)) risks.push('付款、购买或产生费用');
  if (EXTERNAL_SEND.test(serialized)) risks.push('向外部发送或发布内容');
  if (Object.keys(args).some((key) => SECRET_KEY.test(key)) || /验证码|密码|密钥|令牌/u.test(serialized)) risks.push('使用密码、验证码或凭据');
  return [...new Set(risks)];
}
