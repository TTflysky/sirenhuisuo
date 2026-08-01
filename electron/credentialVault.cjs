const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const VAULT_SCHEMA = 1;

function createCredentialVault(options = {}) {
  const root = path.resolve(options.root || path.join(process.cwd(), 'credential-vault'));
  const safeStorage = options.safeStorage;
  const encryptionAvailable = () => Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
  const fileFor = (ref) => path.join(root, `${crypto.createHash('sha256').update(String(ref)).digest('hex')}.bin`);
  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('凭据必须是对象');
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(key)) throw new Error(`凭据字段名无效：${key}`);
      const text = String(raw ?? '');
      if (text.length > 10000) throw new Error(`凭据字段过长：${key}`);
      out[key] = text;
    }
    return out;
  }
  async function save(ref, credentials, options = {}) {
    if (!encryptionAvailable()) throw new Error('系统加密不可用，已拒绝保存明文凭据');
    const id = String(ref || '').trim();
    if (!id) throw new Error('凭据引用不能为空');
    const expiresAt = options.expiresAt ? new Date(options.expiresAt).toISOString() : undefined;
    const scopes = Array.isArray(options.scopes) ? options.scopes.map(String).filter(Boolean).slice(0, 50) : [];
    const payload = { schema: VAULT_SCHEMA, ref: id, savedAt: new Date().toISOString(), expiresAt, scopes, credentials: normalize(credentials) };
    await fs.mkdir(root, { recursive: true });
    const target = fileFor(id);
    const temp = `${target}.tmp-${process.pid}`;
    await fs.writeFile(temp, safeStorage.encryptString(JSON.stringify(payload)));
    await fs.rename(temp, target);
    return { ok: true, credentialRef: id, savedAt: payload.savedAt, expiresAt, scopes, fields: Object.keys(payload.credentials) };
  }
  async function read(ref) {
    if (!encryptionAvailable()) throw new Error('系统加密不可用，无法读取凭据');
    const id = String(ref || '').trim();
    if (!id) throw new Error('凭据引用不能为空');
    const encrypted = await fs.readFile(fileFor(id));
    const payload = JSON.parse(safeStorage.decryptString(encrypted));
    if (payload?.schema !== VAULT_SCHEMA || payload.ref !== id) throw new Error('凭据保险库记录无效');
    if (payload.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) throw new Error('凭据已过期，请重新配置');
    return payload.credentials || {};
  }
  async function remove(ref) { await fs.rm(fileFor(String(ref || '').trim()), { force: true }); return { ok: true }; }
  async function status(ref) {
    const id = String(ref || '').trim();
    if (!id) return { ok: false, available: encryptionAvailable(), configured: false };
    try {
      const stat = await fs.stat(fileFor(id));
      let metadata = {};
      try { const payload = JSON.parse(safeStorage.decryptString(await fs.readFile(fileFor(id)))); metadata = { expiresAt: payload.expiresAt, scopes: payload.scopes || [] }; } catch { metadata = {}; }
      const expired = Boolean(metadata.expiresAt && Date.parse(metadata.expiresAt) <= Date.now());
      return { ok: true, available: encryptionAvailable(), configured: stat.isFile(), credentialRef: id, updatedAt: stat.mtime.toISOString(), ...metadata, expired };
    }
    catch { return { ok: true, available: encryptionAvailable(), configured: false, credentialRef: id }; }
  }
  async function migrate(ref, legacyCredentials) {
    const id = String(ref || '').trim();
    if (!id || !legacyCredentials || Object.keys(legacyCredentials).length === 0) return { ok: true, migrated: false };
    const current = await status(id);
    if (current.configured) return { ok: true, migrated: false, reason: 'already-configured' };
    await save(id, legacyCredentials);
    return { ok: true, migrated: true, credentialRef: id };
  }
  async function rotate(ref, credentials, options = {}) {
    const before = await status(ref);
    const result = await save(ref, credentials, options);
    return { ...result, rotated: Boolean(before.configured), previousUpdatedAt: before.updatedAt };
  }
  async function audit(ref, options = {}) {
    const state = await status(ref);
    const requiredScopes = Array.isArray(options.requiredScopes) ? options.requiredScopes.map(String) : [];
    const missingScopes = requiredScopes.filter((scope) => !(state.scopes || []).includes(scope));
    return { credentialRef: String(ref || ''), configured: state.configured, available: state.available, expired: Boolean(state.expired), missingScopes, leastPrivilege: missingScopes.length === 0 && (state.scopes || []).length > 0, recordedAt: new Date().toISOString() };
  }
  return { save, read, remove, status, migrate, rotate, audit, available: encryptionAvailable, root, schema: VAULT_SCHEMA };
}

module.exports = { VAULT_SCHEMA, createCredentialVault };
