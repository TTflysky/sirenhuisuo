function sanitizeInjectedEnv(input) {
  const safe = {};
  if (!input || typeof input !== 'object') return safe;
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key) || typeof value !== 'string' || value.length > 8192) continue;
    safe[key] = value;
  }
  return safe;
}

function redactInjectedValues(input, env) {
  let text = String(input || '');
  for (const value of Object.values(env || {})) {
    if (typeof value !== 'string' || value.length < 4) continue;
    text = text.split(value).join('[已隐藏的连接器凭据]');
  }
  return text;
}

module.exports = { sanitizeInjectedEnv, redactInjectedValues };
