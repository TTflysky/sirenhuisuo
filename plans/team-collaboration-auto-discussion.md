# 团队协作自动讨论与 @ 体验方案

## 1. 目标与范围

### 目标

1. 用户创建团队后发送消息，系统根据消息紧急程度、是否需要团队协作、是否已有明确 @ 等信号自动判断是否发起讨论；继续保留“发起讨论”手动入口。
2. 团队成员按话题相关性参与讨论；消息明确 @ 某成员时，该成员必须在本轮响应。
3. 优化 TeamChat 的 @ 体验：聊天窗口顶部显示群成员头像列表；左侧显示当前团队成员列表及头像；点击头像将 `@成员名称` 插入输入框。
4. 自动讨论必须可观测、可去重、可节流，并能在异常或模型不可用时安全回退到现有手动流程。

### 非目标

- 不改变现有员工模型配置、头像资源格式、Electron 聊天窗口协议。
- 不把“所有成员都参与”作为默认规则；无关成员应跳过，明确 @ 的成员例外必须参与。
- 不把自动讨论做成无限递归的消息监听器。

## 2. 现状与根因

### 现状

- `src/components/chat/TeamChatApp.tsx:19` 是团队聊天主界面，已维护 `teamMembers`、@ 候选弹窗和 `insertMention`。
- `src/components/chat/TeamChatApp.tsx:82` 的发送流程会解析文本中的 `@name`，并把员工 ID 写入 `ChatMessage.mentions`，随后调用 `sendMessage`。
- `src/components/chat/TeamChatApp.tsx:124` 仅在 `loadSettings().autoDiscuss` 为真时，发送后固定延迟 400ms 调用 `triggerDiscussion`。
- `src/store.tsx:234` 的 `sendMessage` 只追加一条消息，不负责讨论判断。
- `src/store.tsx:361` 的 `createTeam` 生成带欢迎文本的团队；创建团队后没有自动讨论状态或待触发事件。
- `src/store.tsx:449` 的 `triggerDiscussion` 只用 `discussingRef` 做团队级并发锁，按固定四角色计算进度。
- `src/engine/teamDiscussion.ts:105` 的 `runTeamDiscussion` 固定依次处理 `pm`、`planner`、`coder`、`checker`，只通过 `memberByRole` 找每个角色的第一位成员。
- `src/engine/teamDiscussion.ts:148` 调用 `handlers.onMessage(emp, content, [], tokens)`，AI 消息没有产生 @ 目标，因此无法驱动被 @ 响应保证。
- `src/types.ts:15` 的 `Employee` 已有 `name`、`role`、`avatar`、`avatarKind`、在线状态等字段；`src/types.ts:35` 的 `Team` 通过 `memberIds` 关联成员；`src/types.ts:56` 的 `ChatMessage` 已有 `mentions`、`attachments` 和 `skillRefs`。
- `src/components/office/AgentAvatar.tsx:9` 已统一处理 preset/custom 两类头像，适合复用到顶部头像条、左侧成员列表和 @ 插入按钮。
- `src/components/chat/ChatOnlyView.tsx:25` 仅负责独立窗口路由和标题，不需要改变窗口协议。
- `src/data/hermesClient.ts:40` 的 `AppSettings.autoDiscuss` 是现有全局开关，语义是发消息/任务后自动讨论，默认关闭。

### 根因

1. 自动讨论入口散落在聊天 UI 与 `publishTask`，发送消息的核心服务没有统一的判定与调度层，无法融合紧急程度、协作需求、@ 目标和最近讨论状态。
2. 讨论参与者由固定角色列表决定，而不是由消息主题、成员职责与显式 @ 决定，无法支持自定义成员和多名同角色成员。
3. @ 目前只是消息文本解析和视觉高亮，讨论引擎没有把 `mentions` 作为硬约束，也没有把 AI 回复中的 @ 继续路由给目标成员。
4. 团队状态只有一个 `demoRunning` 和团队级 `discussingRef`，缺少触发指纹、冷却窗口、讨论轮次上限和消息来源标记，存在重复触发及递归讨论风险。
5. TeamChat 只有消息流和右侧产出物面板，成员信息只能在空状态或 @ 弹窗中看到，无法快速浏览团队成员或点击头像完成 @。

