import {
  applyExternalCapabilityProbe,
  createExternalCapabilityMatrix,
  type ExternalCapabilityMatrix,
  type ExternalCapabilityProfile,
} from '../engine/externalCapabilityMatrix.mjs';
import type { Connector } from './connectors';

const STORAGE_KEY = 'taiji_external_capability_matrix_v1';

export function externalCapabilityProfileForConnector(connector: Connector, configured: boolean): ExternalCapabilityProfile {
  const identity = `${connector.id} ${connector.label} ${connector.mcpServerName ?? ''}`;
  const kind = connector.type === 'mcp' ? 'mcp'
    : /github/iu.test(identity) ? 'github'
      : /mail|email|smtp|邮件|邮箱/iu.test(identity) ? 'email'
        : connector.kind === 'knowledge-url' || connector.kind === 'obsidian' || /knowledge|ima|知识库/iu.test(identity) ? 'knowledge_base'
          : 'generic_http';
  return {
    id: `connector:${connector.id}`,
    kind,
    label: connector.label,
    source: connector.type === 'mcp' ? 'mcp' : connector.kind ?? 'connector',
    configured,
    resourceIdentity: connector.baseUrl || connector.localPath || connector.mcpServerName,
  };
}

export function loadExternalCapabilityMatrix(): ExternalCapabilityMatrix {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return createExternalCapabilityMatrix([], raw ? JSON.parse(raw) : undefined);
  } catch {
    return createExternalCapabilityMatrix();
  }
}

export function saveExternalCapabilityMatrix(matrix: ExternalCapabilityMatrix): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(matrix)); } catch {}
}

export function syncExternalCapabilityProfiles(profiles: ExternalCapabilityProfile[]): ExternalCapabilityMatrix {
  const next = createExternalCapabilityMatrix(profiles, loadExternalCapabilityMatrix());
  saveExternalCapabilityMatrix(next);
  return next;
}

export function recordExternalCapabilityProbe(profile: ExternalCapabilityProfile, event: Record<string, unknown>): ExternalCapabilityMatrix {
  const current = loadExternalCapabilityMatrix();
  const withProfile = current.entries[profile.id]
    ? current
    : createExternalCapabilityMatrix([...Object.values(current.entries), profile], current);
  const next = applyExternalCapabilityProbe(withProfile, { ...event, profile });
  saveExternalCapabilityMatrix(next);
  return next;
}
