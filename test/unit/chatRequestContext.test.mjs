import { describe, expect, it } from 'vitest';
import { prepareChatRequestTurns } from '../../src/engine/chatRequestContext.mjs';

describe('chat request context', () => {
  it('adds current user and role context without changing the original turns', () => {
    const turns = [{ role: 'system', content: 'base' }, { role: 'user', content: 'hello' }];
    const prepared = prepareChatRequestTurns(turns, { userContext: 'prefers Chinese', extraSystemContext: 'employee soul' });
    expect(prepared[0].content).toContain('base');
    expect(prepared[0].content).toContain('employee soul');
    expect(prepared[0].content).toContain('prefers Chinese');
    expect(turns[0].content).toBe('base');
  });

  it('attaches current images only to the latest user turn', () => {
    const prepared = prepareChatRequestTurns([
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'edit this image' },
    ], {
      attachments: [
        { kind: 'file', dataUrl: 'data:text/plain;base64,QQ==' },
        { kind: 'image', dataUrl: 'data:image/png;base64,AA==' },
      ],
    });
    expect(prepared[0].content).toBe('old');
    expect(prepared[2].content).toEqual([
      { type: 'text', text: 'edit this image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
    ]);
  });
});
