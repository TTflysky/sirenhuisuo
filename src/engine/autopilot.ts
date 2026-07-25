/**
 * 自主代理引擎（Autopilot）
 * 结合 Hermes Agent 的 ReAct 内核：让办公室 AI 团队基于上下文自主思考、
 * 推荐可落地的项目，并自主规划-写码-跑命令-验证，直到项目完成。
 *
 * 依赖：hermesClient（LLM 调用 / 用户上下文）、tools（真实文件系统+命令执行）
 */

import {
  chatCompletion,
  runAgentLoop,
  resolveApiBase,
  buildUserContext,
  loadUserProfile,
  type ChatTurn,
} from '../data/hermesClient';
import type { ModelConfig } from '../types';
import { TOOLS } from './tools';

// ===== 上下文（由 UI 汇总当前办公室状态后传入）=====
export interface AutopilotContext {
  teams: { name: string; members: string[]; openTasks: string[] }[];
  backendOnline: boolean;
  model?: string;
}

// ===== 推荐的项目计划 =====
export interface ProjectPlan {
  title: string;        // 项目名
  rationale: string;    // 为什么值得做（结合用户画像/现状）
  steps: string[];      // 执行步骤
  expectedOutputs: string[]; // 预期产出物
}

// ===== 执行回调（流式）=====
export interface AutopilotCallbacks {
  onPhase: (text: string) => void;
  onThought: (text: string) => void;
  onToolCall: (name: string, args: string) => void;
  onObservation: (text: string) => void;
  onMessage: (text: string) => void;
  onDone: (summary: string) => void;
  onError: (err: string) => void;
  shouldStop?: () => boolean;
}

const STRATEGIST_SYSTEM = `你是 Hermes 办公室的首席战略官（PM 兼调度者）。
你掌管一支 AI 团队，成员角色固定为：
- PM（协调/需求）：拆解目标、对齐、产出需求文档
- Planner（规划/架构）：技术方案、接口、步骤
- Coder（编码）：用工具真正写出可运行代码文件
- Checker（审查/QA）：审查正确性、安全、跑测试验收

你的团队拥有以下工具能力：
- write_file：把文件真正写入本地"工作区"（代码/文档都落盘，是可运行的）
- read_file / list_files：读取/浏览工作区文件
- web_search：联网查资料、查 API 文档
- run_command：在工作区内执行终端命令（npm install / npm run build / node xxx / 跑测试 等）

你的任务是：基于"当前用户与办公室现状"，推荐 2-4 个**真正值得做、且你的团队能自主完成**的具体项目。
项目要务实、可落地、能产出可见成果（一个能跑的小工具/网页/脚本/文档），不要空泛。
只输出 JSON，格式严格如下（不要任何额外文字、不要 markdown 代码块）：
[
  {
    "title": "项目标题",
    "rationale": "为什么值得做（结合用户的身份/偏好/当前空白，1-2 句）",
    "steps": ["步骤1", "步骤2", "步骤3"],
    "expectedOutputs": ["预期产出物1", "预期产出物2"]
  }
]`;

/**
 * 推荐可落地的项目（基于用户画像 + 记忆 + 团队/任务现状）
 */
