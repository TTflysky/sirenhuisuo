# 私人办公会所（Hermes Office Pro）v0.3.0

> AI 虚拟办公室桌面应用 —— 让多名 AI 员工在一间虚拟办公室里协作办公。

## 这是什么

一个基于 **Electron 33 + React 19 + TypeScript 6** 的 Windows 桌面应用。

你在虚拟办公室里雇佣 AI 员工（PM、Planner、Coder、Checker），组建团队，发送消息时系统**自动判断**是否需要发起团队讨论，AI 员工自主协作推进任务。支持 OpenAI 兼容 API（DeepSeek、千问、智谱、Kimi、豆包、混元、OpenAI、Ollama 等 9 家服务商），每个员工可独立配置模型或引用模型库。

---

## 核心能力

### 四角色 OPC 架构
PM（协调者）→ Planner（规划者��→ Coder（编码者）→ Checker（审查者），AI 员工按角色自动编排协作。

### 团队自动讨论调度器（v0.3.0 新增）
- 发送消息后系统自动判断是否需要发起团队讨论
- 基于**紧急程度、协作意图、任务关键词、@ 提及、附件/长文本**等维度智能评分
- 三种模式：`off`（关闭）/ `smart`（智能，默认）/ `always`（始终）
- 手动「发起讨论」入口保留，手动触发跳过评分阈值
- 自动消息 **400ms 聚合窗口**，窗口内多条消息合并为一次讨论
- 团队级调度锁：讨论进行中到达的新请求自动排队，讨论结束后补触发最多一次
- AI 回复中 `@` 提及的成员自动进入后续响应队列
- `publishTask` 发布任务时自动触发讨论

### 连��器系统（v0.2.9 新增）
- 侧栏「🔌 连接器」面板：添加/删除/配置/测试外部服务连接
- 支持 API Key / Bearer 认证 + 自定义 headers
- 预设连接器：ima 知识库（搜索/列出/添加）、QQ 邮箱（发送/搜索）、GitHub（搜仓库）、自定义 HTTP（GET/POST）
- 连接器工具自动注入聊天 agent 循环，助手可直接调用（如 `connector_ima_search_knowledge`）
- Electron 主进程代理 HTTP 请求，绕过渲染进程 CORS 限制

### 自主办公
AI 团队自主规划项目、写代码、跑命令、验证结果，全程自动化。真实文件系统沙箱，AI 可读写文件、安装依赖、执行命令。

### 原生聊天窗口
每个员工/团队/助手对话都是独立 Windows BrowserWindow，可拖动、自由排列。多窗口间通过 IPC 广播实时同步状态。

### 多模型支持
9 家服务商预设 + 自定义端点。每个员工可独立配置模型，也可直接「📦 引用模型库中已配置的模型」。

### 技能库
扫描本地已安装的 WorkBuddy 技能（`~/.workbuddy/skills/`），聊天中 `@` 可搜索并选择技能，发送时自动将技能指令注入 AI 上下文。最多同时引用 5 个。

### 其他
- 文件上传/粘贴（图片多模态 + 文件附件）
- 聊天内嵌产出物面板（Markdown/HTML/代码/图片预览）
- Token 消耗分析面板
- 用户画像 + 长期记忆自动提炼
- 应用内自动更新（electron-updater）

---

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面框架 | Electron | 33 |
| 前端 | React + TypeScript | 19 / 6.0 |
| UI 库 | Ant Design + @ant-design/icons | 6 |
| 构建 | Vite (Rolldown) | 8 |
| 打包 | electron-builder (NSIS) | 25 |
| 代码检查 | Oxlint | 1 |
| 存储 | localStorage 全量持久化 | - |
| LLM | OpenAI 兼容 API（`/v1/chat/completions`） | - |

**不依赖**：Redux / Zustand / MobX（状态管理手写 useReducer）；Tailwind / styled-components（样式手写 CSS）。

---

## 项目架构

### 数据流
```
用户操作 → store.tsx dispatch(action)
  ├── reducer 修改内存 state
  ├── hermesClient 持久化到 localStorage
  └── ipcBus 广播到其他窗口（store:action 协议）
```

### 讨论调度器（核心新增）
```
用户发消息 → enqueueAutoDiscussion()
  ├── evaluateDiscussionTrigger() 评分判断是否触发
  ├── buildParticipantPlan() 选择参与者
  └── enqueueDiscussion(teamId, opts, 400ms)
        ├── keys Set 去重
        ├── 400ms 聚合窗口内合并
        ├── 进行中 → queued 排队
        └── 空闲 → runDiscussion()
              ├── runTeamDiscussion() 成员依次发言
              └── finally: 消费 queued
```

### LLM 调用链
```
hermesClient.chatCompletion()        # 单次 API 调用
hermesClient.runAgentLoop()          # Agent 循环（调模型 + 执行工具，最多 6 轮）
src/engine/teamDiscussion.ts         # 团队讨论编排（多成员顺序发言）
src/engine/discussionTrigger.ts      # 自动触发判定
src/engine/autopilot.ts              # 自主代理（项目推荐 + 全自动执行）
src/engine/simulationEngine.ts       # 演示剧本播放器
src/engine/proactiveScript.ts        # 预置演示剧本
src/engine/tools.ts                  # AI 工具注册表（文件/搜索/命令）
src/engine/connectorTools.ts         # 连接器工具生成与路由
```

