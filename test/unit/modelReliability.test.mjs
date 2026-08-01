import { describe, expect, it } from 'vitest';
import {
  createModelReliabilityRegistry,
  getModelAdmission,
  getModelRecoveryAdvice,
  modelKey,
  nextModelBackoffMs,
  recordModelAttempt,
  recordModelFirstToken,
  startModelAttempt,
  summarizeModelReliability,
} from '../../src/engine/modelReliability.mjs';

describe('model reliability registry', () => {
  it('does not include credentials in the model key and opens after transient failures', () => {
    const registry = createModelReliabilityRegistry();
    const key = modelKey({ provider: 'openai', apiHost: 'https://api.example/v1/', model: 'chat', apiKey: 'secret' });
    expect(key).not.toContain('secret');
    for (let index = 0; index < 3; index += 1) {
      startModelAttempt(registry, key, index + 1);
      recordModelAttempt(registry, { key, success: false, failureClass: 'server', status: 503, now: index + 1, latencyMs: 20 });
    }
    const admission = getModelAdmission(registry, key, 3);
    expect(admission.allowed).toBe(false);
    expect(admission.state).toBe('open');
    expect(admission.retryAfterMs).toBeGreaterThan(0);
    expect(getModelRecoveryAdvice(registry, key, ['backup'], 3).alternatives).toEqual(['backup']);
  });

  it('allows one half-open probe after cooldown and closes on recovery', () => {
    const registry = createModelReliabilityRegistry();
    const key = 'provider|https://example|model';
    for (let index = 0; index < 3; index += 1) {
      startModelAttempt(registry, key, index + 1);
      recordModelAttempt(registry, { key, success: false, failureClass: 'timeout', now: index + 1 });
    }
    const probeTime = 30004;
    expect(getModelAdmission(registry, key, probeTime).state).toBe('half_open');
    startModelAttempt(registry, key, probeTime);
    expect(getModelAdmission(registry, key, probeTime).allowed).toBe(false);
    recordModelFirstToken(registry, key, 42, probeTime + 42);
    recordModelAttempt(registry, { key, success: true, now: probeTime + 100, latencyMs: 100 });
    const summary = summarizeModelReliability(registry)[0];
    expect(summary.circuitState).toBe('closed');
    expect(summary.successRate).toBe(0.25);
    expect(summary.averageFirstTokenMs).toBe(42);
    expect(summary.recovery.recovered).toBe(1);
  });

  it('uses deterministic bounded backoff by failure class', () => {
    expect(nextModelBackoffMs(0, 'server')).toBe(1500);
    expect(nextModelBackoffMs(3, 'server')).toBe(12000);
    expect(nextModelBackoffMs(20, 'server')).toBe(120000);
  });
});
