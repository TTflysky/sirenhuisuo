import {
  classifyTaskTurnIntent,
  createFallbackTaskDecision,
  normalizeTaskDecision,
} from './taskDecisionKernel.mjs';
import { createExplicitResourceContract } from './explicitResourceContract.mjs';
import { resolveSkillInstallRequest } from './skillInstallRouting.mjs';

export const TASK_DECISION_PIPELINE_VERSION = 1;

function text(value, max = 1200) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, max);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value, max = 12) {
  return Array.isArray(value) ? value.map((item) => text(item, 300)).filter(Boolean).slice(0, max) : [];
}

function candidateValue(candidate, key, max = 300) {
  return Object.prototype.hasOwnProperty.call(object(candidate), key)
    ? text(candidate[key], max)
    : '';
}

function reason(stage, code, detail, field) {
  return { stage, code, ...(field ? { field } : {}), detail: text(detail, 320) };
}

function safeHistory(input) {
  return (Array.isArray(input.recentHistory) ? input.recentHistory : []).slice(-8).map((item) => ({
    role: text(item?.role, 30),
    content: text(item?.content, 320),
  }));
}

function compareCandidate(candidate, decision, reasons) {
  if (!candidate || typeof candidate !== 'object') return;
  const candidateMode = candidateValue(candidate, 'mode', 40);
  if (candidateMode && candidateMode !== decision.mode) {
    reasons.push(reason('understanding', 'mode_guard', `Model mode '${candidateMode}' was normalized to '${decision.mode}'.`, 'mode'));
  }
  const candidateRelation = candidateValue(candidate, 'turnRelation', 40);
  if (candidateRelation && candidateRelation !== decision.turnRelation) {
    reasons.push(reason('context', 'relation_guard', `Model relation '${candidateRelation}' was normalized to '${decision.turnRelation}'.`, 'turnRelation'));
  }
  const candidateGoal = candidateValue(candidate, 'goal', 800);
  if (candidateGoal && candidateGoal !== decision.goal) {
    reasons.push(reason('understanding', 'authoritative_goal', 'The latest user goal was preserved by the runtime authority.', 'goal'));
  }
  const candidateRoute = candidateValue(candidate, 'primaryRoute', 80);
  if (candidateRoute && candidateRoute !== decision.primaryRoute) {
    reasons.push(reason('plan', 'route_guard', `Model route '${candidateRoute}' was normalized to '${decision.primaryRoute}'.`, 'primaryRoute'));
  }
  if (candidate.needsUser === true && decision.needsUser === false) {
    reasons.push(reason('governance', 'missing_input_guard', 'The model proposed waiting for the user without a verified user-owned prerequisite.', 'needsUser'));
  }
  if (candidate.requiresEvidence === false && decision.requiresEvidence === true) {
    reasons.push(reason('governance', 'evidence_guard', 'The runtime retained evidence requirements implied by the route or goal.', 'requiresEvidence'));
  }
  if (candidate.searchQuery && !decision.searchQuery) {
    reasons.push(reason('plan', 'query_guard', 'A model search query was discarded because the selected route does not authorize broad search.', 'searchQuery'));
  }
}

function modelFailureReason(options = {}) {
  const failureClass = text(options.modelFailure?.failureClass ?? options.modelFailureClass, 80);
  if (!failureClass) return undefined;
  return reason('understanding', 'model_unavailable', `Decision model unavailable; deterministic fallback used (${failureClass}).`);
}

/**
 * Build a persisted, user-safe audit of the four decision layers. This is a
 * record of inputs, accepted outputs, and guard rejections, not hidden chain
 * of thought.
 */
