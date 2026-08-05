const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { createWebArtifactVerifier } = require('../electron/webArtifactVerifier.cjs');

const root = path.join(os.tmpdir(), `taiji-web-semantic-${process.pid}`);
const workspaceId = 'task-contract';
const artifactRoot = path.join(root, workspaceId);
const artifactPath = path.join(artifactRoot, 'artifact.html');

app.setPath('userData', path.join(root, 'user-data'));
app.setPath('sessionData', path.join(root, 'session'));
app.disableHardwareAcceleration();

function html(swapped) {
  const keys = swapped
    ? [['1', 1], ['2', 2], ['3', 3], ['4', 5], ['5', 4], ['6', 6]]
    : [['1', 1], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6]];
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:40px;font:18px sans-serif}.shell{width:360px}.nav{display:flex;gap:12px;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(3,80px);gap:12px}.key{height:56px;order:var(--order)}#save{margin-top:20px;width:100px;height:44px}#status{margin-left:12px}
  </style></head><body><main class="shell" data-testid="shell"><nav class="nav" data-testid="nav"><button data-testid="nav-home">Home</button><button data-testid="nav-work">Work</button></nav><section class="grid" data-testid="grid">${keys.map(([key, order]) => `<button class="key" style="--order:${order}" data-key="${key}">${key}</button>`).join('')}</section><button id="save">Save</button><span id="status">Idle</span></main><script>document.querySelector('#save').addEventListener('click',()=>{document.querySelector('#status').textContent='Saved'})</script></body></html>`;
}

function canvasHtml(filled) {
  return `<!doctype html><html><body><canvas id="game-canvas" width="240" height="160" style="width:240px;height:160px"></canvas><script>${filled
    ? "const c=document.querySelector('#game-canvas').getContext('2d'); c.fillStyle='#111'; c.fillRect(20,20,40,40);"
    : ''}</script></body></html>`;
}

const semanticChecks = [
  { id: 'navigation-group', type: 'group', container: '[data-testid="nav"]', members: ['[data-testid="nav-home"]', '[data-testid="nav-work"]'] },
  { id: 'navigation-order', type: 'order', selectors: ['[data-testid="nav-home"]', '[data-testid="nav-work"]'], axis: 'horizontal' },
  { id: 'navigation-adjacency', type: 'adjacent', first: '[data-testid="nav-home"]', second: '[data-testid="nav-work"]', direction: 'right', maxGap: 24 },
  { id: 'control-grid', type: 'grid', container: '[data-testid="grid"]', cells: [
    { selector: '[data-key="1"]', row: 1, column: 1 }, { selector: '[data-key="2"]', row: 1, column: 2 }, { selector: '[data-key="3"]', row: 1, column: 3 },
    { selector: '[data-key="4"]', row: 2, column: 1 }, { selector: '[data-key="5"]', row: 2, column: 2 }, { selector: '[data-key="6"]', row: 2, column: 3 },
  ] },
  { id: 'save-flow', type: 'interaction', steps: [{ action: 'click', selector: '#save' }], assertions: [{ selector: '#status', property: 'text', equals: 'Saved' }] },
];

async function main() {
  await fs.mkdir(artifactRoot, { recursive: true });
  await app.whenReady();
  const verify = createWebArtifactVerifier(BrowserWindow, { workspaceRoot: root, settleMs: 60 });
  try {
    await fs.writeFile(artifactPath, html(true), 'utf8');
    const wrong = await verify({ workspaceId, path: 'artifact.html', viewports: [{ width: 900, height: 700, label: 'desktop' }], semanticChecks });
    assert.equal(wrong.ok, false, 'A visually swapped grid must fail the semantic contract');
    assert.equal(wrong.viewports[0].semantic.results.find((item) => item.id === 'control-grid')?.ok, false);

    await fs.writeFile(artifactPath, html(false), 'utf8');
    const corrected = await verify({ workspaceId, path: 'artifact.html', viewports: [{ width: 900, height: 700, label: 'desktop' }], semanticChecks });
    assert.equal(corrected.ok, true, JSON.stringify(corrected, null, 2));
    assert.deepEqual(corrected.viewports[0].semantic, {
      checked: 5,
      passed: 5,
      failed: 0,
      results: corrected.viewports[0].semantic.results,
    });
    const coreSemanticChecks = [{ id: 'game-canvas', type: 'canvas_nonblank', selector: '#game-canvas', minPixels: 1 }];
    await fs.writeFile(artifactPath, canvasHtml(false), 'utf8');
    const emptyCanvas = await verify({ workspaceId, path: 'artifact.html', viewports: [{ width: 900, height: 700, label: 'desktop' }], semanticChecks: coreSemanticChecks });
    assert.equal(emptyCanvas.ok, false, 'An empty canvas must fail the core-content contract');
    assert.equal(emptyCanvas.viewports[0].semantic.results.find((item) => item.id === 'game-canvas')?.ok, false);

    await fs.writeFile(artifactPath, canvasHtml(true), 'utf8');
    const filledCanvas = await verify({ workspaceId, path: 'artifact.html', viewports: [{ width: 900, height: 700, label: 'desktop' }], semanticChecks: coreSemanticChecks });
    assert.equal(filledCanvas.ok, true, JSON.stringify(filledCanvas, null, 2));
    console.log(JSON.stringify({ passed: true, wrongRejected: true, correctedAccepted: true, emptyCanvasRejected: true, filledCanvasAccepted: true, semanticTypes: [...semanticChecks, ...coreSemanticChecks].map((item) => item.type) }, null, 2));
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
