import React from 'react';
import { createRoot } from 'react-dom/client';
import ThoughtChainView from '../../src/components/chat/ThoughtChainView';
import type { ThoughtChainStep } from '../../src/types';
import '../../src/theme.css';

const fixtureTheme = new URLSearchParams(window.location.search).get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = fixtureTheme;
document.documentElement.dataset.colorMode = fixtureTheme;

const now = Date.now();
const longResult = [
  '# SkillHub 安装与完整配置',
  '',
  '## 结论',
  '已读取官方说明并核对依赖。下面保留完整来源、安装步骤、验证结果和发生错误时的替代路线。',
  '',
  ...Array.from({ length: 34 }, (_, index) => `- 检查项 ${String(index + 1).padStart(2, '0')}：确认配置字段、工作区路径和连接状态。`),
  '',
  '参考地址：https://www.skillhub.cn/',
].join('\n');

const steps: ThoughtChainStep[] = [
  {
    toolName: 'read_skill',
    args: JSON.stringify({ id: 'skillhub-installation-guide', includeReferences: true, workspace: 'L:/AI办公室/太极/技能安装验证工作区' }),
    result: longResult,
    success: true,
    timestamp: now - 3000,
  },
  {
    toolName: 'run_command',
    args: JSON.stringify({ cmd: 'npm.cmd run verify:execution-detail-ui -- --full-output --preserve-raw-log', cwd: 'L:/AI办公室/太极/这是一个用于验证横向滚动的很长目录名称' }),
    result: [
      'npm.cmd run verify:execution-detail-ui',
      'const configuration = { connector: "ima", workspace: "L:/AI办公室/太极/这是一个用于验证横向滚动的很长目录名称", enabled: true };',
      '验证完成：配置文件存在，连接测试通过，产出物已经登记。',
    ].join('\n'),
    success: true,
    timestamp: now - 2000,
  },
  {
    toolName: 'test_connector',
    args: JSON.stringify({ connectorId: 'ima-knowledge' }),
    result: '连接验证失败：当前电脑还没有完成 IMA 登录授权。请打开连接器设置完成授权后重试。',
    success: false,
    timestamp: now - 1000,
  },
];

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main style={{ width: '100vw', minHeight: '100vh', padding: 28, background: 'var(--bg)', color: 'var(--text)' }}>
    <div style={{ width: 'min(920px, 100%)', margin: '0 auto' }}>
      <div className="msg assistant-live-report" style={{ width: '100%', maxWidth: '100%' }}>
        <div className="msg-meta"><span className="msg-author">章北海助理</span></div>
        <div className="msg-bubble">执行记录已经整理好，详细参数和原始结果可以在下方查看。</div>
        <ThoughtChainView steps={steps} />
      </div>
    </div>
    </main>
  </React.StrictMode>,
);
