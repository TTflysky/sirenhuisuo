const fs = require('fs/promises');
const path = require('path');

const DEFAULT_VIEWPORTS = [
  { width: 1440, height: 900, label: 'desktop' },
  { width: 375, height: 844, label: 'narrow' },
];

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/gu, '/').split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*\p{Cc}]/gu, '_'))
    .join('/');
}

function normalizeViewport(input, index = 0) {
  const fallback = DEFAULT_VIEWPORTS[index] || DEFAULT_VIEWPORTS[DEFAULT_VIEWPORTS.length - 1];
  return {
    width: Math.min(2560, Math.max(320, Number(input?.width) || fallback.width)),
    height: Math.min(1600, Math.max(480, Number(input?.height) || fallback.height)),
    label: String(input?.label || fallback.label || `viewport-${index + 1}`).replace(/[^a-z0-9_-]/giu, '-').slice(0, 48),
  };
}

function resolveArtifactPath(workspaceRoot, workspaceId, artifactPath) {
  const root = path.resolve(workspaceRoot, normalizeRelative(workspaceId || 'global'));
  const target = path.resolve(root, normalizeRelative(artifactPath));
  if (!inside(path.resolve(workspaceRoot), root) || !inside(root, target)) throw new Error('网页产物路径越界');
  if (!/\.html?$/iu.test(target)) throw new Error('真实网页验收只支持 HTML 文件');
  return { root, target };
}

function probeLayout() {
  const usableWidth = Math.min(document.documentElement.clientWidth, window.visualViewport?.width || window.innerWidth);
  const visible = (item) => {
    const style = getComputedStyle(item);
    const rect = item.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const describe = (item) => {
    const rect = item.getBoundingClientRect();
    return {
      tag: item.tagName.toLowerCase(),
      id: String(item.id || '').slice(0, 80),
      className: String(item.className || '').slice(0, 120),
      text: String(item.textContent || '').trim().replace(/\s+/gu, ' ').slice(0, 80),
      left: Math.round(rect.left * 10) / 10,
      right: Math.round(rect.right * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
    };
  };
  const relevant = (item) => {
    const tag = item.tagName.toLowerCase();
    const text = String(item.textContent || '').trim();
    const role = item.getAttribute('role') || '';
    const className = String(item.className || '');
    return /^(?:a|button|input|select|textarea|main|section|article|aside|form|dialog)$/u.test(tag)
      || Boolean(role)
      || Boolean(text)
      || /(?:card|panel|modal|dialog|container|shell|board)/iu.test(className);
  };
  const items = [...document.body.querySelectorAll('*')].filter((item) => visible(item) && relevant(item));
  const overflowingElements = items.filter((item) => {
    const rect = item.getBoundingClientRect();
    return rect.left < -0.5 || rect.right > usableWidth + 0.5;
  }).slice(0, 30).map(describe);
  const clippedElements = items.filter((item) => {
    const rect = item.getBoundingClientRect();
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
  }).slice(0, 30).map(describe);
  const unsafeFramedElements = items.filter((item) => {
    const style = getComputedStyle(item);
    const rect = item.getBoundingClientRect();
    const tag = item.tagName.toLowerCase();
    const className = String(item.className || '');
    const primaryFrame = /^(?:main|section|article|aside|form|dialog)$/u.test(tag)
      || /(?:card|panel|modal|dialog|shell|board)/iu.test(className);
    if (!primaryFrame) return false;
    const borderWidth = Math.max(
      parseFloat(style.borderLeftWidth) || 0,
      parseFloat(style.borderRightWidth) || 0,
      parseFloat(style.borderTopWidth) || 0,
      parseFloat(style.borderBottomWidth) || 0,
    );
    const shadows = style.boxShadow === 'none' ? [] : style.boxShadow.split(/,(?![^()]*\))/u);
    if (borderWidth <= 0 && shadows.length === 0) return false;
    let shadowLeft = 0;
    let shadowRight = 0;
    for (const shadow of shadows) {
      if (/\binset\b/iu.test(shadow)) continue;
      const lengths = [...shadow.matchAll(/(-?\d*\.?\d+)px/gu)].map((match) => Number(match[1]));
      const [offsetX = 0, , blur = 0, spread = 0] = lengths;
      shadowLeft = Math.max(shadowLeft, Math.max(0, blur + spread - offsetX));
      shadowRight = Math.max(shadowRight, Math.max(0, blur + spread + offsetX));
    }
    return rect.left - shadowLeft < 8 || usableWidth - (rect.right + shadowRight) < 8;
  }).slice(0, 30).map(describe);
  const smallControls = items.filter((item) => /^(?:a|button|input|select|textarea)$/u.test(item.tagName.toLowerCase())).filter((item) => {
    const rect = item.getBoundingClientRect();
    return rect.width < 40 || rect.height < 40;
  }).slice(0, 30).map(describe);
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      visualWidth: window.visualViewport?.width || window.innerWidth,
      usableWidth,
    },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    overflowingElements,
    clippedElements,
    unsafeFramedElements,
    smallControls,
    interactiveControls: document.querySelectorAll('a,button,input,select,textarea').length,
  };
}

