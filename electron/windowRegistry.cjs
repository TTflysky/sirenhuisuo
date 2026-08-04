/**
 * Owns the lifecycle index for native windows without deciding how a window
 * is created or rendered. Keeping the registry small makes reuse and cleanup
 * testable without starting Electron.
 */
function createWindowRegistry(label = 'windows') {
  const entries = new Map();
  return {
    label,
    get: (key) => entries.get(key),
    has: (key) => entries.has(key),
    set: (key, value) => {
      entries.set(key, value);
      return value;
    },
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
    values: () => entries.values(),
    entries: () => entries.entries(),
    keys: () => entries.keys(),
    register(key, value) {
      entries.set(key, value);
      return value;
    },
    removeIf(key, value) {
      if (entries.get(key) !== value) return false;
      entries.delete(key);
      return true;
    },
    snapshot() {
      return [...entries.entries()];
    },
  };
}

module.exports = { createWindowRegistry };
