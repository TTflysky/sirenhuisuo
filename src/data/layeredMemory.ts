import type { LayeredMemoryEntry, LayeredMemoryResult, MemoryProposal } from '../electron';
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

export type LayeredMemoryContextInput = {
  query?: string; projectId?: string; taskId?: string; conversationId?: string; teamId?: string; employeeId?: string;
  memoryKind?: LayeredMemoryEntry['memoryKind']; memoryKinds?: LayeredMemoryEntry['memoryKind'][]; limit?: number;
};

export async function retrieveLayeredMemoryContext(input: LayeredMemoryContextInput = {}): Promise<LayeredMemoryResult> {
  await syncLegacyMemory();
  return window.electronAPI?.memoryContext?.(input) ?? { ok: false, error: '记忆账本当前不可用' };
}

export async function buildLayeredMemoryContext(input: LayeredMemoryContextInput = {}): Promise<string> {
  const result = await retrieveLayeredMemoryContext(input);
  return result.ok ? result.context ?? '' : '';
}

export async function loadLayeredMemorySnapshot(): Promise<{ entries: LayeredMemoryEntry[]; history: LayeredMemoryEntry[]; proposals: MemoryProposal[]; retrievals: Array<Record<string, unknown>>; usage: Record<string, { current: number; max: number; percent: number }> }> {
  await syncLegacyMemory();
  const result = await window.electronAPI?.memoryList?.({ includeAudit: true, includeHistory: true, includeRetrievals: true });
  const allEntries = result?.ok ? result.entries ?? [] : [];
  const entries = allEntries.filter((entry) => entry.status === undefined || entry.status === 'active');
  const history = allEntries.filter((entry) => entry.status && entry.status !== 'active');
  return { entries, history, proposals: result?.ok ? result.proposals ?? [] : [], retrievals: result?.ok ? result.retrievals ?? [] : [], usage: result?.ok ? result.usage ?? {} : {} };
}
