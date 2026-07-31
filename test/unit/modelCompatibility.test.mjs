import { describe, expect, it } from 'vitest';
import { buildModelProbePlan, classifyModelProbe, createCompatibilityReport, probeModelCompatibility } from '../../src/engine/modelCompatibility.mjs';

describe('model compatibility matrix', () => {
  it('classifies actionable provider failures', () => {
    expect(classifyModelProbe({ capability: 'chat', status: 401 }).state).toBe('authentication');
    expect(classifyModelProbe({ capability: 'chat', status: 429 }).state).toBe('rate_limited');
    expect(classifyModelProbe({ capability: 'chat', timeout: true }).state).toBe('timeout');
    expect(classifyModelProbe({ capability: 'chat', status: 200, body: { choices: [{ message: { content: 'OK' } }] } }).state).toBe('supported');
  });

  it('builds a versioned matrix without exposing credentials', () => {
    const report = createCompatibilityReport({ modelConfig: { provider: 'openai', apiHost: 'https://example.test/v1', model: 'gpt-4o', apiKey: 'secret' }, probes: [{ capability: 'chat', status: 200, body: { choices: [{ message: { content: 'OK' } }] } }] });
    expect(report.schema).toBe(1);
    expect(report.status).toBe('partial');
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(buildModelProbePlan({ apiHost: 'https://example.test', model: 'gpt-4o' })[0].endpoint).toMatch(/\/v1\/chat\/completions$/u);
  });

  it('uses a real compatible response for a probe', async () => {
    const report = await probeModelCompatibility({ apiHost: 'https://example.test/v1', model: 'gpt-4o', apiKey: 'secret' }, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }) });
    expect(report.capabilities.chat.state).toBe('supported');
    expect(report.probes[0].httpStatus).toBe(200);
  });
});
