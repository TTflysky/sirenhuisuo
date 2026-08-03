import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const debugPort = Number(process.env.CALCULATOR_DEBUG_PORT || 9337);
const endpoint = `http://127.0.0.1:${debugPort}`;
const resultRoot = path.resolve('test-results', 'scientific-calculator-live');
const artifactPath = process.env.CALCULATOR_ARTIFACT_PATH ? path.resolve(process.env.CALCULATOR_ARTIFACT_PATH) : '';

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', async (event) => {
    const raw = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    const request = pending.get(message.id);
    if (!request) return;
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
    return result.result.value;
  };
  await command('Runtime.enable');
  await command('Page.enable');
  return { socket, command, evaluate };
}

async function click(page, selector) {
  const clicked = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLButtonElement)) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `找不到按钮：${selector}`);
}

async function display(page) {
  return page.evaluate(`(() => { const item = document.querySelector('#screen, #display'); return item instanceof HTMLInputElement ? item.value : item?.textContent || ''; })()`);
}

async function clear(page) {
  await click(page, '[data-act="clear"], [data-action="clear"]');
  assert.equal(await display(page), '0');
}

async function input(page, value) {
  for (const char of value) await click(page, `[data-val="${char}"], [data-value="${char}"]`);
}

async function setExpression(page, value) {
  const assigned = await page.evaluate(`(() => {
    const item = document.querySelector('#display');
    if (!(item instanceof HTMLInputElement)) return false;
    item.value = ${JSON.stringify(value)};
    item.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (assigned) return;
  await clear(page);
  await input(page, value);
}

async function screenshot(page, filename, width, height) {
  await page.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const metrics = await page.evaluate(`(() => ({
    viewport: {
      width: innerWidth,
      height: innerHeight,
      clientWidth: document.documentElement.clientWidth,
      visualWidth: visualViewport?.width || innerWidth,
      usableWidth: Math.min(document.documentElement.clientWidth, visualViewport?.width || innerWidth),
    },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    bodyBackground: getComputedStyle(document.body).backgroundImage,
    keys: document.querySelectorAll('.key, .keys button').length,
    smallestKeyHeight: Math.min(...[...document.querySelectorAll('.key, .keys button')].map((item) => item.getBoundingClientRect().height)),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    overflowingElements: [...document.body.querySelectorAll('*')].filter((item) => {
      const style = getComputedStyle(item);
      const rect = item.getBoundingClientRect();
      const usableWidth = Math.min(document.documentElement.clientWidth, visualViewport?.width || innerWidth);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        && (rect.left < -0.5 || rect.right > usableWidth + 0.5);
    }).slice(0, 30).map((item) => {
      const rect = item.getBoundingClientRect();
      return { tag: item.tagName.toLowerCase(), className: String(item.className || '').slice(0, 100), text: String(item.textContent || '').trim().slice(0, 60), left: rect.left, right: rect.right, width: rect.width };
    }),
    clippedElements: [...document.body.querySelectorAll('*')].filter((item) => {
      const rect = item.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let parent = item.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (['hidden', 'clip'].includes(style.overflowX)) {
          const parentRect = parent.getBoundingClientRect();
          if (rect.left < parentRect.left - 0.5 || rect.right > parentRect.right + 0.5) return true;
        }
        parent = parent.parentElement;
      }
      return false;
    }).slice(0, 30).map((item) => ({ tag: item.tagName.toLowerCase(), className: String(item.className || '').slice(0, 100), text: String(item.textContent || '').trim().slice(0, 60) })),
    unsafeFramedElements: [...document.body.querySelectorAll('*')].filter((item) => {
      const style = getComputedStyle(item);
      const rect = item.getBoundingClientRect();
      const usableWidth = Math.min(document.documentElement.clientWidth, visualViewport?.width || innerWidth);
      const borderWidth = Math.max(
        parseFloat(style.borderLeftWidth) || 0,
        parseFloat(style.borderRightWidth) || 0,
        parseFloat(style.borderTopWidth) || 0,
        parseFloat(style.borderBottomWidth) || 0,
      );
      const shadows = style.boxShadow === 'none' ? [] : style.boxShadow.split(/,(?![^()]*\\))/u);
      let shadowLeft = 0;
      let shadowRight = 0;
      for (const shadow of shadows) {
        if (/\\binset\\b/iu.test(shadow)) continue;
        const lengths = [...shadow.matchAll(/(-?\\d*\\.?\\d+)px/gu)].map((match) => Number(match[1]));
        const [offsetX = 0, , blur = 0, spread = 0] = lengths;
        shadowLeft = Math.max(shadowLeft, Math.max(0, blur + spread - offsetX));
        shadowRight = Math.max(shadowRight, Math.max(0, blur + spread + offsetX));
      }
      const framed = borderWidth > 0 || shadows.length > 0;
      if (!framed || style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
      return rect.left - shadowLeft < 8 || usableWidth - (rect.right + shadowRight) < 8;
    }).slice(0, 30).map((item) => {
      const rect = item.getBoundingClientRect();
      return { tag: item.tagName.toLowerCase(), className: String(item.className || '').slice(0, 100), text: String(item.textContent || '').trim().slice(0, 60), left: rect.left, right: rect.right };
    }),
  }))()`);
  const capture = await page.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await fs.writeFile(path.join(resultRoot, filename), Buffer.from(capture.data, 'base64'));
  return metrics;
}

const response = await fetch(`${endpoint}/json`);
const targets = await response.json();
const artifactUrl = artifactPath ? pathToFileURL(artifactPath).href : '';
const target = targets.find((item) => item.type === 'page' && (!artifactUrl || item.url === artifactUrl))
  || targets.find((item) => item.type === 'page' && item.url.includes('pop-art-scientific-calculator.html'))
  || targets.find((item) => item.type === 'page');
assert.ok(target, '没有找到已打开的科学计算器页面');
await fs.mkdir(resultRoot, { recursive: true });

const page = await connect(target);
try {
  if (artifactUrl && target.url !== artifactUrl) {
    await page.command('Page.navigate', { url: artifactUrl });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const loaded = await page.evaluate(`(() => ({ title: document.title, url: location.href, readyState: document.readyState }))()`);
  assert.equal(loaded.url, artifactUrl || target.url, '验收页面不是指定的任务产物');
  assert.match(loaded.title, /科学计算器/u);

  await setExpression(page, '2+3');
  await click(page, '[data-act="equals"], [data-action="equals"]');
  assert.equal(await display(page), '5', '2 + 3 计算错误');

  await setExpression(page, 'sin(30)');
  await click(page, '[data-act="equals"], [data-action="equals"]');
  assert.equal(await display(page), '0.5', 'DEG 模式 sin(30) 计算错误');

  await setExpression(page, 'sqrt(144)');
  await click(page, '[data-act="equals"], [data-action="equals"]');
  assert.equal(await display(page), '12', 'sqrt(144) 计算错误');

  await clear(page);
  await setExpression(page, '9*9');
  await page.evaluate(`(() => { const target = document.querySelector('#display') || document; target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  assert.equal(await display(page), '81', '键盘输入 9 * 9 计算错误');

  const desktop = await screenshot(page, 'artifact-desktop-1440x900.png', 1440, 900);
  const mobile = await screenshot(page, 'artifact-mobile-375x844.png', 375, 844);
  console.log(JSON.stringify({ visualBoundaryProbe: { desktop, mobile } }, null, 2));
  assert.match(desktop.bodyBackground, /radial-gradient/iu, '页面缺少黑白点状主体背景');
  assert.equal(desktop.horizontalOverflow, false, '桌面页面发生横向溢出');
  assert.equal(mobile.horizontalOverflow, false, '手机页面发生横向溢出');
  assert.ok(desktop.keys >= 30, `科学计算按键数量不足：${desktop.keys}`);
  assert.ok(mobile.smallestKeyHeight >= 40, `手机端按键过小：${mobile.smallestKeyHeight}px`);

  assert.deepEqual(desktop.overflowingElements, [], `Desktop elements exceed the viewport: ${JSON.stringify(desktop.overflowingElements)}`);
  assert.deepEqual(mobile.overflowingElements, [], `Narrow-screen elements exceed the viewport: ${JSON.stringify(mobile.overflowingElements)}`);
  assert.deepEqual(mobile.clippedElements, [], `Narrow-screen elements are clipped by a parent: ${JSON.stringify(mobile.clippedElements)}`);
  assert.deepEqual(mobile.unsafeFramedElements, [], `Narrow-screen framed elements or shadows enter the 8px safe area: ${JSON.stringify(mobile.unsafeFramedElements)}`);

  const result = {
    passed: true,
    title: loaded.title,
    artifactPath: artifactPath || decodeURIComponent(new URL(loaded.url).pathname),
    interactions: ['2 + 3 = 5', 'sin(30) = 0.5', 'sqrt(144) = 12', 'keyboard: 9 * 9 = 81', 'clear -> 0'],
    desktop,
    mobile,
    screenshots: ['artifact-desktop-1440x900.png', 'artifact-mobile-375x844.png'],
  };
  await fs.writeFile(path.join(resultRoot, 'artifact-verification.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  page.socket.close();
}
