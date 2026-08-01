import { describe, expect, it } from 'vitest';
import { appendSkillEvidence, buildSkillLifecycle } from '../../src/engine/skillEvidence.mjs';

describe('skill lifecycle evidence', () => {
  it('requires discovery, rules, invocation, output and acceptance', () => {
    let evidence = [];
    for (const [action, verified] of [['matched', true], ['read', true], ['installed', true], ['called', true], ['produced', true]]) {
      evidence = appendSkillEvidence(evidence, { skillId: 'skill-1', action, verified });
    }
    expect(buildSkillLifecycle(evidence, 'skill-1')).toMatchObject({ usable: false, stages: { acceptance: false } });
    evidence = appendSkillEvidence(evidence, { skillId: 'skill-1', action: 'accepted', verified: true });
    expect(buildSkillLifecycle(evidence, 'skill-1').usable).toBe(true);
  });

  it('does not treat installation as invocation and rejection overrides acceptance', () => {
    let evidence = appendSkillEvidence([], { skillId: 'skill-1', action: 'installed', verified: true });
    expect(buildSkillLifecycle(evidence, 'skill-1').stages.invocation).toBe(false);
    for (const action of ['matched', 'read', 'called', 'produced', 'accepted']) evidence = appendSkillEvidence(evidence, { skillId: 'skill-1', action, verified: true });
    evidence = appendSkillEvidence(evidence, { skillId: 'skill-1', action: 'rejected', verified: false, detail: 'output failed review' });
    expect(buildSkillLifecycle(evidence, 'skill-1').usable).toBe(false);
  });
});