---

## 项目结构

```
hermes-office-pro/
├── package.json              # 项目配置 v0.3.0
├── tsconfig.json             # TS 根配置（引用子配置）
├── tsconfig.app.json         # 应用代码 TS 配置
├── tsconfig.node.json        # Node 端 TS 配置
├── vite.config.ts            # Vite 构建配置
├── .gitignore
├── .oxlintrc.json
├── CHANGELOG.md              # 版本变更日志
├── README.md                 # 本文件
├── index.html                # SPA 入口 HTML
│
├── src/
│   ├── main.tsx              # 应用入口，挂载 React
│   ├── App.tsx               # 主布局 + 视图切换（4 个主视图）
│   ├── store.tsx             # ★ 全局状态管理（Context + Reducer，760 行）
│   ├── types.ts              # ★ 核心类型定义（Employee/Team/ChatMessage/TeamTask 等）
│   ├── theme.css             # 全局样式（~1200 行）
│   ├── ipcBus.ts             # 窗口间 IPC 广播总线
│   ├── electron.d.ts         # Electron API TypeScript 类型声明
│   │
│   ├── data/                 # 数据层
│   │   ├── hermesClient.ts   # ★ LLM 客户端 + 持久化 + 设置管理（811 行）
│   │   ├── outputs.ts        # 产出物管理（CRUD/导出/内容类型推断）
│   │   ├── skills.ts         # 技能加载（通过 electronAPI 桥接）
│   │   ├── connectors.ts     # 连接器模型（MCP/HTTP 外部服务集成）
│   │   ├── defaultEmployees.ts  # 4 个 OPC 种子员工 + 真人用户
│   │   ├── defaultTeams.ts   # 种子团队 "OPC 协作组"
│   │   └── avatarPresets.tsx # 头像预设资源
│   │
│   ├── engine/               # AI 引擎层
│   │   ├── teamDiscussion.ts     # ★ 团队 AI 讨论编排（多角色顺序发言）
│   │   ├── discussionTrigger.ts  # ★ 讨论自动触发判定 + 参与者计划
│   │   ├── tools.ts              # AI 工具注册表（文件/搜索/命令）
│   │   ├── connectorTools.ts     # 连接器工具生成与路由执行
│   │   ├── autopilot.ts          # 自主代理引擎（项目推荐 + 自动执行）
│   │   ├── simulationEngine.ts   # 演示剧本播放器
│   │   └── proactiveScript.ts    # 预置演示剧本
│   │
│   ├── components/           # UI 组件（28 个文件，8 个子目录）
│   │   ├── chat/             # AssistantChat / TeamChatApp / DmChatApp / ModelSelector
│   │   ├── office/           # OfficeView / Workstation / AgentAvatar / OfficeDecor
│   │   ├── sidebar/          # SidebarPanel / TeamList / EmployeeCard / 弹窗系列 / ConnectorPanel
│   │   ├── skills/           # SkillLibraryView / SkillMentionInput
│   │   ├── outputs/          # OutputsView / OutputRenderer / ChatOutputsPanel
│   │   ├── analytics/        # 数据分析面板
│   │   ├── autopilot/        # 自主办公面板
│   │   └── settings/         # SettingsModal / AssistantSettingsModal
│   │
│   └── utils/                # 工具函数
│       ├── clipboard.ts      # 剪贴板操作、消息导出
│       ├── linkify.tsx       # URL 自动链接化
│       └── attachments.ts    # 附件上传/粘贴/分类
│
├── electron/                 # Electron 主进程
│   ├── main.cjs              # ★ 主进程（452 行）：窗口管理/IPC/沙箱文件系统/命令执行
│   ├── preload.cjs           # 预加载桥接（53 行）：contextBridge 暴露 API
│   ├── skills.cjs            # 技能扫描与安全读取
│   └── autoUpdate.cjs        # 自动更新模块
│
├── plans/                    # 设计规划文档
│   ├── team-collaboration-auto-discussion.md   # 团队协作自动讨论方案（366 行）
│   └── window-connector-experience.md          # 窗口与连接器体验改造方案（179 行）
│
├── _deadcode/                # 已废弃代码存档
├── dist/                     # Vite 构建产物
├── release/                  # electron-builder 打包输出
├── outputs/                  # AI 生成产出物目录（git ignored）
├── workspace/                # AI 沙箱工作区（git ignored）
├── public/                   # 静态资源
└── node_modules/             # 依赖（git ignored）
```

### 关键类型速查（src/types.ts）

