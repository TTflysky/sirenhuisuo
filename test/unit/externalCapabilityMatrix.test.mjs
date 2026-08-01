import { describe, expect, it } from 'vitest';
import {
  applyExternalCapabilityProbe,
  classifyExternalCapabilityProbe,
  completeExternalCapabilityProfiles,
  createExternalCapabilityMatrix,
  sanitizeResourceIdentity,
  summarizeExternalCapabilityMatrix,
} from '../../src/engine/externalCapabilityMatrix.mjs';

const profile = { id: 'chat:primary', kind: 'chat_model', label: 'Primary chat', configured: true, resourceIdentity: 'https://api.example/v1?token=secret' };

describe('external capability matrix', () => {
  it('does not mark configured or discovered capabilities as available', () => {
    const matrix = createExternalCapabilityMatrix([profile, { id: 'mail', kind: 'email', label: 'Mail', configured: false }]);
    expect(matrix.entries['chat:primary'].state).toBe('not_tested');
    expect(matrix.entries.mail.state).toBe('missing_config');
    expect(summarizeExternalCapabilityMatrix(matrix)).toMatchObject({ available: 0, missingConfig: 1, notTested: 1 });
  });

  it('covers required failure states and only records recovery after a real recheck', () => {
    expect(classifyExternalCapabilityProbe({ configured: true, actualCall: true, status: 401 })).toBe('authentication_failed');
    expect(classifyExternalCapabilityProbe({ configured: true, actualCall: true, status: 429 })).toBe('rate_limited');
    expect(classifyExternalCapabilityProbe({ configured: true, actualCall: true, protocolError: true })).toBe('protocol_error');
    expect(classifyExternalCapabilityProbe({ configured: true, actualCall: true, invalidContent: true })).toBe('invalid_content');
    let matrix = createExternalCapabilityMatrix([profile]);
    matrix = applyExternalCapabilityProbe(matrix, { profile, actualCall: true, status: 503, error: 'unavailable' });
    expect(matrix.entries[profile.id].state).toBe('unavailable');
    matrix = applyExternalCapabilityProbe(matrix, { profile, actualCall: false, ok: true });
    expect(matrix.entries[profile.id].recoveryCount).toBe(0);
    matrix = applyExternalCapabilityProbe(matrix, { profile, actualCall: true, ok: true, validated: true, responseReceived: true });
    expect(matrix.entries[profile.id]).toMatchObject({ state: 'available', recoveryCount: 1 });
  });

  it('keeps resource identity while redacting URL credentials', () => {
    expect(sanitizeResourceIdentity('https://user:pass@example.com/path?token=abc&view=full')).toBe('https://example.com/path?token=%3Credacted%3E&view=full');
  });

  it('rebuilds persisted entries without requiring a second inventory', () => {
    const saved = applyExternalCapabilityProbe(createExternalCapabilityMatrix([profile]), { profile, actualCall: true, ok: true, validated: true });
    expect(createExternalCapabilityMatrix([], saved).entries[profile.id].state).toBe('available');
  });

  it('keeps all nine capability kinds visible when configuration is absent', () => {
    const profiles = completeExternalCapabilityProfiles([profile], { image_generation: 'Image generation' });
    const matrix = createExternalCapabilityMatrix(profiles);
    expect(new Set(Object.values(matrix.entries).map((entry) => entry.kind)).size).toBe(9);
    expect(matrix.entries['inventory:image_generation']).toMatchObject({ label: 'Image generation', state: 'missing_config' });
    expect(matrix.entries['chat:primary'].state).toBe('not_tested');
  });
});