## 3. 建议架构

采用“发送消息 -> 自动触发判定 -> 讨论调度 -> 参与者选择 -> 顺序发言 -> @ 路由”的单向流程。

1. `sendMessage` 成功追加消息后，调用纯函数 `evaluateDiscussionTrigger`。
2. 判定结果交给团队级 `DiscussionScheduler`（可先放在 `store.tsx`，后续再拆到 `src/engine/discussionScheduler.ts`）。
3. 调度器负责团队级去重、节流、排队和最大轮次，不直接决定业务参与者。
4. `teamDiscussion.ts` 接收参与者计划与触发上下文，先保证显式 @ 成员，再按相关性补充成员。
5. 每条 AI 消息记录实际 `mentions`；若 AI 消息 @ 了尚未响应的成员，则把目标加入当前讨论队列，但受最大轮次和已响应集合约束。
6. 手动“发起讨论”绕过自动阈值，但仍复用同一调度器、去重锁、最大轮次和异常回退机制。

## 4. 文件清单

### 需要修改

- `src/types.ts`
  - 增加自动触发上下文、触发判定、参与者计划、讨论元数据等类型。
  - 扩展 `ChatMessage` 的讨论来源/轮次字段，保持旧数据可选兼容。
- `src/store.tsx`
  - 将消息发送后的自动判定集中到 store。
  - 创建团队欢迎消息后不自动讨论；首条用户消息走统一调度。
  - 为自动和手动讨论提供统一排队、去重、节流、取消与完成清理。
  - 将 `mentions`、讨论元数据传入 `runTeamDiscussion`。
- `src/engine/teamDiscussion.ts`
  - 支持参与者计划而非固定四角色。
  - 解析并传播 AI 回复中的 @，强制路由显式目标成员。
  - 增加响应轮次、已响应成员和讨论结束条件。
- `src/components/chat/TeamChatApp.tsx`
  - 删除 UI 层直接依据 `autoDiscuss` 调用讨论的职责，改由 `sendMessage` 统一处理。
  - 增加顶部成员头像条、左侧团队成员栏和头像点击 @。
  - 保留并突出手动“发起讨论”按钮。
- `src/theme.css`
  - 增加团队聊天三段式布局、头像条、成员侧栏、窄窗口响应式规则。
  - 复用现有变量和 `.mention-popup` 视觉语言。
- `src/components/sidebar/CreateTeamModal.tsx`
  - 成员选择项复用 `AgentAvatar`，让创建团队时头像与聊天内展示一致。

### 可选新增

- `src/engine/discussionScheduler.ts`
  - 当 `store.tsx` 的调度逻辑超过团队状态管理职责时再拆分；首版也可保留在 store，避免过度抽象。
- `src/components/chat/TeamMemberSidebar.tsx`
  - 仅当 `TeamChatApp.tsx` 的布局改动导致可读性明显下降时拆出。
- `src/components/chat/TeamMemberAvatarStrip.tsx`
  - 仅当顶部头像条需要在 TeamChat 之外复用时拆出。

## 5. 接口与数据结构

### 5.1 自动触发设置

保留 `AppSettings.autoDiscuss` 作为总开关，并新增可选策略字段：

- `autoDiscussMode`: `off | smart | always`，旧 `autoDiscuss: true` 映射到 `smart` 或由设置迁移明确指定。
- `autoDiscussCooldownMs`: 默认 8000，团队级自动触发冷却。
- `autoDiscussMaxRounds`: 默认 8，单次讨论最多响应轮次。
- `autoDiscussMinScore`: 默认 3，智能判定阈值。

兼容策略：旧用户仅有 `autoDiscuss` 时，`false/undefined` 视为 `off`，`true` 视为 `smart`。

### 5.2 触发输入与判定结果

`DiscussionTriggerInput` 应包含：

