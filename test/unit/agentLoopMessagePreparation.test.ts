import { describe, expect, it } from 'vitest';
import { attachImagesToLatestUserTurn } from '../../src/data/agentLoopMessagePreparation';

describe('agent loop message preparation', () => {
  it('adds image attachments only to the latest user turn', () => {
    const result = attachImagesToLatestUserTurn([
      { role: 'user', content: 'Earlier request' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Please edit this image' },
    ], [{
      name: 'source.png',
      mime: 'image/png',
      kind: 'image',
      size: 4,
      dataUrl: 'data:image/png;base64,AAAA',
    }]);

    expect(result[0].content).toBe('Earlier request');
    expect(result[2].content).toEqual([
      { type: 'text', text: 'Please edit this image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('does not alter turns when no usable image is available', () => {
    const turns = [{ role: 'user' as const, content: 'No image available' }];
    expect(attachImagesToLatestUserTurn(turns, [{
      name: 'note.txt',
      mime: 'text/plain',
      kind: 'text',
      size: 4,
      dataUrl: 'text',
    }])).toBe(turns);
  });
});
