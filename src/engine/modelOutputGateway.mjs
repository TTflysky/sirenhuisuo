export const MODEL_OUTPUT_GATEWAY_VERSION = 1;

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,127}$/u;
const CONTROL_START_PATTERNS = [
  /<\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls>/u,
  /<\uFF5Ctool(?:\u2581|_)calls?(?:\u2581|_)begin\uFF5C>/u,
  /<\uFF5CDSML\uFF5Ctool(?:\u2581|_)calls(?:\u2581|_)begin\uFF5C>/u,
  /<\|DSML\|tool(?:\u2581|_)calls(?:\u2581|_)begin\|>/u,
  /<\|tool(?:_|)calls?(?:_|)begin\|>/u,
  /<tool_calls?>/iu,
  /<function_calls?>/iu,
];

const CONTROL_CLOSING_PATTERNS = [
  /<\uFF5CDSML\uFF5Ctool(?:\u2581|_)calls(?:\u2581|_)end\uFF5C>/u,
  /<\|DSML\|tool(?:\u2581|_)calls(?:\u2581|_)end\|>/u,
  /<\/tool_calls?>/iu,
  /<\/function_calls?>/iu,
];

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text').map((part) => String(part.text ?? '')).join('');
}

function controlStartIndex(content) {
  const indexes = CONTROL_START_PATTERNS
    .map((pattern) => pattern.exec(content)?.index)
    .filter((index) => Number.isInteger(index));
  return indexes.length ? Math.min(...indexes) : -1;
}

function cleanPublicContent(content) {
  const value = textContent(content);
  const index = controlStartIndex(value);
  const cleaned = index >= 0 ? value.slice(0, index) : value;
  return cleaned.replace(/\s+$/u, '').trim() || null;
}

function normalizeArguments(value) {
  if (value === undefined || value === null || value === '') return '{}';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '{}';
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('tool arguments must be a JSON object');
    return JSON.stringify(parsed);
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('tool arguments must be an object');
  return JSON.stringify(value);
}