- `teamId`
- `messageId`
- `userText`
- `mentions`
- `hasAttachments`
- `recentMessages`（建议最近 12 条）
- `activeTaskCount`
- `manual: boolean`
- `now`

`DiscussionTriggerDecision` 应包含：

- `shouldStart`
- `score`
- `urgency`: `low | normal | high | critical`
- `needsCollaboration: boolean`
- `reasonCodes: string[]`
- `forcedMemberIds: string[]`
- `dedupeKey`
- `cooldownUntil`

### 5.3 讨论元数据

建议在 `ChatMessage` 上增加可选字段：

- `discussionId?: string`
- `discussionRound?: number`
- `triggeredBy?: 'manual' | 'message' | 'task' | 'mention-followup'`
- `inReplyToMessageId?: string`

在 store 内维护易失的运行态：

- `activeDiscussionByTeam: Map<teamId, { discussionId, startedAt, lastMessageAt, rounds, respondedIds, pendingIds }>`
- `lastAutoTriggerByTeam: Map<teamId, { dedupeKey, triggeredAt }>`
- `queuedTriggerByTeam: Map<teamId, DiscussionTriggerInput>`

不把运行锁持久化到 localStorage；应用重启后以历史消息中的 `discussionId` 做短窗口去重即可。

### 5.4 参与者计划

`DiscussionParticipantPlan`：

- `memberId`
- `priority`: `forced | high | normal`
- `relevanceScore`
- `reason`: `mentioned | role-match | keyword-match | task-lane | fallback`
- `maxResponses`: 默认 1

`runTeamDiscussion` 接收：

- `participantPlan`
- `triggerMessageId`
- `discussionId`
- `maxRounds`
- `forcedMemberIds`

`DiscussionHandlers.onMessage` 应增加 `mentions`、`discussionRound` 和 `inReplyToMessageId`，由 store 统一生成 `ChatMessage`。

## 6. 自动触发算法

### 6.1 基础门槛

1. `manual=true` 时直接允许进入调度器，但仍受当前团队已有讨论锁限制。
2. `autoDiscussMode=off` 时自动消息不触发。
3. 无团队成员时不触发，并记录 `no-members` 原因。
4. 空白消息且无附件不触发。
5. 正在讨论时不并发启动；保留最新一条可讨论消息作为待处理触发，讨论结束后只评估一次。

### 6.2 紧急程度识别

先使用确定性规则，避免每条消息额外调用模型：

- `critical`：包含“立即、紧急、阻塞、线上故障、无法发布、P0、截止现在”等词，或包含明确时间压力与失败结果。
- `high`：包含“尽快、今天、截止、需要处理、请排查、回滚、修复”等词。
- `normal`：描述需求、方案、任务、问题排查，但无明显时间压力。
- `low`：问候、确认收到、简短状态同步、纯链接/纯附件说明。

可将文本规范化后匹配，避免大小写和全角符号导致漏判。规则只用于触发评分，不修改原始消息。

### 6.3 协作需求评分

建议初始评分：

- 紧急程度：`critical +4`、`high +3`、`normal +1`、`low +0`
- 明确要求团队/讨论/评审/方案/实现/排查：`+3`
- 包含任务型动词或交付物（实现、设计、写代码、验收、发布、文档）：`+2`
- 当前存在未完成任务：`+1`
- 有附件、代码片段、日志或较长上下文：`+1`
- 明确 @ 成员：每个目标 `+2`，但总加分上限 `+4`
- 纯确认/感谢/“收到”：`-3`

`needsCollaboration` 在出现任务型协作意图、明确 @、或评分达到 3 时为真。`shouldStart = score >= autoDiscussMinScore`。`critical` 或明确 @ 时，即使低于阈值也应触发，但仍受去重和团队锁控制。

### 6.4 主题相关成员选择