| 类型 | 字段 | 说明 |
|------|------|------|
| `Employee` | id, name, title, role, avatar, stationIndex, prompt, soul, modelConfig, isOnline, isWorking, isTalking | AI 员工实体 |
| `Team` | id, name, memberIds, chatMessages, tasks, archived | 团队实体 |
| `ChatMessage` | id, authorId, roleId, content, mentions, attachments, skillRefs, discussionId, discussionRound, triggeredBy, thoughtChain, tokens | 聊天消息 |
| `TeamTask` | id, title, lane(PLANNING/CODING/REVIEW/DONE), assigneeId, description, acceptance | 任务卡 |
| `ModelConfig` | provider, apiHost, apiKey, model, refModelId | 模型配置（支持引用模型库） |
| `DiscussionTriggerInput` | teamId, messageId, userText, mentions, hasAttachments, recentMessages, activeTaskCount, manual, now | 自动触发判定输入 |
| `DiscussionParticipantPlan` | memberId, roleId, reason, priority | 参与者参与计划 |
| `AppState` | employees, teams, status | 应用根状态 |

---

## 配置

### 模型配置（三阶回退）
1. **员工独立配置**：编辑员工 → 模型配置 → 引用模型库 或 手动填写
2. **助理机器人配置**：助理机器人设置的默认模型
3. **全局设置**���设置 → API 模型管理 → 默认模型

### 自动讨论设置
- `autoDiscussMode`：`off` / `smart` / `always`
- `autoDiscussMinScore`：触发阈值（smart 模式）
- `autoDiscussCooldownMs`：冷却时间
- `autoDiscussMaxRounds`：最大响应轮数

### 连接器配置
侧栏「🔌 连接器」→ 点击 ⚙ → 填写服务地址/认证方式/Token → 测试连接

---

## 快速开始

```bash
# 克隆
git clone https://github.com/TTflysky/sirenhuisuo.git
cd hermes-office-pro

# 安装依赖
npm install

# 开发模式（两个终端并行）
npm run dev    # 终端 1：Vite dev server（http://localhost:5173）
npm start      # 终端 2：Electron 窗口

# 构建 + 打包 Windows 安装程序
npm run dist:win
# 产物：release/私人办公会所 Setup 0.3.0.exe
```

### 环境要求
- Windows 10/11
- Node.js 22+
- Git

### 注意事项
- 应用内不内置任何 API Key，所有模型配置需自行填写
- 安装包未签名，Windows SmartScreen 可能拦截，需手动「仍要运行」
- 技能库依赖本机安装的 WorkBuddy 技能（`~/.workbuddy/skills/`），无 WorkBuddy 时此功能不可用
- 本地开发分支是 `master`，远端发布分支是 `main`

---

## Git 工作流

```bash
# 每次实质性修改后提交并推送
git add -A
git commit -m "描述本次修改"
git push origin master:main
```

远端仓库：https://github.com/TTflysky/sirenhuisuo

---

## 版本历史

详见 [CHANGELOG.md](./CHANGELOG.md)

最新版本 v0.3.0 变更摘要：
- 团队自动讨论调度器（评分触发 + 400ms 聚合 + 团队级排队锁）
- 团队聊天界面升级（顶部头像条 + 左侧成员栏 + 点击 @）
- 连接器错误处理增强
- `discussionTrigger.ts` 自动触发判定引擎
- 讨论元数据回写（discussionId/discussionRound/triggeredBy）

---

## 已知问题与改进方向

- 打包后 bundle 超过 500KB（`INEFFECTIVE_DYNAMIC_IMPORT` 警告），可考虑 code splitting
- 调度器 `keys` Set 长期不清理，极端情况下可能占用内存（可加 LRU 或定时清理）
- 安装包未签名（需 Windows 代码签名证书）
- 自动更新服务 URL 配置为 example.com 占位符
- 单元测试未覆盖，当前仅依赖 Oxlint 静态检查

---

## 给 Codex 的快速上手指南

### 你首先需要读的文件（按优先级）
1. **`src/types.ts`** — 所有类型定义，理解数据模型
2. **`src/store.tsx`** — 状态管理 + 讨论调度器，理解业务逻辑
3. **`src/data/hermesClient.ts`** — LLM 调用 + 持久化，理解 AI 交互
4. **`electron/main.cjs`** — Electron 主进程，理解窗口和 IPC
5. **`src/engine/teamDiscussion.ts`** — 团队讨论编排核心
6. **`src/engine/discussionTrigger.ts`** — 自动触发判定引擎
7. **`plans/team-collaboration-auto-discussion.md`** — 自动讨论完整方案文档

### 关键设计决策
- **不用 Redux/Zustand**：手写 useReducer + Context，所有状态通过 `dispatch(action)` 修改
- **多窗口同步**：通过 `ipcBus.ts` 的 `win:broadcast` IPC 广播 `store:action` 到其他窗口
- **讨论调度器**：团队级 Map 锁 + Set 去重 + setTimeout 400ms 聚合 + queued 排队补触发
- **LLM 模型配置**：员工独立 > 助理配置 > 全局设置，三阶回退
- **连接器**：项目内置 HTTP JSON-RPC 实现，不是完整 MCP runtime
