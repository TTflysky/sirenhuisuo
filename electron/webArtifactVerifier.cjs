const fs = require('fs/promises');
const path = require('path');

const DEFAULT_VIEWPORTS = [
  { width: 1440, height: 900, label: 'desktop' },
  { width: 375, height: 844, label: 'narrow' },
];

const SEMANTIC_CHECK_TYPES = new Set(['group', 'order', 'adjacent', 'grid', 'interaction']);

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

function normalizeSemanticChecks(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 40).flatMap((raw, index) => {
    const type = String(raw?.type || '').trim().toLowerCase();
    if (!SEMANTIC_CHECK_TYPES.has(type)) return [];
    const check = {
      ...raw,
      type,
      id: String(raw?.id || `${type}-${index + 1}`).trim().slice(0, 80),
      label: String(raw?.label || raw?.id || `${type}-${index + 1}`).trim().slice(0, 160),
      viewports: Array.isArray(raw?.viewports)
        ? raw.viewports.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
        : [],
    };
    if (type === 'group') {
      check.container = String(raw?.container || '').trim().slice(0, 500);
      check.members = Array.isArray(raw?.members) ? raw.members.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 80) : [];
    } else if (type === 'order') {
      check.selectors = Array.isArray(raw?.selectors) ? raw.selectors.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 80) : [];
      check.axis = ['dom', 'horizontal', 'vertical', 'reading'].includes(raw?.axis) ? raw.axis : 'dom';
      check.tolerance = Math.min(100, Math.max(0, Number(raw?.tolerance) || 8));
    } else if (type === 'adjacent') {
      check.first = String(raw?.first || '').trim().slice(0, 500);
      check.second = String(raw?.second || '').trim().slice(0, 500);
      check.direction = ['left', 'right', 'above', 'below'].includes(raw?.direction) ? raw.direction : 'right';
      check.maxGap = Math.min(2000, Math.max(0, Number(raw?.maxGap) || 160));
      check.tolerance = Math.min(100, Math.max(0, Number(raw?.tolerance) || 8));
    } else if (type === 'grid') {
      check.container = String(raw?.container || '').trim().slice(0, 500);
      check.cells = Array.isArray(raw?.cells) ? raw.cells.slice(0, 120).map((cell) => ({
        selector: String(cell?.selector || '').trim().slice(0, 500),
        row: Math.max(1, Math.min(100, Number(cell?.row) || 1)),
        column: Math.max(1, Math.min(100, Number(cell?.column) || 1)),
      })).filter((cell) => cell.selector) : [];
      check.rowTolerance = Math.min(100, Math.max(1, Number(raw?.rowTolerance) || 12));
      check.columnTolerance = Math.min(100, Math.max(1, Number(raw?.columnTolerance) || 12));
    } else if (type === 'interaction') {
      check.steps = Array.isArray(raw?.steps) ? raw.steps.slice(0, 30).map((step) => ({
        action: ['click', 'input', 'select', 'check'].includes(step?.action) ? step.action : 'click',
        selector: String(step?.selector || '').trim().slice(0, 500),
        value: String(step?.value ?? '').slice(0, 2000),
        waitMs: Math.min(2000, Math.max(0, Number(step?.waitMs) || 0)),
      })).filter((step) => step.selector) : [];
      check.assertions = Array.isArray(raw?.assertions) ? raw.assertions.slice(0, 30).map((assertion) => ({
        selector: String(assertion?.selector || '').trim().slice(0, 500),
        property: ['text', 'value', 'visible', 'hidden', 'checked', 'attribute'].includes(assertion?.property) ? assertion.property : 'text',
        equals: assertion?.equals === undefined ? undefined : String(assertion.equals).slice(0, 2000),
        includes: assertion?.includes === undefined ? undefined : String(assertion.includes).slice(0, 2000),
        attribute: String(assertion?.attribute || '').trim().slice(0, 120),
      })).filter((assertion) => assertion.selector) : [];
    }
    return [check];
  });
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

