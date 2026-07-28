import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9335);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listTargets() {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`Cannot connect to Electron debug port ${debugPort}`);
  return response.json();
}

async function waitFor(check, message, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(message);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', async (event) => {
    const raw = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const command = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Page evaluation failed');
    return result.result.value;
  };
  await command('Runtime.enable');
  await command('Page.enable');
  return { socket, command, evaluate };
}

let main;
let previousEmployees;
try {
  const target = await waitFor(
    async () => (await listTargets()).find((item) => !item.url.includes('#chat') && !item.url.includes('#tool') && !item.url.includes('#settings')),
    'Main office window was not found',
  );
  main = await connect(target);
  const prepared = await main.evaluate(`(() => {
    const key = 'hermes_office_employees';
    const previous = localStorage.getItem(key);
    const current = JSON.parse(previous || '[]');
    const base = current.find((employee) => employee.stationIndex >= 0) || current[0];
    if (!base) return { ok: false, previous };
    const employees = Array.from({ length: 999 }, (_, stationIndex) => ({
      ...base,
      id: 'office-scroll-test-' + stationIndex,
      name: 'Member ' + String(stationIndex + 1).padStart(3, '0'),
      stationIndex,
      isOnline: true,
      isWorking: false,
      currentTeamId: undefined,
    }));
    localStorage.setItem(key, JSON.stringify(employees));
    setTimeout(() => location.reload(), 20);
    return { ok: true, previous };
  })()`);
  assert.equal(prepared.ok, true, 'Test employee template was not available');
  previousEmployees = prepared.previous;

  const metrics = await waitFor(async () => main.evaluate(`(() => {
    const container = document.querySelector('.office-container');
    const grid = document.querySelector('.office-grid');
    const occupied = document.querySelectorAll('.station-card.occupied');
    const stations = document.querySelectorAll('.station-card');
    if (!container || !grid || occupied.length !== 999) return null;
    const containerRect = container.getBoundingClientRect();
    const lastRect = stations[stations.length - 1]?.getBoundingClientRect();
    return {
      occupied: occupied.length,
      stations: stations.length,
      declaredStations: Number(grid.dataset.stationCount || 0),
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      initialScrollTop: container.scrollTop,
      lastStationBelowFold: Boolean(lastRect && lastRect.bottom > containerRect.bottom),
      x: Math.round(containerRect.left + containerRect.width / 2),
      y: Math.round(containerRect.top + Math.min(containerRect.height / 2, 260)),
    };
  })()`), 'Office did not render 999 employees');

  assert.equal(metrics.occupied, 999, 'Not every employee received a visible workstation');
  assert.equal(metrics.stations, 999, 'The office should expose the configured 999 workstations');
  assert.equal(metrics.declaredStations, 999, 'Rendered station count does not match the configured capacity');
  assert.ok(metrics.scrollHeight > metrics.clientHeight, 'Expanded office did not create a vertical scroll area');
  assert.equal(metrics.lastStationBelowFold, true, 'Large office did not extend below the first viewport');

  await main.command('Page.bringToFront');
  await main.command('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: metrics.x, y: metrics.y, deltaX: 0, deltaY: 560,
  });
  await delay(220);
  const scrollTop = await main.evaluate(`document.querySelector('.office-container')?.scrollTop ?? 0`);
  assert.ok(scrollTop > metrics.initialScrollTop, 'Mouse wheel did not scroll the expanded office');

  const screenshot = await main.command('Page.captureScreenshot', { format: 'png' });
  const outputDir = path.resolve('artifacts', 'ui-verification');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'office-scroll-999.png'), Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ passed: true, metrics: { ...metrics, scrollTop }, screenshot: path.join(outputDir, 'office-scroll-999.png') }, null, 2));
} finally {
  if (main && previousEmployees !== undefined) {
    const serialized = JSON.stringify(previousEmployees);
    try {
      await main.evaluate(`(() => {
        const previous = ${serialized};
        if (previous === null) localStorage.removeItem('hermes_office_employees');
        else localStorage.setItem('hermes_office_employees', previous);
        setTimeout(() => location.reload(), 20);
      })()`);
    } catch {}
  }
  main?.socket.close();
}
