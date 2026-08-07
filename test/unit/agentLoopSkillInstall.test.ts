import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFallbackTaskDecision } from '../../src/engine/taskDecisionKernel.mjs';

const executeAgentTool = vi.fn();

vi.mock('../../src/engine/toolExecutorBridge', () => ({
  executeAgentTool,
}));

import { createRunAgentLoop } from '../../src/data/agentLoopRuntime';

const tools = [{ type: 'function', function: { name: 'install_skill' } }];

describe('agent loop Skill installation route', () => {
  beforeEach(() => {
    executeAgentTool.mockReset();
    localStorage.clear();
    localStorage.setItem('hermes_office_settings', JSON.stringify({ approvalMode: 'full' }));
  });

  it('executes an explicit skills CLI request exactly once without entering model planning', async () => {
    const command = 'npx skills add vercel-labs/agent-skills';
    const chatCompletion = vi.fn(async () => {
      throw new Error('the direct native install route must not call the planning model');
    });
    executeAgentTool.mockResolvedValue({
      toolCallId: 'native-install',
      name: 'install_skill',
      success: true,
      output: 'Skill 已安装并完成完整包回读验证。\n已安装 9 个 Skill。\n已核验源文件: 18\n已回读规则文档: 9',
    });
    const runAgentLoop = createRunAgentLoop({
      chatCompletion,
      isUsefulToolOutcome: (_name, success) => success,
      isConnectorTask: () => false,
      isConnectorSetupRequest: () => false,
      compileTaskDecision: vi.fn(async () => ({
        decision: createFallbackTaskDecision({ latestMessage: command, availableTools: ['install_skill'] }),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      })) as any,
    });

    const result = await runAgentLoop({
      turns: [{ role: 'user', content: command }],
      tools,
      scene: 'assistant',
      label: '章北海助理',
    });

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(executeAgentTool).toHaveBeenCalledTimes(1);
    expect(executeAgentTool.mock.calls[0][0]).toMatchObject({
      name: 'install_skill',
      args: { sourceUrl: 'https://github.com/vercel-labs/agent-skills', installAll: true },
    });
    expect(result.executionState.status).toBe('completed');
    expect(result.content).toContain('已经安装好了');
  });

  it('parses a repository followed directly by Chinese instructions as the current source', async () => {
    const command = 'npx skills add mattpocock/skills安装这套skill然后把名称发给我';
    const chatCompletion = vi.fn(async () => {
      throw new Error('the direct native install route must not call the planning model');
    });
    executeAgentTool.mockResolvedValue({
      toolCallId: 'native-install-current-source', name: 'install_skill', success: true,
      output: 'Skill 已安装并完成完整包回读验证。\n已安装 35 个 Skill。',
    });
    const runAgentLoop = createRunAgentLoop({
      chatCompletion,
      isUsefulToolOutcome: (_name, success) => success,
      isConnectorTask: () => false,
      isConnectorSetupRequest: () => false,
      compileTaskDecision: vi.fn(async () => {
        throw new Error('an explicit native install must not return to task planning');
      }) as any,
    });

    await runAgentLoop({ turns: [{ role: 'user', content: command }], tools, scene: 'assistant', label: '章北海助理' });

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(executeAgentTool).toHaveBeenCalledTimes(1);
    expect(executeAgentTool.mock.calls[0][0]).toMatchObject({
      name: 'install_skill', args: { sourceUrl: 'https://github.com/mattpocock/skills', installAll: true },
    });
  });

  it('resumes an explicit Skill installation from its original source without re-planning', async () => {
    const command = 'npx skills add mattpocock/skills';
    const chatCompletion = vi.fn(async () => {
      throw new Error('a resumed native install must not return to the planning model');
    });
    executeAgentTool.mockResolvedValue({
      toolCallId: 'native-resumed-install',
      name: 'install_skill',
      success: true,
      output: 'Skill 已安装并完成完整包回读验证。\n已安装 35 个 Skill。\n已核验源文件: 120\n已回读规则文档: 35',
    });
    const runAgentLoop = createRunAgentLoop({
      chatCompletion,
      isUsefulToolOutcome: (_name, success) => success,
      isConnectorTask: () => false,
      isConnectorSetupRequest: () => false,
      compileTaskDecision: vi.fn(async () => {
        throw new Error('the continuation source should be resolved before task planning');
      }) as any,
    });

    const result = await runAgentLoop({
      turns: [
        { role: 'user', content: command },
        { role: 'assistant', content: '上一次连接暂时失败，安装尚未开始。' },
        { role: 'user', content: '现在继续安装。' },
      ],
      tools,
      scene: 'assistant',
      label: '章北海助理',
    });

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(executeAgentTool).toHaveBeenCalledTimes(1);
    expect(executeAgentTool.mock.calls[0][0]).toMatchObject({
      name: 'install_skill',
      args: { sourceUrl: 'https://github.com/mattpocock/skills', installAll: true },
    });
    expect(result.taskDecision.goal).toBe(command);
    expect(result.taskDecision.turnRelation).toBe('continuation');
    expect(result.executionState.status).toBe('completed');
  });

  it('uses a bound candidate source for “安装它” but does not reinterpret a question as an install', async () => {
    const installDecision = createFallbackTaskDecision({ latestMessage: '安装它', availableTools: ['install_skill'] });
    const questionDecision = createFallbackTaskDecision({ latestMessage: '为什么它没有安装好？', availableTools: ['install_skill'] });
    const module = await import('../../src/data/agentLoopSkillInstall');
    const common = {
      tools,
      referenceSourceUrl: 'https://api.skillhub.cn/api/v1/download?slug=diagram-builder',
      isConnectorTask: () => false,
      isConnectorSetupRequest: () => false,
    };
    const install = module.prepareAgentSkillInstallation({
      ...common,
      taskDecision: installDecision,
      latestUserText: '安装它',
    });
    const question = module.prepareAgentSkillInstallation({
      ...common,
      taskDecision: questionDecision,
      latestUserText: '为什么它没有安装好？',
    });

    expect(install.taskDecision.primaryRoute).toBe('install_skill');
    expect(install.pinnedSkillSource).toContain('slug=diagram-builder');
    expect(install.installOnlyTask).toBe(true);
    expect(question.taskDecision.primaryRoute).toBe('direct_answer');
    expect(question.pinnedSkillSource).toBe('');
  });
});
