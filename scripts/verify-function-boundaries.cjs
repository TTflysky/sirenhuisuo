const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const limits = {
  'electron/main.cjs': 650,
  'electron/taskService.cjs': 220,
  'electron/taskServiceQueries.cjs': 170,
  'electron/taskServiceContextQueries.cjs': 80,
  'electron/taskServiceEvidenceCommands.cjs': 170,
  'electron/taskServiceApprovalCommands.cjs': 80,
  'electron/taskServiceLifecycleCommands.cjs': 120,
  'electron/taskServiceRecoveryCommands.cjs': 140,
  'electron/taskServiceIpc.cjs': 60,
  'electron/windowIpc.cjs': 160,
  'electron/windowRegistry.cjs': 50,
  'electron/skills.cjs': 100,
  'electron/nativeToolRuntime.cjs': 400,
  'src/data/agentLoopRuntime.ts': 760,
  'src/data/agentLoopPolicy.ts': 40,
  'src/data/agentLoopFinalization.ts': 200,
  'src/engine/autonomousDecisionAuthority.mjs': 70,
  'src/store/teamDiscussionRuntime.ts': 570,
  'src/store/teamWorkerLease.ts': 90,
  'src/store/teamRunFinalization.ts': 110,
  'src/store/teamAutonomousDecision.ts': 60,
};

function functionName(node, sourceFile) {
  if (node.name) return node.name.getText(sourceFile);
  if (ts.isVariableDeclaration(node.parent)) return node.parent.name.getText(sourceFile);
  if (ts.isPropertyAssignment(node.parent)) return node.parent.name.getText(sourceFile);
  if (ts.isMethodDeclaration(node)) return node.name.getText(sourceFile);
  return 'anonymous';
}

const report = {};
for (const [file, maximum] of Object.entries(limits)) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const functions = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      functions.push({ name: functionName(node, sourceFile), start, end, lines: end - start + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  functions.sort((a, b) => b.lines - a.lines);
  const longest = functions[0] ?? { name: 'none', start: 0, end: 0, lines: 0 };
  report[file] = longest;
  assert.ok(longest.lines <= maximum, `${file}:${longest.start} ${longest.name} grew to ${longest.lines} lines; boundary is ${maximum}`);
}

console.log(JSON.stringify({ passed: true, longestFunctions: report }, null, 2));
