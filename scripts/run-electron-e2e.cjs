const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function waitForUrl(endpoint, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(endpoint);
        if (response.ok) return resolve();
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`Endpoint did not start: ${endpoint}`));
      setTimeout(poll, 150);
    };
    poll();
  });
}

function runNode(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: path.resolve(__dirname, '..'), env, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`)));
  });
}

async function waitForPageReady(port, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastTargets = [];
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      lastTargets = targets;
      const page = targets.find((target) => target.type === 'page' && /^https?:\/\//iu.test(target.url || ''));
      if (page) return targets;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Electron renderer did not finish its first page load. Last targets: ${JSON.stringify(lastTargets)}`);
}

(async () => {
  const script = process.argv[2] || 'scripts/verify-chat-controls-e2e.mjs';
  const args = process.argv.slice(3);
  const electronPath = process.env.TAIJI_ELECTRON_PATH || require('electron');
  const port = 9400 + Math.floor(Math.random() * 300);
  const vitePort = 10300 + Math.floor(Math.random() * 300);
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-electron-e2e-'));
  const env = {
    ...process.env,
    TAIJI_TEST_DEBUG_PORT: String(port),
    TAIJI_DEBUG_PORT: String(port),
    TAIJI_TEST_USER_DATA: userData,
    TAIJI_DISABLE_HARDWARE_ACCELERATION: '1',
    TAIJI_DEV_SERVER_URL: `http://127.0.0.1:${vitePort}`,
  };
  const vite = spawn(process.execPath, [path.resolve(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: path.resolve(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let viteLog = '';
  let electron;
  let electronLog = '';
  vite.stdout.on('data', (chunk) => { viteLog = `${viteLog}${chunk}`.slice(-8000); });
  vite.stderr.on('data', (chunk) => { viteLog = `${viteLog}${chunk}`.slice(-8000); });
  try {
    await waitForUrl(`http://127.0.0.1:${vitePort}`);
    electron = spawn(electronPath, ['.', '--disable-gpu', '--disable-gpu-compositing', '--disable-direct-composition', '--disable-features=CalculateNativeWinOcclusion,Vulkan'], {
      cwd: path.resolve(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    electron.stdout.on('data', (chunk) => { electronLog = `${electronLog}${chunk}`.slice(-16000); });
    electron.stderr.on('data', (chunk) => { electronLog = `${electronLog}${chunk}`.slice(-16000); });
    await waitForUrl(`http://127.0.0.1:${port}/json`);
    const debugTargets = await waitForPageReady(port);
    console.log('[electron-e2e] targets', debugTargets.map((target) => ({ type: target.type, title: target.title, url: target.url })));
    await runNode(script, args, env);
  } catch (error) {
    if (viteLog.trim()) console.error(viteLog);
    if (electronLog.trim()) console.error(electronLog);
    throw error;
  } finally {
    electron?.kill();
    vite.kill();
    await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
