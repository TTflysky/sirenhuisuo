const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const ECOSYSTEM_HEALTH_VERSION = 1;

function result(id, title, status, summary, detail, critical = false) {
  return { id, title, status, summary, detail, critical };
}

function createEcosystemHealth(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot);

  async function identityCheck() {
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
      const valid = packageJson.version === options.appVersion
        && packageJson.name === 'hermes-office-pro'
        && packageJson.build?.appId === 'com.hermes.office'
        && /太极/u.test(String(packageJson.build?.productName || ''));
      return result('identity', '版本与数据身份', valid ? 'ready' : 'blocked', valid ? `太极 v${options.appVersion}，兼容数据身份保持不变` : '版本或内部数据身份不一致',
        valid ? '对外品牌为太极；内部 name、appId 与旧存储键未改动。' : 'package 版本、name、appId 或 productName 不符合迁移边界。', true);
    } catch (error) { return result('identity', '版本与数据身份', 'blocked', '无法读取应用身份', error?.message || String(error), true); }
  }

  async function taskStoreCheck() {
    const snapshot = await options.store.read();
    if (!snapshot.ok || !snapshot.integrity?.ok) return result('task-store', '任务账本与恢复', 'blocked', '任务事实源不可用', snapshot.error || '任务账本完整性失败', true);
    const rebuilt = snapshot.integrity.recovered || snapshot.integrity.snapshotRebuilt || snapshot.integrity.indexRebuilt;
    return result('task-store', '任务账本与恢复', rebuilt ? 'warning' : 'ready',
      `${snapshot.integrity.eventCount} 条事件，Schema v${snapshot.schemaVersion}`,
      rebuilt ? '已从最后一个有效事件自动重建快照或索引；历史仍可审计。' : '哈希链、快照校验、查询索引和恢复投影均正常。', true);
  }

  async function workerCheck() {
    const status = await options.worker.status();
    if (!status.ok || status.integrity?.ok === false) return result('worker', '后台任务 Worker', 'blocked', '后台控制平面不可用', status.error || 'Worker 命令日志完整性失败', true);
    return result('worker', '后台任务 Worker', status.integrity?.recovered ? 'warning' : 'ready',
      `${status.activeRuns?.length || 0} 个活动任务，${status.pendingCommands || 0} 条待处理命令`,
      status.integrity?.recovered ? '命令日志损坏尾部已隔离，建议核对最近一次任务状态。' : '租约、心跳、暂停、恢复和命令日志正常。', true);
  }

  async function toolCheck() {
    try {
      const module = await import(pathToFileURL(path.join(projectRoot, 'src/engine/toolRegistry.mjs')).href);
      const registry = module.buildToolRegistry(options.toolRuntime.definitions || []);
      const status = registry.ready > 0 && registry.blocked === 0 ? 'ready' : 'blocked';
      return result('tools', '统一工具注册', status, `${registry.ready} 个可用，${registry.blocked} 个隔离`,
        status === 'ready' ? `协议 v${registry.protocolVersion}；名称、Schema 与来源完整。` : `冲突：${registry.collisions.join('、') || '无'}；损坏：${registry.invalid.map((item) => item.name).join('、') || '无'}`, true);
    } catch (error) { return result('tools', '统一工具注册', 'blocked', '无法构建工具注册表', error?.message || String(error), true); }
  }

  async function skillCheck() {
    try {
      const skills = await options.listSkills(projectRoot);
      const broken = skills.filter((skill) => skill.health === 'broken');
      const setup = skills.filter((skill) => skill.health === 'setup' || skill.health === 'limited');
      const status = skills.length === 0 ? 'blocked' : broken.length ? 'warning' : 'ready';
      return result('skills', '安装内置 Skill', status, `${skills.length} 个 Skill，${broken.length} 个损坏，${setup.length} 个需配置`,
        broken.length ? `损坏技能已隔离：${broken.slice(0, 8).map((skill) => skill.name).join('、')}` : '技能清单可读取；需账号或外部软件的 Skill 不会冒充开箱可用。', skills.length === 0);
    } catch (error) { return result('skills', '安装内置 Skill', 'blocked', '无法扫描安装 Skill', error?.message || String(error), true); }
  }

  async function workspaceCheck() {
    const probeDir = path.join(workspaceRoot, 'diagnostics', 'ecosystem-health');
    const probe = path.join(probeDir, `probe-${process.pid}.txt`);
    try {
      await fs.mkdir(probeDir, { recursive: true });
      const nonce = `taiji-${Date.now()}`;
      await fs.writeFile(probe, nonce, 'utf8');
      const read = await fs.readFile(probe, 'utf8');
      await fs.rm(probe, { force: true });
      if (read !== nonce) throw new Error('工作区写入后读回内容不一致');
      return result('workspace', '物理任务工作区', 'ready', '创建、写入、读回与清理正常', workspaceRoot, true);
    } catch (error) { return result('workspace', '物理任务工作区', 'blocked', '工作区不可写', error?.message || String(error), true); }
  }

  async function worktreeCheck() {
    const health = await options.worktreeManager.health();
    return result('worktree', 'Git 代码隔离', health.ok ? 'ready' : 'warning', health.ok ? `${health.version}，${health.active} 个活动 Worktree` : 'Git Worktree 当前不可用',
      health.ok ? health.worktreesRoot : `${health.error}。不影响普通文件和知识库任务。`, false);
  }

  async function run(input = {}) {
    const settled = await Promise.allSettled([identityCheck(), taskStoreCheck(), workerCheck(), toolCheck(), skillCheck(), workspaceCheck(), worktreeCheck()]);
    const ids = ['identity', 'task-store', 'worker', 'tools', 'skills', 'workspace', 'worktree'];
    const checks = settled.map((item, index) => item.status === 'fulfilled' ? item.value : result(ids[index], ids[index], 'blocked', '检查过程异常', item.reason?.message || String(item.reason), true));
    const blocked = checks.filter((item) => item.status === 'blocked');
    const warning = checks.filter((item) => item.status === 'warning');
    const criticalBlocked = blocked.filter((item) => item.critical);
    return {
      ok: criticalBlocked.length === 0,
      healthVersion: ECOSYSTEM_HEALTH_VERSION,
      mode: input.mode === 'release' ? 'release' : 'runtime',
      appVersion: options.appVersion,
      checkedAt: Date.now(),
      status: criticalBlocked.length ? 'blocked' : warning.length || blocked.length ? 'warning' : 'ready',
      canRelease: criticalBlocked.length === 0,
      ready: checks.filter((item) => item.status === 'ready').length,
      warning: warning.length,
      blocked: blocked.length,
      checks,
    };
  }

  return { run };
}

module.exports = { ECOSYSTEM_HEALTH_VERSION, createEcosystemHealth };
