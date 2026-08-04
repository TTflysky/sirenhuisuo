import { describe, expect, it } from 'vitest';
import registryModule from '../../electron/windowRegistry.cjs';

const { createWindowRegistry } = registryModule;

describe('window registry', () => {
  it('removes only the window that owns a key', () => {
    const registry = createWindowRegistry('chat');
    const first = { id: 1 };
    const replacement = { id: 2 };
    registry.register('team:one', first);
    expect(registry.get('team:one')).toBe(first);
    expect(registry.removeIf('team:one', replacement)).toBe(false);
    expect(registry.get('team:one')).toBe(first);
    registry.register('team:one', replacement);
    expect(registry.removeIf('team:one', first)).toBe(false);
    expect(registry.removeIf('team:one', replacement)).toBe(true);
    expect(registry.has('team:one')).toBe(false);
  });
});