1. 先将 `mentions` 中属于当前团队的成员加入 `forced`，顺序优先于相关性。
2. 从消息和最近上下文提取关键词，匹配成员的 `name`、`title`、`role` 及可选 `prompt/soul` 中的职责词。
3. 根据任务 lane 增加角色匹配：`PLANNING -> planner/pm`，`CODING -> coder/planner`，`REVIEW -> checker/coder`。
4. 角色匹配和关键词匹配计算 `relevanceScore`，只保留超过最低分的成员。
5. 若没有相关成员但消息达到触发阈值，回退为团队中在线成员；至少包含 `pm` 或团队首个在线成员。
6. 同一成员只能生成一个参与计划；同角色多成员按相关性、在线状态、最近是否已响应排序。
7. 最终计划默认最多 6 名成员，避免团队过大导致成本和延迟失控；被 @ 成员不受普通相关性过滤影响，但总参与人数仍需受最大人数保护并优先保留所有强制目标。

## 7. 去重、节流与防止无限讨论

### 去重

- `dedupeKey = teamId + normalizedMessageFingerprint + recentMessageTail`，规范化包括去空白、截断长度和小写化。
- 同一消息 ID 只允许一个自动触发。
- 同一团队在冷却窗口内收到相同或高度相似文本，只保留最新触发，不重复启动。
- 手动触发不因内容指纹被静默吞掉，但若团队已有进行中的讨论，应提示“讨论进行中”并不再并发。

### 节流与排队

- 单团队自动触发冷却默认 8 秒；高优先级消息可以缩短为 2 秒，但不能绕过活动讨论锁。
- 多条消息在 400ms 聚合窗口内合并为一个触发上下文，使用最后一条消息作为主消息、保留所有 @ 目标并拼接最近文本摘要。
- 讨论结束后，若队列存在消息，仅重新评估一次，避免逐条补发讨论。
- 跨团队允许并行，但沿用现有全局 `demoRunning` 展示能力时需改为按团队进度或明确限制为单团队；建议首版保持单团队运行以降低 UI 和模型并发风险。

### 无限讨论防护

- 每次讨论使用固定 `discussionId`、`maxRounds`，默认最多 8 轮。
- 每个成员默认只响应一次；被 @ 的成员如果尚未响应可插入一次额外响应，但同一成员最多 2 次。
- AI 产生的新消息不能直接调用 `sendMessage` 自动触发，只能通过当前讨论的内部队列处理。
- 只有新消息 @ 了尚未响应成员且该成员未达到次数上限时，才追加下一步。
- 连续两轮内容指纹无变化、模型输出为空、或全部成员无新增信息时提前结束并记录结束原因。
- 达到轮次/人数上限时追加系统状态消息或进度状态，不再继续调用模型。

## 8. @ 响应保证

### 用户消息

- 发送前保持现有 `@name` 解析，但改为只接受当前团队成员，避免误 @ 团队外员工。
- `ChatMessage.mentions` 记录稳定员工 ID；显示文本仍保留 `@名称`。
- 点击顶部头像或左侧成员头像，调用同一 `insertMention`，插入到当前光标位置或当前未完成 @ 片段，不覆盖其他文本。

### AI 消息

- `memberSpeak` 返回文本后，使用团队成员名称表解析 `@名称`，生成合法的 `mentions` ID；未知名称不进入路由。
- 调度器维护 `pendingIds` 和 `respondedIds`。每次 AI 消息的 `mentions` 与当前参与计划合并，强制目标进入待响应队列。
- 被 @ 成员即使原始主题相关性低，也必须被加入当前讨论；若其离线/模型失败，记录失败并继续，不得静默跳过。
- 被 @ 成员响应时，在提示词中加入“这是对你明确 @ 的响应，请先直接回应被问内容，再补充专业判断”。
- 每条 AI 回复的 `mentions`、`inReplyToMessageId` 和 `discussionRound` 写入消息，便于 UI 高亮、验收和后续去重。
- 无法匹配名称时，要求模型使用标准员工名称；仍无法解析时只展示文本，不虚构员工 ID，并在调试日志记录未解析 token。

## 9. UI 布局及响应式策略

### 桌面布局

`TeamChatApp` 建议形成三列但保留右侧产出物面板的可选性：