export async function recommendProjects(ctx: AutopilotContext, modelConfig?: ModelConfig): Promise<ProjectPlan[]> {
  if (!resolveApiBase()) return [];
  const profile = loadUserProfile().trim();
  const userCtx = buildUserContext();

  const situation = [
    `## 用户画像\n${profile || '（无）'}`,
    `## 当前办公室团队\n${ctx.teams.length ? ctx.teams.map((t) => `- 「${t.name}」成员 ${t.members.length} 人；待办 ${t.openTasks.length ? t.openTasks.join('、') : '无'}`).join('\n') : '（还没有团队）'}`,
    `## 模型后端\n${ctx.backendOnline ? `在线（${ctx.model ?? '未知模型'}），团队可自主调用工具写码/跑命令` : '离线（仅能推荐，无法实际执行）'}`,
  ].join('\n\n');

  const turns: ChatTurn[] = [
    { role: 'system', content: STRATEGIST_SYSTEM },
    { role: 'user', content: `${userCtx ? userCtx + '\n\n' : ''}## 当前现状\n${situation}\n\n请推荐 2-4 个你的团队能自主完成的具体项目（输出 JSON 数组）。` },
  ];

  try {
    const r = await chatCompletion(turns, 'autopilot', '推荐项目', undefined, modelConfig);
    if (!r.content) return [];
    const jsonMatch = r.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p: any) => p && typeof p.title === 'string')
      .map((p: any) => ({
        title: String(p.title),
        rationale: String(p.rationale ?? ''),
        steps: Array.isArray(p.steps) ? p.steps.map(String) : [],
        expectedOutputs: Array.isArray(p.expectedOutputs) ? p.expectedOutputs.map(String) : [],
      }));
  } catch {
    return [];
  }
}

const SUPERVISOR_SYSTEM = `你是 Hermes 办公室的自主代理总指挥（Supervisor）。你代表整支 AI 团队（PM/Planner/Coder/Checker）自主工作。

工作守则：
1. 先思考（在心里拆解项目），再行动。可用工具就直接调用，不要只说"我来写"。
2. 用 write_file 把成果真正写入工作区：代码文件要完整、可运行（包含必要的依赖说明/脚本）。
3. 用 run_command 在工作区内安装依赖、构建、运行、跑测试，验证成果可用。
4. 用 read_file / list_files 检查自己的工作；用 web_search 查资料或 API 文档。
5. 像真实工程师一样闭环：规划→实现→验证→修复，直到项目能跑通。
6. 完成后用简洁中文总结：做了什么、产出了哪些文件（含路径）、如何运行、还有什么限制。

你拥有工具：write_file / read_file / list_files / web_search / run_command。
现在开始自主完成下面的项目。`;

/**
 * 自主执行一个项目：规划-写码-跑命令-验证，直到完成。
 * 通过回调把"思考/工具调用/观察/结论"实时流式回传 UI。
 */
export async function runAutopilot(
  plan: ProjectPlan,
  cb: AutopilotCallbacks,
  opts?: { modelConfig?: ModelConfig },
): Promise<void> {
  if (!resolveApiBase()) {
    cb.onError('未配置模型后端，无法自主执行。请先在「设置」中填写 API。');
    return;
  }
  cb.onPhase(`🚀 启动项目：${plan.title}`);

  const planText = [
    `## 项目：${plan.title}`,
    plan.rationale ? `背景：${plan.rationale}` : '',
    plan.steps.length ? `建议步骤：\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    plan.expectedOutputs.length ? `预期产出：\n${plan.expectedOutputs.map((o) => `- ${o}`).join('\n')}` : '',
    `\n请自主规划并实现，用工具真正写出文件、跑命令验证，完成后汇总成果。`,
  ].filter(Boolean).join('\n');

  const turns: ChatTurn[] = [
    { role: 'system', content: SUPERVISOR_SYSTEM },
    { role: 'user', content: planText },
  ];

  try {
    const r = await runAgentLoop({
      turns,
      tools: TOOLS,
      scene: 'autopilot',
      label: plan.title,
      modelConfig: opts?.modelConfig,
      scope: 'global',
      onToolCall: (name, args) => {
        cb.onToolCall(name, args);
      },
      onToolResult: (name, _args, result) => {
        cb.onObservation(`${name} → ${result.slice(0, 600)}`);
      },
      shouldStop: cb.shouldStop,
    });
    cb.onPhase('🏁 执行结束');
    cb.onMessage(r.content || '（无总结）');
    cb.onDone(r.content || '项目已完成，但未返回总结。');
  } catch (e: any) {
    cb.onError(`执行出错：${e?.message ?? '未知错误'}`);
  }
}
