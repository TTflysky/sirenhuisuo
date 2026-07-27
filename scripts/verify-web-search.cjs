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
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Ffallback">2026 备用 AI 新闻</a>
  <a class="result__snippet">备用搜索源返回的新闻摘要。</a>
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
    assert.equal(guardrails.isResearchOnlyRequest('搜索一下今天的 AI 热点资讯，5 条总结发给我，带上链接'), true);
    assert.equal(guardrails.isResearchOnlyRequest('搜索最新 Electron 文档，然后修改项目代码'), false);
    assert.equal(guardrails.buildFreshWebQuery('联网搜索一下今天的 AI 资讯，然后给我做今日简报'), '今天的 AI 资讯');
    assert.equal(guardrails.buildFreshWebQuery('搜索一下今天的AI热点资讯，5条总结发给我，带上链接。'), '今天的AI热点资讯');
    assert.equal(guardrails.requiresFreshWebResearch('为什么他没有调用查询工具？'), false);
    assert.equal(guardrails.isConversationOnlyMessage('为什么他没有调用查询工具？'), true);
    assert.equal(guardrails.requiresFreshWebResearch('那你提炼一下最新的热点然后跟我说，直接给我内容就好'), true);
    assert.equal(guardrails.buildFreshWebQuery('那你提炼一下最新的热点然后跟我说，直接给我内容就好'), '最新的热点');
    assert.equal(guardrails.buildFreshWebQuery('查看一下今天的天气情况，安徽省滁州市全椒县'), '今天的天气情况，安徽省滁州市全椒县');
    assert.deepEqual(guardrails.extractResearchSources(`搜索结果：\n\n1. 示例资讯\nhttps://example.com/news\n摘要`, 1), [{ title: '示例资讯', url: 'https://example.com/news', snippet: '摘要' }]);
    assert.equal(guardrails.isResearchDeliveryDeflection('目前不能可靠提供热点，前面只拿到了资讯入口，没有拿到具体新闻标题和正文。请把链接发给我。'), true);
    assert.equal(guardrails.isResearchDeliveryDeflection('这是三条热点的内容摘要，并附有可点击来源。'), false);

    const researchFallback = guardrails.buildResearchFallback('给我 1 条，带链接', `搜索结果（来源：DuckDuckGo HTML，1264ms）：\n\n1. 示例资讯\nhttps://example.com/news\n这是可核验的资讯摘要。`, '模型超时');
    assert.match(researchFallback, /搜索完成.*示例资讯.*这是可核验的资讯摘要.*\[查看来源\]\(https:\/\/example\.com\/news\)/su);
    const noSnippetFallback = guardrails.buildResearchFallback('给我 1 条', `搜索结果：\n\n1. 只有标题\nhttps://example.com/title\n`);
    assert.doesNotMatch(noSnippetFallback, /请打开来源/u);
    const linked = guardrails.ensureResearchSourceLinks('这是整理后的摘要。', '给我 1 条', `搜索结果：\n\n1. 示例资讯\nhttps://example.com/news\n摘要`);
    assert.match(linked, /\*\*来源链接\*\*.*https:\/\/example\.com\/news/su);

    const offTargetWeather = `搜索结果：\n\n1. 安徽省_百度百科\nhttps://example.com/anhui\n安徽省位于中国东部。`;
    assert.equal(guardrails.isResearchEvidenceRelevant('查看一下今天的天气情况，安徽省滁州市全椒县', offTargetWeather), false);
    assert.match(guardrails.buildResearchFallback('查看一下今天的天气情况，安徽省滁州市全椒县', offTargetWeather), /拦截这些偏题结果/u);

    const weatherPayload = {
      current_condition: [{ temp_C: '29', FeelsLikeC: '37', humidity: '89', winddir16Point: 'ESE', windspeedKmph: '10', weatherCode: '113', weatherDesc: [{ value: 'Clear' }], uvIndex: '0' }],
      nearest_area: [{ areaName: [{ value: 'Chuanchiaohsien' }], country: [{ value: 'China' }], region: [{ value: 'Anhui' }], latitude: '32.098', longitude: '118.258' }],
      weather: [{ date: '2026-07-28', mintempC: '25', maxtempC: '27', uvIndex: '2', hourly: [{ chanceofrain: '26' }] }],
    };
    const weather = await searchWeb('今天 安徽省滁州市全椒县 天气', {
      fetchImpl: async (url) => {
        assert.match(String(url), /wttr\.in\/.*%E5%85%A8%E6%A4%92%E5%8E%BF/iu);
        return new Response(JSON.stringify(weatherPayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      timeoutMs: 1000,
    });
    assert.equal(weather.provider, 'wttr.in 实时天气');
    assert.match(weather.results[0].snippet, /全椒县.*2026-07-28.*29°C.*湿度 89%/u);

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