1. 顶部固定团队头部：团队图标/名称、讨论状态、横向群成员头像条。
2. 左侧成员栏：宽度约 180 至 220px，显示当前团队成员头像、姓名、title、在线/工作状态；每项为可点击按钮，点击后插入 @。
3. 中间主区：进度条、消息流、工具栏、任务表单、输入框。
4. 右侧仍由 `showOutputs` 控制产出物面板；打开时中间区自适应收缩。

### 顶部头像条

- 使用 `AgentAvatar`，头像尺寸建议 28 至 32px，使用 `title/aria-label` 显示姓名和状态。
- 成员超过可用宽度时横向滚动，不换行，不遮挡团队名称和讨论按钮。
- 当前发言成员、正在思考成员使用状态环或小圆点，不改变头像尺寸。
- 头像条与左侧成员列表使用同一个 `teamMembers` 派生集合，避免排序和成员缺失不一致。

### 左侧成员列表

- 成员项为可聚焦按钮，包含头像、姓名、title 和在线状态；不要把点击行为绑定在纯 `div` 上。
- 点击时将 @ 插入并聚焦输入框；当前输入框处于 `@query` 状态时替换 query，否则插入到光标位置。
- 成员列表可按团队 `memberIds` 顺序展示，保持与创建团队选择顺序一致；没有成员时显示空状态。
- 侧栏宽度不足时隐藏 title，仅保留头像和姓名首行；更窄时收缩为垂直头像栏并通过 tooltip 提供姓名。

### 响应式断点

- `min-width >= 900px`：左侧成员栏 + 主聊天区 + 可选右侧产出物。
- `600px <= width < 900px`：左侧成员栏缩至 150px；右侧产出物改为覆盖面板或隐藏在按钮中。
- `width < 600px`：隐藏左侧文字成员栏，保留横向头像条；点击头像仍 @；工具栏允许横向滚动或分组折叠，输入区固定在底部。
- 头像、按钮和输入框使用稳定尺寸，避免成员名称、状态文本导致布局抖动。
- 独立 Electron 窗口和浏览器窗口共用同一响应式 CSS，不修改 `ChatOnlyView` 路由。

## 10. 实现步骤

1. 在 `types.ts` 定义触发判定、参与计划和讨论元数据类型，字段全部以可选方式兼容历史消息。
2. 在 `teamDiscussion.ts` 抽出“解析 @、计算参与者、执行单轮响应”的职责；让固定四角色逻辑变成无计划时的兼容回退。
3. 在 `store.tsx` 增加发送后统一调度入口，迁移 `TeamChatApp` 与 `publishTask` 的自动触发调用，确保每个消息来源只触发一次。
4. 在 store 或独立 scheduler 中实现团队级锁、消息聚合、指纹去重、冷却、排队和讨论结束清理。
5. 在 `TeamChatApp.tsx` 增加成员派生数据、顶部头像条、左侧成员栏、点击头像插入 @，并把 @ 解析限制在当前团队。
6. 在 `theme.css` 完成桌面/窄窗口布局及状态样式。
7. 在创建团队成员选择项中复用 `AgentAvatar`，验证头像 preset/custom 两种来源都能展示。
8. 更新设置文案，明确 `smart`、`always`、`off` 的区别；旧 `autoDiscuss` 用户设置迁移到 `smart`。
9. 增加单元测试、组件测试和端到端验收，最后执行现有构建与 lint/typecheck。

## 11. 测试与验收清单

### 自动触发

- [ ] `autoDiscussMode=off` 时，普通消息、紧急消息、任务消息均不自动触发；手动按钮仍可用。
- [ ] 普通问候/感谢不触发，且不会产生延迟讨论。
- [ ] 含“紧急/阻塞/线上故障”等词的消息达到阈值并触发一次。
- [ ] 需求、设计、实现、评审类消息能触发协作讨论。
- [ ] 发送消息与发布任务不会因 UI 和 store 双重入口产生两次讨论。
- [ ] 400ms 聚合窗口内多条消息只形成一次讨论上下文。

### 参与者与 @