async function probeSemantics(checks, viewportLabel) {
  const round = (value) => Math.round(value * 10) / 10;
  const describe = (item) => {
    if (!item) return null;
    const rect = item.getBoundingClientRect();
    return {
      tag: item.tagName.toLowerCase(), id: String(item.id || '').slice(0, 80),
      text: String(item.textContent || '').trim().replace(/\s+/gu, ' ').slice(0, 120),
      left: round(rect.left), top: round(rect.top), width: round(rect.width), height: round(rect.height),
    };
  };
  const visible = (item) => {
    if (!item) return false;
    const style = getComputedStyle(item);
    const rect = item.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const select = (selector) => {
    try { return document.querySelector(selector); } catch (error) { throw new Error(`无效选择器 ${selector}: ${error.message}`); }
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clusterRanks = (values, tolerance) => {
    const clusters = [];
    [...values].sort((a, b) => a - b).forEach((value) => {
      const current = clusters.find((cluster) => Math.abs(cluster.center - value) <= tolerance);
      if (current) {
        current.values.push(value);
        current.center = current.values.reduce((sum, item) => sum + item, 0) / current.values.length;
      } else clusters.push({ center: value, values: [value] });
    });
    return clusters.sort((a, b) => a.center - b.center).map((cluster) => cluster.center);
  };
  const results = [];
  for (const check of checks) {
    if (check.viewports?.length && !check.viewports.includes(viewportLabel)) continue;
    const failures = [];
    const evidence = {};
    try {
      if (check.type === 'group') {
        const container = select(check.container);
        if (!container || !visible(container)) failures.push(`找不到可见分组容器 ${check.container}`);
        const members = check.members.map((selector) => ({ selector, element: select(selector) }));
        for (const member of members) {
          if (!member.element || !visible(member.element)) failures.push(`找不到可见成员 ${member.selector}`);
          else if (container && !container.contains(member.element)) failures.push(`${member.selector} 不属于 ${check.container}`);
        }
        evidence.container = describe(container);
        evidence.members = members.map((item) => ({ selector: item.selector, element: describe(item.element) }));
      } else if (check.type === 'order') {
        const entries = check.selectors.map((selector, index) => ({ selector, index, element: select(selector) }));
        entries.filter((entry) => !entry.element || !visible(entry.element)).forEach((entry) => failures.push(`找不到可见元素 ${entry.selector}`));
        const present = entries.filter((entry) => entry.element && visible(entry.element));
        const domOrder = [...present].sort((a, b) => a.element === b.element ? 0 : (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        let actual = domOrder;
        if (check.axis !== 'dom') {
          actual = [...present].sort((a, b) => {
            const ar = a.element.getBoundingClientRect();
            const br = b.element.getBoundingClientRect();
            if (check.axis === 'horizontal') return Math.abs(ar.left - br.left) > check.tolerance ? ar.left - br.left : ar.top - br.top;
            if (check.axis === 'vertical') return Math.abs(ar.top - br.top) > check.tolerance ? ar.top - br.top : ar.left - br.left;
            return Math.abs(ar.top - br.top) > check.tolerance ? ar.top - br.top : ar.left - br.left;
          });
        }
        if (actual.some((entry, index) => entry.index !== index)) failures.push(`实际顺序为 ${actual.map((entry) => entry.selector).join(' -> ')}`);
        evidence.actualOrder = actual.map((entry) => ({ selector: entry.selector, element: describe(entry.element) }));
      } else if (check.type === 'adjacent') {
        const first = select(check.first);
        const second = select(check.second);
        if (!first || !visible(first)) failures.push(`找不到可见元素 ${check.first}`);
        if (!second || !visible(second)) failures.push(`找不到可见元素 ${check.second}`);
        if (first && second) {
          const a = first.getBoundingClientRect();
          const b = second.getBoundingClientRect();
          const rules = {
            right: { order: b.left + check.tolerance >= a.right, gap: b.left - a.right },
            left: { order: a.left + check.tolerance >= b.right, gap: a.left - b.right },
            below: { order: b.top + check.tolerance >= a.bottom, gap: b.top - a.bottom },
            above: { order: a.top + check.tolerance >= b.bottom, gap: a.top - b.bottom },
          };
          const relation = rules[check.direction];
          if (!relation.order || relation.gap > check.maxGap) failures.push(`${check.second} 未处于 ${check.first} 的 ${check.direction} 相邻位置`);
          evidence.gap = round(relation.gap);
        }
        evidence.first = describe(first);
        evidence.second = describe(second);
      } else if (check.type === 'grid') {
        const container = check.container ? select(check.container) : document.body;
        if (!container || !visible(container)) failures.push(`找不到可见网格容器 ${check.container}`);
        const cells = check.cells.map((cell) => ({ ...cell, element: select(cell.selector) }));
        cells.filter((cell) => !cell.element || !visible(cell.element)).forEach((cell) => failures.push(`找不到可见网格单元 ${cell.selector}`));
        const present = cells.filter((cell) => cell.element && visible(cell.element) && (!container || container.contains(cell.element)));
        if (present.length !== cells.filter((cell) => cell.element && visible(cell.element)).length) failures.push('存在不属于指定网格容器的单元');
        const centers = present.map((cell) => {
          const rect = cell.element.getBoundingClientRect();
          return { ...cell, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        const rows = clusterRanks(centers.map((cell) => cell.y), check.rowTolerance);
        const columns = clusterRanks(centers.map((cell) => cell.x), check.columnTolerance);
        for (const cell of centers) {
          const actualRow = rows.reduce((best, center, index) => Math.abs(center - cell.y) < Math.abs(rows[best] - cell.y) ? index : best, 0) + 1;
          const actualColumn = columns.reduce((best, center, index) => Math.abs(center - cell.x) < Math.abs(columns[best] - cell.x) ? index : best, 0) + 1;
          if (actualRow !== cell.row || actualColumn !== cell.column) failures.push(`${cell.selector} 期望第 ${cell.row} 行第 ${cell.column} 列，实际第 ${actualRow} 行第 ${actualColumn} 列`);
        }
        evidence.cells = centers.map((cell) => ({ selector: cell.selector, expected: [cell.row, cell.column], element: describe(cell.element) }));
      } else if (check.type === 'interaction') {
        for (const step of check.steps) {
          const element = select(step.selector);
          if (!element || !visible(element)) { failures.push(`交互目标不可用 ${step.selector}`); break; }
          if (step.action === 'click') element.click();
          else if (step.action === 'check') { element.checked = step.value !== 'false'; element.dispatchEvent(new Event('change', { bubbles: true })); }
          else {
            element.value = step.value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await delay(step.waitMs || 30);
        }
        for (const assertion of check.assertions) {
          const element = select(assertion.selector);
          if (!element) { failures.push(`断言目标不存在 ${assertion.selector}`); continue; }
          let actual;
          if (assertion.property === 'text') actual = String(element.textContent || '').trim().replace(/\s+/gu, ' ');
          else if (assertion.property === 'value') actual = String(element.value ?? '');
          else if (assertion.property === 'visible') actual = String(visible(element));
          else if (assertion.property === 'hidden') actual = String(!visible(element));
          else if (assertion.property === 'checked') actual = String(Boolean(element.checked));
          else actual = String(element.getAttribute(assertion.attribute) ?? '');
          if (assertion.equals !== undefined && actual !== assertion.equals) failures.push(`${assertion.selector} 的 ${assertion.property} 期望等于“${assertion.equals}”，实际为“${actual.slice(0, 200)}”`);
          if (assertion.includes !== undefined && !actual.includes(assertion.includes)) failures.push(`${assertion.selector} 的 ${assertion.property} 未包含“${assertion.includes}”`);
        }
        evidence.steps = check.steps.length;
        evidence.assertions = check.assertions.length;
      }
    } catch (error) {
      failures.push(error?.message || String(error));
    }
    results.push({ id: check.id, label: check.label, type: check.type, ok: failures.length === 0, failures, evidence });
  }
  return { checked: results.length, passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}

function summarizeVerification(viewports, runtimeErrors = []) {
  const failed = viewports.filter((item) => item.horizontalOverflow
    || item.overflowingElements.length
    || item.clippedElements.length
    || item.unsafeFramedElements.length
    || Number(item.semantic?.failed) > 0);
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
    const semanticChecks = normalizeSemanticChecks(input.semanticChecks);
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
        const semantic = await window.webContents.executeJavaScript(`(${probeSemantics.toString()})(${JSON.stringify(semanticChecks)}, ${JSON.stringify(viewport.label)})`, true);
        const screenshotName = `${stem}-${viewport.label}-${viewport.width}x${viewport.height}.png`;
        const screenshotPath = path.join(outputDir, screenshotName);
        const image = await window.webContents.capturePage();
        const buffer = image.toPNG();
        await fs.writeFile(screenshotPath, buffer);
        results.push({ ...viewport, ...metrics, semantic, screenshot: path.relative(root, screenshotPath).replace(/\\/gu, '/'), screenshotPath, screenshotBytes: buffer.length });
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
  normalizeSemanticChecks,
  probeSemantics,
  resolveArtifactPath,
  summarizeVerification,
};
