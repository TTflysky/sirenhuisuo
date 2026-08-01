import { describe, expect, it } from 'vitest';
import {
  TASK_DECISION_TOOL_NAME,
  buildTaskContract,
  buildTaskDecisionMessages,
  classifyTaskTurnIntent,
  createFallbackTaskDecision,
  isKnowledgeDirectoryReadRequest,
  normalizeTaskDecision,
  parseTaskDecisionToolCall,
} from '../../src/engine/taskDecisionKernel.mjs';

const tools = [
  'read_web_page', 'web_search', 'inspect_connectors', 'read_file', 'list_files',
  'search_skills', 'install_skill', 'write_file', 'run_command',
];

function candidate(overrides = {}) {
  return {
    mode: 'execute',
    turnRelation: 'continuation',
    primaryRoute: 'general_tools',
    acceptanceCriteria: ['Model criterion', '', 'Model criterion'],
    deliverableType: 'mixed',
    deliverables: [{ label: 'Result', type: 'invalid' }],
    requiredCapabilities: ['research'],
    requiresEvidence: true,
    needsUser: false,
    missingUserCondition: '',
    searchQuery: '',
    decisionReason: 'Model decision',
    confidence: 0.8,
    ...overrides,
  };
}

describe('task decision kernel safeguards', () => {
  it('classifies empty, conversational, question, action, correction, and control turns', () => {
    expect(classifyTaskTurnIntent('')).toBe('conversation');
    expect(classifyTaskTurnIntent('你好')).toBe('conversation');
    expect(classifyTaskTurnIntent('为什么你刚才的回答没有依据？')).toBe('follow_up_question');
    expect(classifyTaskTurnIntent('什么是任务合同？')).toBe('answer');
    expect(classifyTaskTurnIntent('请生成一个 Markdown 报告文件')).toBe('execute_request');
    expect(classifyTaskTurnIntent('继续执行刚才的任务')).toBe('resume_control');
  });

  it('parses only the expected structured tool call', () => {
    expect(parseTaskDecisionToolCall([])).toBeUndefined();
    expect(parseTaskDecisionToolCall([{ name: TASK_DECISION_TOOL_NAME, arguments: '{bad' }])).toBeUndefined();
    expect(parseTaskDecisionToolCall([{ name: TASK_DECISION_TOOL_NAME, arguments: '[]' }])).toBeUndefined();
    expect(parseTaskDecisionToolCall([{ name: TASK_DECISION_TOOL_NAME, arguments: '{"mode":"answer"}' }])).toEqual({ mode: 'answer' });
  });

  it('pins explicit webpage requests even when the model proposes search', () => {
    const input = { latestMessage: '读取并总结 https://example.com/article', availableTools: tools };
    const decision = normalizeTaskDecision(candidate({ primaryRoute: 'web_search', searchQuery: 'other pages' }), input);
    expect(decision.mode).toBe('execute');
    expect(decision.turnRelation).toBe('new_task');
    expect(decision.primaryRoute).toBe('read_web_page');
    expect(decision.searchQuery).toBe('');
    expect(decision.acceptanceCriteria.some((item) => item.includes('指定'))).toBe(true);
  });

  it('pins explicit Skill sources to the native installer', () => {
    const input = { latestMessage: '请安装 https://github.com/example/skills/tree/main/grill-me', availableTools: tools };
    const decision = normalizeTaskDecision(candidate({ primaryRoute: 'run_command' }), input);
    expect(decision.primaryRoute).toBe('install_skill');
    expect(decision.deliverableType).toBe('operation');
    expect(decision.deliverables[0].label).toContain('Skill');
  });

  it('keeps knowledge directory reads local instead of turning them into setup', () => {
    const input = { latestMessage: '查看 Obsidian 知识库目录有多少笔记', availableTools: tools };
    expect(isKnowledgeDirectoryReadRequest(input.latestMessage)).toBe(true);
    const decision = normalizeTaskDecision(candidate({ primaryRoute: 'inspect_connectors' }), input);
    expect(decision.primaryRoute).toBe('run_command');
    expect(decision.deliverableType).toBe('operation');
  });

  it('does not let a model restart tools for feedback, pause, or follow-up questions', () => {
    const feedback = normalizeTaskDecision(candidate(), { latestMessage: '这个结果我不满意', activeTaskGoal: 'Build app', availableTools: tools });
    const paused = normalizeTaskDecision(candidate(), { latestMessage: '先暂停这个任务', activeTaskGoal: 'Build app', availableTools: tools });
    const question = normalizeTaskDecision(candidate(), { latestMessage: '你刚才的回答为什么这么判断？', activeTaskGoal: 'Build app', availableTools: tools });
    expect(feedback.mode).toBe('conversation');
    expect(paused.mode).toBe('conversation');
    expect(paused.turnRelation).toBe('control');
    expect(question.primaryRoute).toBe('direct_answer');
    expect(question.turnRelation).toBe('question');
  });

  it('accepts only genuine user-owned missing conditions', () => {
    const input = { latestMessage: '配置并测试邮件连接器', availableTools: tools };
    const genuine = normalizeTaskDecision(candidate({ needsUser: true, missingUserCondition: '需要用户提供 API Key', primaryRoute: 'inspect_connectors' }), input);
    const invented = normalizeTaskDecision(candidate({ needsUser: true, missingUserCondition: '需要重新检查网络环境', primaryRoute: 'inspect_connectors' }), input);
    expect(genuine.needsUser).toBe(true);
    expect(genuine.missingUserCondition).toContain('API Key');
    expect(invented.needsUser).toBe(false);
    expect(invented.missingUserCondition).toBe('');
  });

  it('normalizes malformed model fields without dropping the user goal', () => {
    const input = { latestMessage: '请比较两个方案并给我建议', availableTools: tools };
    const decision = normalizeTaskDecision(candidate({
      mode: 'invalid', turnRelation: 'invalid', primaryRoute: 'invalid', acceptanceCriteria: 'bad',
      deliverableType: 'invalid', deliverables: null, requiredCapabilities: null,
      riskLevel: 'impossible', teamPolicy: 'bad', confidence: 9,
    }), input);
    expect(decision.goal).toBe(input.latestMessage);
    expect(decision.primaryRoute).toBe('direct_answer');
    expect(decision.deliverableType).toBe('answer');
    expect(decision.confidence).toBeLessThanOrEqual(1);
  });

  it('builds bounded model context and a human-readable execution contract', () => {
    const decision = createFallbackTaskDecision({ latestMessage: '请生成报告文件', availableTools: tools });
    const messages = buildTaskDecisionMessages({
      latestMessage: '请生成报告文件',
      previousUserMessage: '背景',
      activeTaskGoal: '旧目标',
      recentHistory: Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index}` })),
      availableTools: tools,
      relevantUserContext: 'User context',
      relevantTaskExperience: 'Task experience',
    });
    expect(messages).toHaveLength(2);
    expect(JSON.parse(messages[1].content).recentHistory).toHaveLength(20);
    const contract = buildTaskContract({ ...decision, deliverables: [{ label: 'report.md' }], riskLevel: 'normal' }, 'Do not repeat route A');
    expect(contract).toContain('太极任务合同');
    expect(contract).toContain('report.md');
    expect(contract).toContain('Do not repeat route A');
  });
});
