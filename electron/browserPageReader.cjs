const BLOCKED_TEXT = /访问过于频繁|环境异常|完成验证|验证码|安全验证|人机验证|请在微信客户端打开|access denied|verify you are human|captcha/iu;

function createBrowserPageReader(BrowserWindow, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45000;
  return async function readPageWithBrowser(rawUrl) {
    const url = new URL(rawUrl).toString();
    const window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const timer = setTimeout(() => {
      if (!window.isDestroyed()) window.webContents.stop();
    }, timeoutMs);
    try {
      await window.loadURL(url, { userAgent: options.userAgent });
      await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 1800));
      const page = await window.webContents.executeJavaScript(`(() => {
        const preferred = document.querySelector('#js_content, article, main, [role="main"]');
        const node = preferred || document.body;
        return {
          url: location.href,
          title: document.title || '',
          content: (node?.innerText || '').replace(/\\n\\s*\\n+/g, '\\n\\n').trim(),
        };
      })()`, true);
      const content = String(page?.content ?? '').trim();
      if (!content || content.length < 80) throw new Error('浏览器已打开网页，但没有取得足够正文');
      if (BLOCKED_TEXT.test(content) && content.length < 8000) throw new Error('浏览器返回访问验证页面，没有取得原文正文');
      return { ok: true, url: page.url || url, title: page.title || new URL(url).hostname, content: content.slice(0, 50000) };
    } finally {
      clearTimeout(timer);
      if (!window.isDestroyed()) window.destroy();
    }
  };
}

module.exports = { createBrowserPageReader };
