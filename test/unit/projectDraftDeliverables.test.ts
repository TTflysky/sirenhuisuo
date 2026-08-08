import { describe, expect, it } from 'vitest';
import { buildProjectDraft } from '../../src/engine/projectDraft';

describe('project draft explicit deliverables', () => {
  it('preserves every explicitly requested file instead of accepting a generic model fallback', () => {
    const project = buildProjectDraft({
      title: '离线创作者选题与大纲工作台',
      request: [
        '交付一个本地网页应用。',
        '产出 index.html、styles.css、app.js、README.md、测试报告。',
        '必须在独立工作区写入并运行验证。',
      ].join('\n'),
      deliverables: [{
        id: 'generic',
        label: '与原始目标一致的可验证结果',
        required: true,
      }],
    }, [], 100);

    expect(project.expectedOutputs).toEqual(['index.html', 'styles.css', 'app.js', 'README.md', '测试报告']);
    expect(project.deliverables?.map((item) => item.label)).toEqual(project.expectedOutputs);
    expect(project.deliverables?.every((item) => item.required !== false)).toBe(true);
    expect(project.brief?.stages.filter((stage) => stage.id !== 'integration').map((stage) => stage.title)).toEqual(project.expectedOutputs);
  });
});
