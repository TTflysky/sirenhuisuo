import { useState, useMemo } from 'react';
import { loadTokenLog, clearTokenLog, type TokenLogEntry } from '../../data/hermesClient';

// 把 token 数格式化成 K/M
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const PALETTE = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#22d3ee', '#ec4899', '#64748b'];

export default function Analytics() {
  const [logs, setLogs] = useState<TokenLogEntry[]>(() => loadTokenLog());
  const [days, setDays] = useState(7);

  const refresh = () => setLogs(loadTokenLog());

  const stats = useMemo(() => {
    const cutoff = Date.now() - days * 86400000;
    const inRange = logs.filter((l) => l.ts >= cutoff);
    const total = inRange.reduce((s, l) => s + l.totalTokens, 0);
    const calls = inRange.length;
    const prompt = inRange.reduce((s, l) => s + l.promptTokens, 0);
    const completion = inRange.reduce((s, l) => s + l.completionTokens, 0);
    // 按天聚合
    const byDay = new Map<string, { prompt: number; completion: number }>();
    for (const l of inRange) {
      const k = dayKey(l.ts);
      const cur = byDay.get(k) ?? { prompt: 0, completion: 0 };
      cur.prompt += l.promptTokens;
      cur.completion += l.completionTokens;
      byDay.set(k, cur);
    }
    // 按模型聚合
    const byModel = new Map<string, number>();
    for (const l of inRange) {
      byModel.set(l.model, (byModel.get(l.model) ?? 0) + l.totalTokens);
    }
    const models = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
    // 高用量会话（按 label 聚合）
    const byLabel = new Map<string, { total: number; calls: number; model: string }>();
    for (const l of inRange) {
      const key = l.label ?? '(未标注)';
      const cur = byLabel.get(key) ?? { total: 0, calls: 0, model: l.model };
      cur.total += l.totalTokens;
      cur.calls += 1;
      byLabel.set(key, cur);
    }
    const sessions = [...byLabel.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);
    return { total, calls, prompt, completion, byDay, models, sessions, avg: calls ? Math.round(total / calls) : 0 };
  }, [logs, days]);

  // 趋势图数据（最近 N 天，补齐无数据日）
  const trendDays = useMemo(() => {
    const arr: { label: string; prompt: number; completion: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 86400000);
      const v = stats.byDay.get(k) ?? { prompt: 0, completion: 0 };
      arr.push({ label: k, ...v });
    }
    return arr;
  }, [stats, days]);
  const maxDay = Math.max(1, ...trendDays.map((d) => d.prompt + d.completion));

  // 模型占比环形图（SVG）
  const totalModel = Math.max(1, stats.models.reduce((s, [, v]) => s + v, 0));
  let acc = 0;
  const arcs = stats.models.map(([name, v], i) => {
    const frac = v / totalModel;
    const start = acc;
    acc += frac;
    return { name, v, frac, start, color: PALETTE[i % PALETTE.length] };
  });

  return (
    <div className="analytics">
      {/* 头部 */}
      <div className="analytics-head">
        <h2>📊 数据分析</h2>
        <span className="analytics-sub">
          {days} 天 · {fmt(stats.total)} tokens · {stats.calls} 次 API 调用
        </span>
        <div className="analytics-range">
          {[7, 30, 90].map((d) => (
            <button key={d} className={`range-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>
              {d} 天
            </button>
          ))}
          <button className="range-btn" onClick={refresh} title="刷新">⟳</button>
          <button
            className="range-btn danger"
            onClick={() => { if (confirm('清空全部 token 统计数据？')) { clearTokenLog(); refresh(); } }}
            title="清空统计"
          >
            🗑
          </button>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-label">总 Tokens</div>
          <div className="stat-value">{fmt(stats.total)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">API 调用</div>
          <div className="stat-value">{stats.calls.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">输入 Tokens</div>
          <div className="stat-value">{fmt(stats.prompt)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">输出 Tokens</div>
          <div className="stat-value">{fmt(stats.completion)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">平均 Token / 次</div>
          <div className="stat-value">{fmt(stats.avg)}</div>
        </div>
      </div>

      <div className="analytics-panels">
        {/* 趋势柱状图 */}
        <div className="panel">
          <div className="panel-title">Token 使用趋势</div>
          <div className="panel-sub">按天展示输入与输出 Token</div>
          <div className="trend-chart">
            {trendDays.map((d) => {
              const total = d.prompt + d.completion;
              const h = (total / maxDay) * 100;
              const ph = total ? (d.prompt / total) * h : 0;
              const ch = total ? (d.completion / total) * h : 0;
              return (
                <div key={d.label} className="trend-col" title={`${d.label}: ${total.toLocaleString()} tokens`}>
                  <div className="trend-bar-wrap">
                    <div className="trend-bar completion" style={{ height: `${ch}%` }} />
                    <div className="trend-bar prompt" style={{ height: `${ph}%` }} />
                  </div>
                  <div className="trend-label">{d.label}</div>
                </div>
              );
            })}
          </div>
          <div className="trend-legend">
            <span><i className="legend-dot" style={{ background: '#3b82f6' }} />输入</span>
            <span><i className="legend-dot" style={{ background: '#22c55e' }} />输出</span>
          </div>
        </div>

        {/* 模型占比 */}
        <div className="panel">
          <div className="panel-title">模型 Token 占比</div>
          <div className="panel-sub">按 Token 总量展示主要模型分布</div>
          {arcs.length === 0 ? (
            <div className="panel-empty">暂无数据</div>
          ) : (
            <div className="donut-wrap">
              <svg viewBox="0 0 42 42" className="donut">
                <circle cx="21" cy="21" r="15.9" fill="none" stroke="#eef0f6" strokeWidth="6" />
                {arcs.map((a) => (
                  <circle
                    key={a.name}
                    cx="21" cy="21" r="15.9" fill="none"
                    stroke={a.color} strokeWidth="6"
                    strokeDasharray={`${a.frac * 100} ${100 - a.frac * 100}`}
                    strokeDashoffset={25 - a.start * 100}
                  />
                ))}
              </svg>
              <div className="donut-legend">
                {arcs.map((a) => (
                  <div key={a.name} className="donut-legend-item">
                    <i className="legend-dot" style={{ background: a.color }} />
                    <span className="donut-name">{a.name}</span>
                    <span className="donut-pct">{(a.frac * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 高用量会话 */}
      <div className="panel">
        <div className="panel-title">高用量会话</div>
        <div className="panel-sub">按 Token 总量排序</div>
        {stats.sessions.length === 0 ? (
          <div className="panel-empty">暂无数据</div>
        ) : (
          <table className="session-table">
            <thead>
              <tr><th>会话</th><th>模型</th><th>调用次数</th><th style={{ textAlign: 'right' }}>Tokens</th></tr>
            </thead>
            <tbody>
              {stats.sessions.map(([label, v]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{v.model}</td>
                  <td>{v.calls}</td>
                  <td style={{ textAlign: 'right' }}>{v.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
