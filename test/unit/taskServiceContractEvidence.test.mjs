import { describe, expect, it } from 'vitest';
import contractModule from '../../electron/taskServiceContracts.cjs';
import evidenceModule from '../../electron/taskServiceEvidenceCommands.cjs';

const { createStepTaskContract } = contractModule;
const { createTaskServiceEvidenceCommands } = evidenceModule;

describe('TaskService contract and evidence projection', () => {
  it('creates a complete contract for a normal executable step', () => {
    const contract = createStepTaskContract({
      title: 'Create report',
      deliverableType: 'file',
      inputRefs: ['verified:brief'],
      acceptanceCriteria: ['The report exists'],
      expectedEvidence: ['Read the report back'],
      outputPath: 'artifacts/report.md',
    });

    expect(contract).toMatchObject({
      contractVersion: 1,
      inputRefs: ['verified:brief'],
      output: { type: 'file', path: 'artifacts/report.md', description: 'Create report' },
      completionConditions: ['The report exists'],
      verification: ['Read the report back'],
    });
  });

  it('persists verified evidence on the step, adaptive node, and recovery context', async () => {
    const task = {
      id: 'task-one',
      steps: [{ id: 'build', evidence: [] }],
      artifacts: [],
      verifications: [],
      serviceEvents: [],
      recoveryContext: { completedEvidence: [], unresolvedIssues: [], steeringMessages: [], autoResume: false },
      adaptivePlanGraph: { nodes: [{ id: 'build', evidenceIds: [] }] },
    };
    const update = async (_taskId, mutate) => {
      mutate(task);
      return { ok: true };
    };
    const commands = createTaskServiceEvidenceCommands(update);

    await commands.addArtifact(task.id, {
      id: 'artifact-one',
      stepId: 'build',
      name: 'report.md',
      path: 'artifacts/report.md',
      verified: true,
    });
    await commands.recordVerification(task.id, {
      id: 'verification-one',
      stepId: 'build',
      label: 'Report verification',
      status: 'passed',
      detail: 'The report was read back',
    });

    expect(task.steps[0].evidence.map((item) => item.id)).toEqual(['artifact-one', 'verification-one']);
    expect(task.adaptivePlanGraph.nodes[0].evidenceIds).toEqual(['artifact-one', 'verification-one']);
    expect(task.recoveryContext.completedEvidence).toEqual([
      'build: artifacts/report.md',
      'build: Report verification: The report was read back',
    ]);
  });
});
