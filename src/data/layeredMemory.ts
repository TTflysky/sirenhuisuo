import type { LayeredMemoryEntry, MemoryProposal } from '../electron';
import { loadUserMemory, loadUserProfile } from './userMemory';
import { loadTaskLearnings } from '../engine/taskLearningMemory';

let legacySyncPromise: Promise<void> | undefined;

/** Preserve the old localStorage memory as a compatible source while the
 * main-process layered memory becomes authoritative for new shared learning. */
export function syncLegacyMemory(): Promise<void> {
  if (legacySyncPromise) return legacySyncPromise;
  legacySyncPromise = (async () => {
    const importer = window.electronAPI?.memoryImportLegacy;
    if (!importer) return;
    const result = await importer({
      userProfile: loadUserProfile(),
      userMemory: loadUserMemory(),
      taskLearnings: loadTaskLearnings(),
      layeredMemory: (() => { try { return JSON.parse(localStorage.getItem('hermes_office_layered_memory_v1') || '[]'); } catch { return []; } })(),
    });
    if (!result.ok) throw new Error(result.error || '旧版记忆迁移失败');
  })().catch((error) => {
    legacySyncPromise = undefined;
    console.warn('[layered-memory] legacy sync failed:', error);
  });
  return legacySyncPromise;
}

export async function buildLayeredMemoryContext(input: { query?: string; teamId?: string; employeeId?: string; memoryKind?: LayeredMemoryEntry['memoryKind']; memoryKinds?: LayeredMemoryEntry['memoryKind'][]; limit?: number } = {}): Promise<string> {
  await syncLegacyMemory();
  const result = await window.electronAPI?.memoryContext?.(input);
  return result?.ok ? result.context ?? '' : '';
}

export async function loadLayeredMemorySnapshot(): Promise<{ entries: LayeredMemoryEntry[]; proposals: MemoryProposal[]; usage: Record<string, { current: number; max: number; percent: number }> }> {
  await syncLegacyMemory();
  const result = await window.electronAPI?.memoryList?.({ includeAudit: true });
  const entries = result?.ok ? result.entries ?? [] : [];
  try { localStorage.setItem('hermes_office_layered_memory_v1', JSON.stringify(entries)); } catch {}
  return { entries, proposals: result?.ok ? result.proposals ?? [] : [], usage: result?.ok ? result.usage ?? {} : {} };
}
