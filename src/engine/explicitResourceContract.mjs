import {
  assessResourceCompletion,
  buildResourceGuidance,
  createWebContentContract,
  extractWebUrls,
  isWebContentTransformation,
  normalizeWebUrl,
  resourceContractProgress,
  validateResourceToolCall,
} from './resourceContract.mjs';

export const normalizeExplicitUrl = normalizeWebUrl;
export const extractExplicitUrls = extractWebUrls;
export const isExplicitWebContentRequest = isWebContentTransformation;

export function createExplicitResourceContract(goal, supplementalUrls = []) {
  const contract = createWebContentContract(goal, supplementalUrls);
  if (!contract) return undefined;
  return {
    ...contract,
    kind: 'web-content',
    urls: contract.resources.map((resource) => resource.locator),
    requiredTool: 'read_web_page',
  };
}

export function explicitResourceProgress(contract, callLog = []) {
  const progress = resourceContractProgress(contract, callLog);
  const locator = (id) => contract?.resources?.find((resource) => resource.id === id)?.locator ?? id;
  return {
    attemptedUrls: (progress.attempted ?? []).map(locator),
    succeededUrls: (progress.succeeded ?? []).map(locator),
    failedUrls: (progress.failed ?? []).map(locator),
    complete: progress.complete,
  };
}

export function validateExplicitResourceToolCall(contract, toolName, argumentsValue, callLog = []) {
  const result = validateResourceToolCall(contract, toolName, argumentsValue, callLog);
  if (!result.allowed && toolName === 'read_web_page' && !String(argumentsValue?.url ?? '').trim()) {
    return { allowed: false, reason: '读取指定网页时缺少有效 url，必须使用用户提供的原始地址。' };
  }
  return result;
}

export function assessExplicitResourceCompletion(contract, callLog = []) {
  const result = assessResourceCompletion(contract, callLog);
  return { ...result, progress: explicitResourceProgress(contract, callLog) };
}

export function buildExplicitResourceGuidance(contract) {
  return buildResourceGuidance(contract).replace('与资源类型匹配的读取工具', 'read_web_page');
}
