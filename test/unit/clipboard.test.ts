import { describe, expect, it } from 'vitest';
import { messagesToMarkdown } from '../../src/utils/clipboard';

describe('chat transcript attachment export', () => {
  it('exports attachment metadata, persisted paths, image references, and bounded text previews', () => {
    const longText = '正文'.repeat(4000);
    const markdown = messagesToMarkdown([{
      role: '用户',
      author: '老板',
      content: '请结合附件继续。',
      time: '2026/8/1 10:00:00',
      attachments: [
        { name: '界面图.png', kind: 'image', mime: 'image/png', size: 2048, workspacePath: 'uploads/run/界面图.png', dataUrl: 'data:image/png;base64,AAAA' },
        { name: '需求.md', kind: 'text', mime: 'text/markdown', size: longText.length, workspacePath: 'uploads/run/需求.md', dataUrl: longText },
      ],
    }], '测试记录');

    expect(markdown).toContain('界面图.png');
    expect(markdown).toContain('image/png');
    expect(markdown).toContain('uploads/run/界面图.png');
    expect(markdown).toContain('![界面图.png](<uploads/run/界面图.png>)');
    expect(markdown).toContain('文本预览已截断');
    expect(markdown).not.toContain('data:image/png;base64');
    expect(markdown.length).toBeLessThan(9000);
  });

  it('records an unpersisted image without embedding its base64 payload', () => {
    const markdown = messagesToMarkdown([{
      role: '用户',
      content: '图片',
      attachments: [{ name: '临时.png', kind: 'image', mime: 'image/png', size: 4, dataUrl: 'data:image/png;base64,AAAA' }],
    }], '测试记录');

    expect(markdown).toContain('尚未确认落盘位置');
    expect(markdown).toContain('未写入 Base64');
    expect(markdown).not.toContain('data:image/png;base64');
  });
});
