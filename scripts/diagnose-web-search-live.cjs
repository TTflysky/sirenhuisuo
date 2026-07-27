const { app, net } = require('electron');
const { searchWeb } = require('../electron/knowledge.cjs');

async function run() {
  const query = process.argv.slice(2).join(' ').trim() || '今日 人工智能 最新资讯';
  const attempts = [];
  const startedAt = Date.now();
  try {
    const result = await searchWeb(query, {
      fetchImpl: (url, options) => net.fetch(url, options),
      onAttempt(event) { attempts.push(event); },
    });
    console.log(JSON.stringify({
      ok: true,
      provider: result.provider,
      resultCount: result.results.length,
      durationMs: result.durationMs,
      attempts,
      sample: result.results.slice(0, 3),
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      attempts,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