export function buildTaskDecisionAudit(input = {}, decision, options = {}) {
  const fallback = options.fallback ?? createFallbackTaskDecision(input);
  const selected = decision ?? fallback;
  const candidate = options.candidate;
  const reasons = [];
  const failure = modelFailureReason(options);
  if (failure) reasons.push(failure);
  compareCandidate(candidate, selected, reasons);

  const latestMessage = text(input.latestMessage, 4000);
  const activeTaskGoal = text(input.activeTaskGoal, 1600);
  const explicitResource = createExplicitResourceContract(fallback.goal);
  const skillInstall = resolveSkillInstallRequest(fallback.goal);
  const contextReasons = reasons.filter((item) => item.stage === 'context');
  const governanceReasons = reasons.filter((item) => item.stage === 'governance');
  const understandingReasons = reasons.filter((item) => item.stage === 'understanding');
  const planReasons = reasons.filter((item) => item.stage === 'plan');

  return {
    version: TASK_DECISION_PIPELINE_VERSION,
    generatedAt: Number.isFinite(options.generatedAt) ? options.generatedAt : Date.now(),
    layers: {
      understanding: {
        input: {
          latestMessage,
          previousUserMessage: text(input.previousUserMessage, 1600),
          attachmentCount: Array.isArray(input.attachments) ? input.attachments.length : 0,
        },
        result: {
          goal: text(selected.goal, 1600),
          turnIntent: classifyTaskTurnIntent(latestMessage),
          mode: selected.mode,
          confidence: selected.confidence,
        },
        rejectedReasons: understandingReasons,
      },
      context: {
        input: {
          activeTaskGoal,
          previousUserMessage: text(input.previousUserMessage, 1600),
          recentHistory: safeHistory(input),
          availableTools: list(input.availableTools, 40),
        },
        result: {
          relation: selected.turnRelation,
          independentGoal: selected.turnRelation === 'new_task',
          correction: selected.turnRelation === 'correction',
          control: selected.turnRelation === 'control',
        },
        rejectedReasons: contextReasons,
      },
      governance: {
        input: {
          explicitResource: explicitResource ? {
            url: text(explicitResource.urls?.[0], 1000),
            kind: text(explicitResource.kind, 80),
          } : undefined,
          explicitSkillSource: text(skillInstall?.sourceUrl, 1000),
          requestedConstraints: list(fallback.requiredConstraints, 12),
          requiresEvidence: fallback.requiresEvidence,
        },
        result: {
          requiredConstraints: list(selected.requiredConstraints, 12),
          requiresEvidence: selected.requiresEvidence,
          riskLevel: selected.riskLevel ?? 'normal',
          needsUser: selected.needsUser,
          missingUserCondition: selected.needsUser ? text(selected.missingUserCondition, 320) : '',
        },
        rejectedReasons: governanceReasons,
      },
      plan: {
        input: {
          candidateMode: candidateValue(candidate, 'mode', 40),
          candidateRoute: candidateValue(candidate, 'primaryRoute', 80),
          candidateDeliverableType: candidateValue(candidate, 'deliverableType', 80),
          candidateAcceptanceCriteria: list(candidate?.acceptanceCriteria, 8),
        },
        result: {
          mode: selected.mode,
          primaryRoute: selected.primaryRoute,
          deliverableType: selected.deliverableType,
          acceptanceCriteria: list(selected.acceptanceCriteria, 8),
          requiredCapabilities: list(selected.requiredCapabilities, 12),
          searchQuery: text(selected.searchQuery, 1200),
        },
        rejectedReasons: planReasons,
      },
    },
    ...(options.modelAttempted !== undefined || options.modelFailure || options.modelFailureClass
      ? { model: { attempted: options.modelAttempted !== false, ...(options.modelFailure?.failureClass || options.modelFailureClass ? { failureClass: text(options.modelFailure?.failureClass ?? options.modelFailureClass, 80) } : {}) } }
      : {}),
  };
}

export function compileLayeredTaskDecision(input = {}, options = {}) {
  const fallback = options.fallback ?? createFallbackTaskDecision(input);
  const decision = normalizeTaskDecision(options.candidate, input);
  const audit = buildTaskDecisionAudit(input, decision, { ...options, fallback });
  return { decision: { ...decision, decisionAudit: audit }, audit };
}
