import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GeneratedImagePreview from '../../src/components/chat/GeneratedImagePreview';

describe('GeneratedImagePreview', () => {
  it('renders only persisted image attachments as downloadable images', () => {
    const attachments = [
      { name: 'result.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', size: 4, kind: 'image' as const },
      { name: 'notes.txt', mime: 'text/plain', dataUrl: 'hello', size: 5, kind: 'text' as const },
    ];
    render(<GeneratedImagePreview attachments={attachments} />);
    const image = screen.getByRole('img', { name: 'result.png' });
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(image.closest('a')?.getAttribute('download')).toBe('result.png');
    expect(screen.queryByText('notes.txt')).toBeNull();
  });

  it('renders nothing when no image has persisted content', () => {
    const { container } = render(<GeneratedImagePreview attachments={[{ name: 'empty.png', mime: 'image/png', size: 0, kind: 'image' }]} />);
    expect(container.innerHTML).toBe('');
  });
});
