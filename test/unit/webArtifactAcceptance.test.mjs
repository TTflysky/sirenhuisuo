import { describe, expect, it } from 'vitest';
import {
  createWebArtifactAcceptanceCycle,
  observeWebArtifactAcceptanceCycle,
  webArtifactAcceptanceGate,
} from '../../src/engine/webArtifactAcceptance.mjs';

describe('web artifact acceptance cycle', () => {
  it('allows diagnosis after a failed verification, then requires immediate re-verification after mutation', () => {
    let state = createWebArtifactAcceptanceCycle();
    state = observeWebArtifactAcceptanceCycle(state, {
      name: 'verify_web_artifact', args: '{"path":"app.html"}', output: 'failed', success: false, executed: true,
    });
    expect(webArtifactAcceptanceGate(state, 'read_file')).toBe('');

    state = observeWebArtifactAcceptanceCycle(state, {
      name: 'run_command', args: '{"cmd":"node fix.js"}', output: '工作区文件已同步到产出物：1 个', success: true, executed: true,
    });
    expect(webArtifactAcceptanceGate(state, 'read_file')).toContain('verify_web_artifact');
    expect(webArtifactAcceptanceGate(state, 'write_file')).toContain('立即调用');
    expect(webArtifactAcceptanceGate(state, 'verify_web_artifact')).toBe('');
  });

  it('also recognizes direct web source edits and clears the cycle after verification passes', () => {
    let state = { path: 'app.html', mutationAfterFailure: false };
    state = observeWebArtifactAcceptanceCycle(state, {
      name: 'write_file', args: '{"path":"styles.css"}', output: 'saved', success: true, executed: true,
    });
    expect(state.mutationAfterFailure).toBe(true);
    state = observeWebArtifactAcceptanceCycle(state, {
      name: 'verify_web_artifact', args: '{"path":"app.html"}', output: 'passed', success: true, executed: true,
    });
    expect(state).toEqual(createWebArtifactAcceptanceCycle());
  });
});