function summarizeVerification(viewports, runtimeErrors = []) {
  const failed = viewports.filter((item) => item.horizontalOverflow
    || item.overflowingElements.length
    || item.clippedElements.length
    || item.unsafeFramedElements.length);
  return {
    ok: failed.length === 0 && runtimeErrors.length === 0,
    checked: viewports.length,
    failed: failed.map((item) => item.label),
    runtimeErrors,
  };
}

function createWebArtifactVerifier(BrowserWindow, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  return async function verifyWebArtifact(input = {}) {
    const { root, target } = resolveArtifactPath(workspaceRoot, input.workspaceId, input.path);
    await fs.access(target);
    const viewports = (Array.isArray(input.viewports) && input.viewports.length ? input.viewports : DEFAULT_VIEWPORTS)
      .slice(0, 4).map(normalizeViewport);
    const outputDir = path.join(root, '.taiji-verification');
    await fs.mkdir(outputDir, { recursive: true });
    const stem = path.basename(target, path.extname(target)).replace(/[^a-z0-9_-]/giu, '-').slice(0, 80) || 'web-artifact';
    const results = [];
    const runtimeErrors = [];
    for (const viewport of viewports) {
      const window = new BrowserWindow({
        show: false,
        useContentSize: true,
        width: viewport.width,
        height: viewport.height,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: true, backgroundThrottling: false },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const consoleHandler = (_event, level, message) => {
        if (Number(level) >= 2) runtimeErrors.push(`${viewport.label}: ${String(message || '').slice(0, 500)}`);
      };
      window.webContents.on('console-message', consoleHandler);
      try {
        await window.loadFile(target);
        await new Promise((resolve) => setTimeout(resolve, Number(options.settleMs) || 350));
        const metrics = await window.webContents.executeJavaScript(`(${probeLayout.toString()})()`, true);
        const screenshotName = `${stem}-${viewport.label}-${viewport.width}x${viewport.height}.png`;
        const screenshotPath = path.join(outputDir, screenshotName);
        const image = await window.webContents.capturePage();
        const buffer = image.toPNG();
        await fs.writeFile(screenshotPath, buffer);
        results.push({ ...viewport, ...metrics, screenshot: path.relative(root, screenshotPath).replace(/\\/gu, '/'), screenshotPath, screenshotBytes: buffer.length });
      } catch (error) {
        runtimeErrors.push(`${viewport.label}: ${error?.message || String(error)}`);
      } finally {
        window.webContents.removeListener('console-message', consoleHandler);
        if (!window.isDestroyed()) window.destroy();
      }
    }
    const summary = summarizeVerification(results, runtimeErrors);
    return { ...summary, artifactPath: target, workspaceId: String(input.workspaceId || 'global'), viewports: results };
  };
}

module.exports = {
  DEFAULT_VIEWPORTS,
  createWebArtifactVerifier,
  normalizeViewport,
  resolveArtifactPath,
  summarizeVerification,
};
