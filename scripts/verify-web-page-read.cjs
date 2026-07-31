const assert = require('node:assert/strict');
const { fetchKnowledgeUrl } = require('../electron/knowledge.cjs');

function response(body, options = {}) {
  return new Response(body, {
    status: options.status || 200,
    headers: { 'content-type': options.contentType || 'text/html; charset=utf-8' },
  });
}

async function main() {
  const url = 'https://mp.weixin.qq.com/s/6d_2gn2jK3lVTJaeookHkA';
  let seenUserAgent = '';
  const result = await fetchKnowledgeUrl(url, {
    fetchImpl: async (_target, init) => {
      seenUserAgent = init.headers['User-Agent'];
      return response('<html><head><title>测试文章</title></head><body><article><h1>测试文章</h1><p>这是从用户指定原始地址取得的正文内容。</p></article></body></html>');
    },
  });
  assert.equal(result.ok, true);
  assert.match(result.content, /原始地址取得的正文/u);
  assert.match(seenUserAgent, /Taiji-Office/u);

  await assert.rejects(
    () => fetchKnowledgeUrl(url, { fetchImpl: async () => response('<html><body>环境异常，请完成验证后继续访问。</body></html>') }),
    /访问验证或拦截页面/u,
  );
  await assert.rejects(
    () => fetchKnowledgeUrl(url, { fetchImpl: async () => response('') }),
    /没有返回可读取的正文/u,
  );

  console.log(JSON.stringify({ passed: true, exactPageBody: true, challengeRejected: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
