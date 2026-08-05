import { describe, expect, it } from 'vitest';
import { assessTaskCompletion } from '../../src/engine/taskFidelity.mjs';

describe('web artifact completion evidence', () => {
  const goal = '制作一个可使用的网页工具';
  const touched = { name: 'write_file', args: '{"path":"app.html"}', result: '文件已写入 app.html', success: true };

  it('rejects HTML delivery without the built-in viewport verifier', () => {
    const result = assessTaskCompletion(goal, '已经完成', [touched]);
    expect(result.passed).toBe(false);
    expect(result.issues.join('\n')).toContain('verify_web_artifact');
  });

  it('rejects a failed viewport verification', () => {
    const result = assessTaskCompletion(goal, '已经完成', [
      touched,
      { name: 'verify_web_artifact', args: '{"path":"app.html"}', result: '网页真实验收未通过', success: false },
    ]);
    expect(result.passed).toBe(false);
  });

  it('accepts HTML only after desktop and narrow-screen verification passes', () => {
    const result = assessTaskCompletion(goal, '已经完成', [
      touched,
      { name: 'verify_web_artifact', args: '{"path":"app.html"}', result: '网页真实验收通过\n{"ok":true,"checked":2}', success: true },
    ]);
    expect(result.passed).toBe(true);
  });

  it('rejects a successful check that only covered one viewport', () => {
    const result = assessTaskCompletion(goal, '已经完成', [
      touched,
      {
        name: 'verify_web_artifact',
        args: '{"path":"app.html","viewports":[{"label":"narrow","width":375,"height":844}]}',
        result: '网页真实验收通过\n{"ok":true,"checked":1}',
        success: true,
      },
    ]);
    expect(result.passed).toBe(false);
    expect(result.issues.join('\n')).toContain('桌面与窄屏');
  });

  it('accepts explicit desktop and narrow viewport coverage', () => {
    const result = assessTaskCompletion(goal, '已经完成', [
      touched,
      {
        name: 'verify_web_artifact',
        args: '{"path":"app.html","viewports":[{"label":"desktop","width":1440,"height":900},{"label":"narrow","width":375,"height":844}]}',
        result: '网页真实验收通过\n{"ok":true,"checked":2}',
        success: true,
      },
    ]);
    expect(result.passed).toBe(true);
  });

  it('rejects an interactive web game that only proves the page shell', () => {
    const result = assessTaskCompletion('做一个小贪吃蛇的网页游戏', '已经完成', [
      { name: 'write_file', args: '{"path":"snake.html"}', result: '文件已写入 snake.html', success: true },
      {
        name: 'verify_web_artifact',
        args: '{"path":"snake.html","viewports":[{"label":"desktop","width":1440,"height":900},{"label":"narrow","width":375,"height":844}]}',
        result: `网页真实验收通过\n${JSON.stringify({ ok: true, checked: 2, viewports: [{ label: 'desktop', width: 1440 }, { label: 'narrow', width: 375 }] })}`,
        success: true,
      },
    ]);
    expect(result.passed).toBe(false);
    expect(result.issues.join('\n')).toContain('核心内容证据');
  });

  it('accepts an interactive web game only with successful core semantic evidence', () => {
    const semantic = { checked: 1, passed: 1, failed: 0, results: [{ id: 'snake-canvas', type: 'canvas_nonblank', ok: true, failures: [], evidence: { nonBlankPixels: 42 } }] };
    const result = assessTaskCompletion('做一个小贪吃蛇的网页游戏', '已经完成', [
      { name: 'write_file', args: '{"path":"snake.html"}', result: '文件已写入 snake.html', success: true },
      {
        name: 'verify_web_artifact',
        args: '{"path":"snake.html","viewports":[{"label":"desktop","width":1440,"height":900},{"label":"narrow","width":375,"height":844}],"semanticChecks":[{"type":"canvas_nonblank","selector":"canvas"}]}',
        result: `网页真实验收通过\n${JSON.stringify({ ok: true, checked: 2, viewports: [{ label: 'desktop', width: 1440, semantic }, { label: 'narrow', width: 375, semantic }] })}`,
        success: true,
      },
    ]);
    expect(result.passed).toBe(true);
  });
});