function normalizeToolCall(raw, index) {
  const name = String(raw?.name || raw?.function?.name || raw?.tool_name || raw?.functionName || '').trim();
  if (!TOOL_NAME_PATTERN.test(name)) return { error: `invalid tool name at index ${index}` };
  try {
    return {
      id: String(raw?.id || raw?.tool_call_id || `gateway-call-${index + 1}`),
      type: 'function',
      function: { name, arguments: normalizeArguments(raw?.arguments ?? raw?.function?.arguments ?? raw?.parameters ?? raw?.args ?? raw?.input) },
    };
  } catch (error) {
    return { error: `${name}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function collectJsonValues(text) {
  const values = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const opening = text[start];
    const closing = opening === '{' ? '}' : ']';
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === opening) depth += 1;
      else if (char === closing) depth -= 1;
      if (depth !== 0) continue;
      try { values.push({ value: JSON.parse(text.slice(start, end + 1)), start, end: end + 1 }); } catch {}
      break;
    }
  }
  return values;
}

function callsFromValue(value) {
  if (Array.isArray(value)) return value.flatMap((item) => callsFromValue(item));
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.tool_calls)) return value.tool_calls.flatMap((item) => callsFromValue(item));
  if (value.tool_call && typeof value.tool_call === 'object') return callsFromValue(value.tool_call);
  if (value.function && typeof value.function === 'object') return [value];
  if (value.name || value.tool_name || value.functionName) return [value];
  return [];
}

function dedupeCalls(calls) {
  const seen = new Set();
  return calls.filter((call) => {
    const key = `${call.id}:${call.function.name}:${call.function.arguments}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseMarkedCalls(content, markerIndex) {
  const body = content.slice(markerIndex);
  const calls = [];
  const errors = [];
  const add = (raw) => {
    const normalized = normalizeToolCall(raw, calls.length);
    if (normalized.error) errors.push(normalized.error);
    else calls.push(normalized);
  };

  const markupPatterns = [
    /<tool_call\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/tool_call>/giu,
    /<\uFF5C(?:DSML\uFF5C)?tool(?:\u2581|_)call(?:s)?(?:\u2581|_)begin\uFF5C>\s*(?:functions?\.)?([a-z][a-z0-9_]{1,127})\s*<\uFF5C(?:DSML\uFF5C)?tool(?:\u2581|_)sep\uFF5C>\s*([\s\S]*?)<\uFF5C(?:DSML\uFF5C)?tool(?:\u2581|_)call(?:s)?(?:\u2581|_)end\uFF5C>/gu,
    /<\|(?:DSML\|)?tool(?:_|)call(?:s?)(?:_|)begin\|>\s*(?:functions?\.)?([a-z][a-z0-9_]{1,127})\s*<\|(?:DSML\|)?tool(?:_|)sep\|>\s*([\s\S]*?)<\|(?:DSML\|)?tool(?:_|)call(?:s?)(?:_|)end\|>/gu,
  ];
  for (const pattern of markupPatterns) {
    for (const match of body.matchAll(pattern)) add({ name: match[1], arguments: match[2] });
  }

  for (const item of collectJsonValues(body)) {
    for (const raw of callsFromValue(item.value)) add(raw);
  }

  const namedArguments = /(?:name|tool_name|function)\s*[:=]\s*["']?([a-z][a-z0-9_]{1,127})["']?[\s\S]{0,160}?(?:arguments|args|parameters)\s*[:=]\s*/giu;
  for (const match of body.matchAll(namedArguments)) {
    const json = collectJsonValues(body.slice(match.index + match[0].length))[0];
    if (json) add({ name: match[1], arguments: json.value });
  }

  return { calls: dedupeCalls(calls), errors };
}

export function normalizeModelMessage(message = {}, options = {}) {
  const rawContent = textContent(message.content);
  const markerIndex = controlStartIndex(rawContent);
  const nativeRawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const nativeCalls = [];
  const errors = [];
  nativeRawCalls.forEach((call, index) => {
    const normalized = normalizeToolCall(call, index);
    if (normalized.error) errors.push(normalized.error);
    else nativeCalls.push(normalized);
  });
  const marked = markerIndex >= 0 ? parseMarkedCalls(rawContent, markerIndex) : { calls: [], errors: [] };
  errors.push(...marked.errors);
  const toolCalls = dedupeCalls([...nativeCalls, ...marked.calls]);
  const protocol = nativeCalls.length ? (markerIndex >= 0 ? 'native+marked' : 'native') : markerIndex >= 0 ? 'marked' : 'text';
  const fatal = markerIndex >= 0 && toolCalls.length === 0;
  const content = cleanPublicContent(rawContent);
  const diagnostics = {
    gatewayVersion: MODEL_OUTPUT_GATEWAY_VERSION,
    protocol,
    controlDetected: markerIndex >= 0,
    parseStatus: fatal ? 'malformed' : 'accepted',
    fatal,
    toolCallCount: toolCalls.length,
    errors: errors.slice(0, 12),
    rawContentLength: rawContent.length,
    toolsEnabled: options.toolsEnabled === true,
  };
  const normalizedMessage = {
    ...message,
    content,
    tool_calls: toolCalls.length ? toolCalls : undefined,
  };
  if (message.reasoning_content !== undefined) normalizedMessage.reasoning_content = message.reasoning_content;
  return { message: normalizedMessage, content, toolCalls, diagnostics };
}

export function createStreamingContentFilter(onTextDelta) {
  let raw = '';
  let emitted = '';
  const flush = (final = false) => {
    const marker = controlStartIndex(raw);
    let safe = marker >= 0 ? raw.slice(0, marker) : raw;
    if (!final && marker < 0) {
      const candidate = raw.lastIndexOf('<');
      if (candidate >= 0 && raw.length - candidate < 96 && !raw.slice(candidate).includes('>')) safe = raw.slice(0, candidate);
    }
    if (safe.startsWith(emitted)) {
      const delta = safe.slice(emitted.length);
      emitted = safe;
      if (delta) onTextDelta?.(delta, emitted);
    }
  };
  return {
    push(delta) { raw += String(delta ?? ''); flush(false); },
    finish() { flush(true); return emitted; },
    get raw() { return raw; },
  };
}

export function hasModelProtocolMarkers(value) {
  return controlStartIndex(textContent(value)) >= 0 || CONTROL_CLOSING_PATTERNS.some((pattern) => pattern.test(textContent(value)));
}
