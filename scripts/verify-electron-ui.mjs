import fs from 'node:fs/promises';
import path from 'node:path';

const response = await fetch('http://127.0.0.1:9333/json');
const [target] = await response.json();
if (!target?.webSocketDebuggerUrl) throw new Error('Electron debug target not found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

socket.addEventListener('message', async (event) => {
  const raw = typeof event.data === 'string' ? event.data : await event.data.text();
  const message = JSON.parse(raw);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}, timeoutMs = 10000) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value); },
      reject: (error) => { clearTimeout(timeout); reject(error); },
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = async (expression) => {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  return result.result.value;
};

await command('Runtime.enable');
await command('Page.enable');

await evaluate(`(() => {
  document.querySelector('.settings-center-modal .ant-modal-close')?.click();
})()`);
await delay(250);
const openState = await evaluate(`(() => {
  const darkButton = [...document.querySelectorAll('button')].find((button) => button.title === '切换到黑夜模式');
  darkButton?.click();
  const settingsButton = document.querySelector('button[title="API 接口配置"]');
  settingsButton?.click();
  return { darkButton: Boolean(darkButton), settingsButton: Boolean(settingsButton) };
})()`);
await delay(700);

const modalMetrics = await evaluate(`(() => {
  const modal = document.querySelector('.settings-center-modal .ant-modal-container, .settings-center-modal .ant-modal-content');
  const settings = document.querySelector('.settings-center');
  const titlebar = document.querySelector('.titlebar');
  const brand = document.querySelector('.settings-center-brand');
  if (!modal || !settings || !titlebar || !brand) return {
    found: { modal: Boolean(modal), settings: Boolean(settings), titlebar: Boolean(titlebar), brand: Boolean(brand) },
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((dialog) => ({
      className: dialog.className,
      descendants: [...dialog.querySelectorAll('[class]')].slice(0, 30).map((element) => element.className),
    })),
  };
  const modalStyle = getComputedStyle(modal);
  const titlebarStyle = getComputedStyle(titlebar);
  const brandStyle = getComputedStyle(brand);
  const rect = modal.getBoundingClientRect();
  return {
    modal: {
      background: modalStyle.backgroundColor,
      border: modalStyle.borderColor,
      padding: modalStyle.padding,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    theme: document.documentElement.dataset.theme,
    titlebarDrag: titlebarStyle.getPropertyValue('-webkit-app-region'),
    settingsDrag: brandStyle.getPropertyValue('-webkit-app-region'),
    nav: [...document.querySelectorAll('.settings-nav-section button')].map((button) => button.textContent?.trim()),
  };
})()`);

const outputDir = path.resolve('artifacts', 'ui-verification');
await fs.mkdir(outputDir, { recursive: true });
const appearanceState = await evaluate(`(() => {
  const appearanceButton = [...document.querySelectorAll('.settings-nav-section button')]
    .find((button) => button.textContent?.includes('外观'));
  appearanceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return Boolean(appearanceButton);
})()`);
await delay(500);
const appearanceDom = await evaluate(`(() => ({
  page: Boolean(document.querySelector('.appearance-settings-page')),
  activeNav: document.querySelector('.settings-nav-section button.active')?.textContent?.trim(),
}))()`);
await evaluate(`(() => {
  const largeButton = [...document.querySelectorAll('.appearance-settings-page .ant-segmented-item-label')]
    .find((element) => element.textContent?.trim() === '大');
  largeButton?.click();
  document.querySelector('.appearance-settings-page .ant-select-selector')
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  return Boolean(largeButton);
})()`);
await delay(350);
const fontOptions = await evaluate(`(() => {
  const options = [...document.querySelectorAll('.ant-select-item-option-content')].map((item) => item.textContent?.trim());
  const serif = [...document.querySelectorAll('.ant-select-item-option-content')].find((item) => item.textContent?.includes('Noto Serif'));
  serif?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  return options;
})()`);
await delay(650);
const appearanceMetrics = await evaluate(`(() => ({
  selectedFont: document.querySelector('.appearance-settings-page .ant-select-selection-item')?.textContent?.trim(),
  fontSize: JSON.parse(localStorage.getItem('hermes_office_appearance') || '{}').fontSize,
  fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--ui-font-family').trim(),
}))()`);
let settingsScreenshot = 'unavailable';
try {
  const settingsShot = await command('Page.captureScreenshot', { format: 'png' }, 1500);
  await fs.writeFile(path.join(outputDir, 'settings-dark.png'), Buffer.from(settingsShot.data, 'base64'));
  settingsScreenshot = 'settings-dark.png';
} catch {}

const skillState = await evaluate(`(() => {
  document.querySelector('.settings-center-modal .ant-modal-close')?.click();
  const skillButton = [...document.querySelectorAll('.view-tabs .ant-segmented-item-label')]
    .find((button) => button.textContent?.includes('技能库'));
  skillButton?.click();
  return Boolean(skillButton);
})()`);
await delay(800);
const skillMetrics = await evaluate(`(() => ({
  total: document.querySelector('.skill-library-page-head span')?.textContent ?? '',
  tabs: [...document.querySelectorAll('.skill-library-tabs button')].map((button) => button.textContent?.trim()),
  cards: document.querySelectorAll('.skill-grid-card').length,
}))()`);
let skillsScreenshot = 'unavailable';
try {
  const skillsShot = await command('Page.captureScreenshot', { format: 'png' }, 1500);
  await fs.writeFile(path.join(outputDir, 'skills-dark.png'), Buffer.from(skillsShot.data, 'base64'));
  skillsScreenshot = 'skills-dark.png';
} catch {}

socket.close();
console.log(JSON.stringify({ openState, modalMetrics, appearanceState, appearanceDom, fontOptions, appearanceMetrics, skillState, skillMetrics, screenshots: { settingsScreenshot, skillsScreenshot }, outputDir }, null, 2));