- [ ] 自定义角色成员可依据 title/prompt 相关性参与。
- [ ] 同角色多成员只选择相关成员，不再固定取第一位。
- [ ] 用户 @ 单个成员时，该成员必定响应。
- [ ] 用户一次 @ 多名成员时，所有合法目标都响应且各最多一次/按上限执行。
- [ ] AI 回复中 @ 尚未响应成员时，目标被加入待响应队列。
- [ ] 已响应成员再次被 @ 时受次数上限约束，不无限重复。
- [ ] 团队外员工名称不会被写入当前团队消息 mentions。
- [ ] 未知 @ 名称不会造成异常或虚构员工 ID。

### 去重与边界

- [ ] 同一消息重复事件不会重复触发。
- [ ] 冷却期内相同消息被合并或丢弃，并保留明确原因。
- [ ] 讨论进行中发送多条消息，结束后最多追加一次待处理讨论。
- [ ] 达到最大轮次、最大参与人数或内容无变化时停止。
- [ ] API 失败、成员离线、模型返回空内容时讨论能结束并释放锁。
- [ ] 手动讨论与自动讨论不能并发运行同一团队。

### UI

- [ ] 顶部显示全部团队成员头像，头像包含姓名和状态的可访问标签。
- [ ] 左侧显示头像、姓名、title、在线/工作状态。
- [ ] 点击顶部或左侧头像均能在输入框插入 @ 名称。
- [ ] 光标位于文本中间时插入位置正确；已有 `@query` 时只替换 query。
- [ ] @ 弹窗、头像条和侧栏不会遮挡消息或输入框。
- [ ] 900px、600px、移动窄宽度下布局不溢出、不抖动，仍能发送消息。
- [ ] preset 与 custom 头像均正常渲染。

### 回归

- [ ] 手动“发起讨论”仍显示并执行。
- [ ] 任务卡认领、推进、导出和产出物面板不受影响。
- [ ] Electron 独立聊天窗口和普通浏览器聊天窗口行为一致。
- [ ] 历史无讨论元数据的消息正常加载和显示。

## 12. 风险与回退

### 风险

- 关键词评分可能误判含有“紧急”等词的普通讨论；需保留触发原因和设置阈值，便于调参。
- 相关性依赖 title/prompt 文本质量，自定义成员可能被漏选；必须保留低相关性回退成员。
- AI 输出的名称可能与员工姓名不完全一致，@ 路由存在解析失败；应以稳定 ID 为内部事实，名称仅作显示。
- 多成员参与会增加 API 成本和等待时间；默认限制人数与轮次，并在进度条展示预计步骤。
- 运行态锁在多窗口环境中可能出现竞争；现有 store action 广播只同步状态 action，自动调度锁不应仅依赖广播，首版建议按单窗口/单团队串行，并在收到远端消息时用消息元数据二次去重。
- 左侧栏会压缩独立小窗口的主聊天区；窄窗口必须退化为头像栏，不能强行保留文字侧栏。

### 回退策略

1. 设置层保留 `autoDiscuss` 旧开关；出现误触发时将模式切换为 `off`，手动按钮不受影响。
2. 相关性算法异常时回退固定角色顺序，但仍应用显式 @、轮次上限和去重锁。
3. 讨论调度异常时只追加用户消息，不阻塞发送流程；记录错误并允许用户手动再次发起。
4. @ 路由解析异常时保留原始文本和 `mentions=[]`，不删除消息、不阻塞讨论完成。
5. UI 样式异常时可隐藏左侧成员栏，只保留顶部头像条和现有聊天主区；不修改数据结构和聊天窗口协议。
6. 历史数据迁移失败时所有新字段保持可选，继续按旧 `autoDiscuss` 和固定讨论行为运行。

## 13. 验收结论标准

只有同时满足“智能消息可触发且可解释”“明确 @ 必响应”“讨论不会重复或无限增长”“头像侧栏和点击 @ 在窄窗口可用”“手动入口和旧数据兼容”五项，才将任务看板推进到 `[CODING]` 后交给 Coder 实施。