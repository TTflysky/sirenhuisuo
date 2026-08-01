import { beforeEach, describe, expect, it } from 'vitest';
import { loadExternalCapabilityMatrix, recordExternalCapabilityProbe, syncExternalCapabilityProfiles } from '../../src/data/externalCapabilityMatrix.ts';

describe('external capability persistence', () => {
  beforeEach(() => localStorage.clear());

  it('keeps independent profiles and their real probe state across reloads', () => {
    const chat = { id: 'chat', kind: 'chat_model', label: 'Chat', configured: true };
    const web = { id: 'web', kind: 'web_page', label: 'Web', configured: true };
    syncExternalCapabilityProfiles([chat, web]);
    recordExternalCapabilityProbe(chat, { actualCall: true, ok: true, validated: true });
    const loaded = loadExternalCapabilityMatrix();
    expect(Object.keys(loaded.entries)).toEqual(['chat', 'web']);
    expect(loaded.entries.chat.state).toBe('available');
    expect(loaded.entries.web.state).toBe('not_tested');
  });
});
