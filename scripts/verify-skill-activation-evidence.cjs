const assert = require('assert/strict');
const { createNativeToolRuntime } = require('../electron/nativeToolRuntime.cjs');

async function main() {
  const runtime = createNativeToolRuntime({
    workspaceRoot: process.cwd(),
    projectRoot: process.cwd(),
    listSkills: async () => [],
    readSkill: async () => ({ name: 'demo-skill', content: '必须先读取规则再执行。', documents: [{ path: 'references/api.md', content: '验证接口' }] }),
    installSkill: async () => ({ ok: false, error: 'not used' }),
    runCommand: async () => ({ success: true, exitCode: 0, stdout: '', stderr: '' }),
  });
  const result = await runtime.execute('read_skill', { id: 'demo-skill' }, { executionPolicy: { approvalMode: 'full' }, workspaceId: 'verify-skill' });
  assert.equal(result.success, true);
  assert.equal(result.structuredEvidence.skill.action, 'read');
  assert.equal(result.structuredEvidence.skill.verified, true);
  assert.equal(result.structuredEvidence.skill.documentCount, 1);
  console.log('verify-skill-activation-evidence: PASS');
}

main().catch((error) => {
  console.error(`verify-skill-activation-evidence: FAIL: ${error.message}`);
  process.exitCode = 1;
});
