const assert = require('assert/strict');
const http = require('http');
const { searchWeb, parseBingRss, parseDuckDuckGoHtml } = require('../electron/knowledge.cjs');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss><channel><item>
  <title><![CDATA[今日 AI &amp; 模型进展]]></title>
  <link>https://example.com/ai-news</link>
  <description><![CDATA[包含 <b>可核验</b> 来源。]]></description>
</item></channel></rss>`;

const duckHtml = `<!doctype html><html><body>
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Ffallback">备用 AI 资料</a>
  <a class="result__snippet">备用搜索源返回的摘要。</a>
</div>
</body></html>`;

async function run() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/bing') {
      response.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      response.end(rss);
      return;
    }
    if (request.url === '/slow') {
      setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
        response.end(rss);
      }, 150);
      return;
    }
    if (request.url === '/duck') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(duckHtml);
      return;
    }
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('unavailable');
  });

  try {
    const port = await listen(server);
    const root = `http://127.0.0.1:${port}`;
    const bingProvider = { name: 'Bing test', url: `${root}/bing`, headers: {}, parse: parseBingRss };
    const slowProvider = { name: 'Slow test', url: `${root}/slow`, headers: {}, parse: parseBingRss };
    const duckProvider = { name: 'Duck test', url: `${root}/duck`, headers: {}, parse: parseDuckDuckGoHtml };
    const failedProvider = { name: 'Failed test', url: `${root}/fail`, headers: {}, parse: parseBingRss };

    const parsed = parseBingRss(rss);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title, '今日 AI & 模型进展');
    assert.equal(parsed[0].snippet, '包含 可核验 来源。');

    const direct = await searchWeb('今日 AI 资讯', {
      providers: [bingProvider],
      attemptsPerProvider: 1,
      timeoutMs: 1000,
    });
    assert.equal(direct.provider, 'Bing test');
    assert.equal(direct.results[0].url, 'https://example.com/ai-news');

    const fallback = await searchWeb('最新模型新闻', {
      providers: [slowProvider, duckProvider],
      attemptsPerProvider: 1,
      timeoutMs: 30,
    });
    assert.equal(fallback.provider, 'Duck test');
    assert.equal(fallback.results[0].url, 'https://example.org/fallback');
    assert.match(fallback.warnings.join('\n'), /Slow test.*连接超时/u);

    await assert.rejects(searchWeb('失败诊断', {
      providers: [failedProvider, { ...failedProvider, name: 'Second failed test' }],
      attemptsPerProvider: 1,
      timeoutMs: 1000,
    }), /Failed test.*HTTP 503.*Second failed test.*HTTP 503/u);

    const guardrails = await import('../src/engine/agentGuardrails.mjs');
    assert.equal(guardrails.requiresFreshWebResearch('联网搜索一下今天的 AI 资讯'), true);
    assert.equal(guardrails.isConversationOnlyMessage('联网搜索一下今天的 AI 资讯'), false);
    assert.equal(guardrails.buildFreshWebQuery('联网搜索一下今天的 AI 资讯，然后给我做今日简报'), '今天的 AI 资讯');
    assert.equal(guardrails.requiresFreshWebResearch('为什么他没有调用查询工具？'), false);
    assert.equal(guardrails.isConversationOnlyMessage('为什么他没有调用查询工具？'), true);

    console.log(JSON.stringify({
      passed: true,
      directProvider: direct.provider,
      fallbackProvider: fallback.provider,
      requests,
    }, null, 2));
  } finally {
    await close(server).catch(() => {});
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
