# 窗口与连接器体验改造方案

## 1. 范围与约束

目标是修复四类已知问题：

1. Electron 聊天子窗口的 `focus` 回调触发 `bringToFront`，而 `bringToFront` 内部调用 `setAlwaysOnTop`，造成抢焦点/焦点事件循环。
2. `AssistantChat` 的设置入口位于底部 composer，长消息或窄窗口下不易发现。
3. `ModelSelector` dropdown 位于 composer 的布局/溢出边界内，菜单可能被裁剪、遮挡或高度受限。
4. `connectors.ts` 将 `mcp` 检查明确绑定 WorkBuddy，但腾讯文档和企业微信预设没有 actions，连接器启用后无法生成工具。

本方案只供 Coder 实施；Planner 阶段不修改实现代码。除新增本文件外，当前交付不应产生其他文件变更。

## 2. 当前实现基线

| 问题 | 当前位置 | 关键符号/字段 | 现状 |
|---|---|---|---|
| 子窗口抢焦点 | `electron/main.cjs:43-54` | `bringToFront(win)` | `show()`、`setAlwaysOnTop(true)`、`focus()`、`moveTop()` 后延时关闭置顶。 |
| focus 递归入口 | `electron/main.cjs:214-217` | `child.once('ready-to-show')`、`child.on('focus')` | `ready-to-show` 与每次 `focus` 都调用同一个会触发窗口状态变化的函数。 |
| 已有窗口复用 | `electron/main.cjs:187-190` | `ipcMain.handle('win:openChat')` | 复用子窗口时调用完整 `bringToFront`。 |
| 单实例激活 | `electron/main.cjs:432-436` | `app.on('second-instance')` | 对最近活动窗口调用完整 `bringToFront`。 |
| 助手设置按钮 | `src/components/chat/AssistantChat.tsx:317-335` | `showAssistantSettings`、`setShowAssistantSettings` | 设置按钮在 composer 顶部工具行，整体仍位于输入区底部。模态框在 `:391-399` 渲染。 |
| 模型菜单触发/渲染 | `src/components/chat/ModelSelector.tsx:12-18,116-179` | `open`、`menuRef`、`.model-selector-dropdown` | dropdown 作为触发器子节点普通渲染，关闭逻辑依赖 `menuRef` 外部点击。 |
| composer 溢出 | `src/theme.css:323-374` | `.chat-panel`、`.chat-layout`、`.chat-main`、`.chat-composer` | 上层 `overflow: hidden`，composer `max-height:45%; overflow-y:auto`。 |
| 菜单样式 | `src/theme.css:587-609` | `.model-selector`、`.model-selector-dropdown` | `position:absolute; bottom:100%; z-index:50`，但仍受祖先裁剪/堆叠上下文影响；同一规则同时声明 `overflow-y:auto` 和后面的 `overflow:hidden`。 |
| 连接器模型 | `src/data/connectors.ts:19-35,37-61` | `Connector.type`、`ConnectorAction.http` | `mcp/custom` 二分；action 只有可选 HTTP 描述，没有 MCP tool 标识/发现结果字段。 |
| MCP 预设 | `src/data/connectors.ts:185-193` | `CONNECTOR_PRESETS` | 腾讯文档 `mcpServerName:'tencent-docs'` 与企业微信 `mcpServerName:'wecom'` 均 `actions: []`。 |
| MCP 检查 | `src/data/connectors.ts:299-320` | `checkConnector(c)` | 所有 `mcp` 直接返回 `unknown`，错误文案写死“设置中配置”，没有运行时能力/工具检查。 |
| 工具生成/执行 | `src/engine/connectorTools.ts:6-54` | `getConnectorTools()`、`executeConnectorTool()` | 只从预设 `actions` 生成 OpenAI tools；空 actions 的 MCP 连接器自然无工具。 |
| MCP 配置提示 | `src/components/sidebar/ConnectorConfigModal.tsx:125-135` | MCP 提示块 | 文案明确要求 WorkBuddy，状态只有 connected/disconnected/unknown。 |

## 3. 设计决策

### 3.1 窗口聚焦：区分“显示/激活”和“用户 focus”

不要在 `child.on('focus')` 中调用会改变置顶状态的 `bringToFront`。建议将窗口操作拆成两个职责明确的函数：

- `showChatWindow(win, options?)`：只负责恢复最小化、显示和必要的首次激活；允许 `forceTop` 作为一次性行为，但必须保证一次调用内完成且不注册/触发递归 focus 逻辑。
- `focusChatWindow(win)`：用于 `win:openChat` 复用和 `second-instance`，只做 `restore()`、`show()`、`focus()`、`moveTop()`；默认不调用 `setAlwaysOnTop`。
- `bringToFront` 可以保留为兼容命名，但应改为一次性显式激活入口，不能由窗口自身 `focus` 事件调用。

`child.once('ready-to-show')` 只执行一次初始化显示；`child.on('focus')` 仅更新 `lastActiveWindow`（`trackActiveWindow` 已承担该职责），建议移除该监听，或只保留不改变窗口状态的埋点/状态更新。`ipcMain.handle('win:openChat')` 复用分支和 `app.on('second-instance')` 改用非置顶的激活函数。若 Windows 必须短暂置顶，限定在显式“打开/复用”动作，使用 `try/finally` 或一次性定时器清理，并增加重入保护字段/局部标记，验收不得出现连续 focus 日志。

必须维持：最小化窗口可恢复；同一 `key` 仍只创建一个子窗口；新窗口首次显示在计算出的 bounds；主窗口关闭仍关闭所有聊天子窗口。

### 3.2 AssistantChat 设置入口：提升到稳定的窗口工具栏

目标不是改变 `showAssistantSettings` 的业务状态，而是改变入口层级：

- 在 `src/components/chat/AssistantChat.tsx` 的 `chat-layout` 或 `chat-main` 顶部增加 assistant 专属工具栏，包含“设置”按钮，并继续使用 `setShowAssistantSettings(true)`。
- composer 顶部工具行 `:318-335` 不再作为唯一入口；避免保留两个会造成状态/布局混乱的入口。若保留快捷入口，必须使用同一 handler 并明确一个为主入口。
- `AssistantSettingsModal` 的渲染和 `onSaved -> refreshSettings` 行为保持不变。
- 工具栏不得进入消息滚动容器；在窄窗口仍可见，设置按钮应有稳定的 `aria-label`/`title`。
- 如 AssistantChat 在 `ChatOnlyView` 中被复用，工具栏样式仅新增 assistant 作用域 class，避免影响 DM/Team chat。

建议同步检查 `src/components/chat/ChatOnlyView.tsx`，确认顶部标题栏/窗口壳层是否已有可放置工具按钮的区域；若已有，优先复用该区域，不要另造第二条标题栏。

### 3.3 ModelSelector dropdown：脱离 composer 的裁剪边界

推荐使用 React portal 将 dropdown 挂载到 `document.body`，触发器仍留在 `ModelSelector` 内：

- `ModelSelector` 保留 `open`、`menuRef` 和选择逻辑；新增触发器 ref 与菜单定位状态，使用 `getBoundingClientRect()` 计算菜单的 viewport 坐标。
- dropdown 通过 `createPortal(..., document.body)` 渲染，菜单使用 `position: fixed`，以 viewport 坐标定位，不再依赖 `.chat-composer` 的 `position/overflow`。
- 定位字段至少包括 `top/left/width`；打开、窗口 resize、滚动时重新计算。菜单高度按 viewport 可用空间 clamp，不能超出顶部/底部。
- 外部点击判断要同时覆盖触发器和 portal 菜单；选择模型、手动输入回车、Escape 都要关闭菜单。
- 维护现有 `switchToLibraryModel`、`switchManualModel` 对 `assistantModelId/activeModelId` 的字段语义，不改变模型配置持久化契约。
- CSS `src/theme.css:587-609` 需移除依赖 `bottom:100%` 的定位假设，保留宽度、边框、阴影、滚动和高层级；不得让 portal 菜单被 `.chat-panel`/`.chat-composer` 的 `overflow:hidden/auto` 裁剪。
- 复查 DM、Team 两处调用：`src/components/chat/DmChatApp.tsx:296`、`src/components/chat/TeamChatApp.tsx:400`；三种 scene 均须能定位并关闭。

回退方案：若项目不希望引入 portal，可将 `.chat-layout`/`.chat-main` 改为允许可见溢出并建立明确 stacking context，但这会扩大布局影响，只有 portal 方案无法兼容时采用。

### 3.4 连接器能力模型：MCP 运行时与 HTTP actions 解耦

#### 3.4.1 数据字段调整方向

在 `src/data/connectors.ts` 保持现有 `Connector`、`ConnectorPreset`、`ConnectorAction` 命名的前提下扩展能力描述：

- `Connector.type` 继续表示接入通道，但不能用 `type === 'mcp'` 推导“必须 WorkBuddy”。新增运行时/适配器字段，建议命名 `runtime?: 'workbuddy-mcp' | 'native-mcp' | 'http'`，或等价的明确字段；已有 localStorage 数据必须有确定迁移默认值。
- 为 MCP 能力增加只读运行时状态字段，建议包括 `runtimeStatus?: 'available' | 'unavailable' | 'unknown'`、`discoveredActions?: ConnectorAction[]` 或等价的工具清单字段、`lastChecked`、`error`。不要把 token 或敏感配置写入日志/验收输出。
- `ConnectorAction` 增加可选 `source?: 'preset-http' | 'mcp-discovered'`、`mcpToolName?: string`（名称可按项目最终约定），并明确 MCP action 不应强行填写 `http`。
- `ConnectorPreset.actions` 继续支持 HTTP 预设；MCP 预设不能用空数组掩盖能力缺失，应区分“待运行时发现”和“确实没有动作”的状态。

字段最终命名需由 Coder 在现有 TypeScript 风格下统一，并在方案对应验收中覆盖 localStorage 旧数据。

#### 3.4.2 `checkConnector(c)` 契约

改造 `src/data/connectors.ts:299` 的 `checkConnector(c)`：

- `custom`：保留 baseUrl/auth 完整性校验和 `callConnectorApi` ping；返回 `connected/disconnected`。
- MCP：通过项目实际可用的 MCP/WorkBuddy bridge 查询服务是否存在并获取工具清单；不能直接把“无 bridge”当成 API 断开。建议返回结构扩展为 `{ status, error?, actions?, runtime? }`，其中 `actions` 是可执行工具清单，`unknown` 仅用于运行时不可判定。
- 不得在没有真实 bridge 或 MCP 工具 API 的情况下伪造腾讯文档/企业微信 action；若当前仓库没有 bridge，第一阶段应明确显示“未发现 MCP runtime/工具”，并保留连接器为不可执行状态。
- `ConnectorPanel.handleTest`（`src/components/sidebar/ConnectorPanel.tsx:61-71`）应保存检查返回的能力字段和错误；测试按钮不能只根据 `type === 'custom'` 隐藏 MCP 检查，MCP 也要能显式刷新能力状态。
- `ConnectorConfigModal.handleTest`（`src/components/sidebar/ConnectorConfigModal.tsx:22-38`）应展示 MCP runtime 与 discovered action 数量；配置保存仍走 `updateConnector`。

#### 3.4.3 工具生成与执行

修改 `src/engine/connectorTools.ts`：

- `getConnectorTools()`（`:6-27`）合并两类来源：HTTP preset actions 与已通过 runtime check 获取的 MCP discovered actions；只纳入 `enabled` 且能力状态可执行的连接器。
- MCP tool 的 OpenAI function name 必须稳定且不冲突，建议包含 connector identity，例如 `connector_${mcpServerName}_${mcpToolName}`，并在执行时按完整名称解析，不能只按 action 名称在多个连接器间首个命中。
- `executeConnectorTool()`（`:30-54`）按 connector id/server name + action/tool name 精确路由；HTTP action 继续调用 `executeConnectorAction`，MCP action 走 bridge；未发现 runtime 或工具时返回可解释错误。
- MCP bridge 的 IPC/调用适配器必须是独立边界，不能在 `connectors.ts` 中写死对 WorkBuddy 的全局依赖。若仓库尚无 bridge，先交付类型/状态/界面层的不可执行提示，后续以真实 bridge 接入作为单独任务。

#### 3.4.4 腾讯文档与企业微信预设

`src/data/connectors.ts:185-193` 的两个预设应改为“能力来源为 MCP runtime”的声明，并在 runtime 返回工具后动态展示。只有拿到实际 MCP server 暴露的工具 schema 后，才把具体 action 名、描述、parameters 写入 `discoveredActions`。验收不得接受静态空 actions 但 UI 显示“已连接”，也不得接受凭空写入未经 bridge 验证的腾讯文档/企业微信 API。

## 4. 有序实施步骤

1. **窗口行为隔离**：先改 `electron/main.cjs` 的 `bringToFront` 调用关系；验证 focus 不再触发 setAlwaysOnTop，复用/单实例仍激活目标窗口。
2. **助手入口迁移**：在 `AssistantChat.tsx`/必要的 `ChatOnlyView.tsx` 增加稳定工具栏，移除或重排 composer 内设置入口，保持 modal 状态与保存刷新不变。
3. **下拉层 portal 化**：改 `ModelSelector.tsx` 定位、外部点击、Escape、resize/scroll 生命周期；改 `theme.css` 菜单定位样式；分别验证 assistant/dm/team。
4. **MCP 状态与类型契约**：先调整 `connectors.ts` 类型、检查返回值和持久化迁移，再调整 `ConnectorPanel.tsx`、`ConnectorConfigModal.tsx` 的展示与测试入口。
5. **工具路由**：改 `connectorTools.ts` 的生成与精确执行路由；接入真实 MCP bridge（若仓库已有）或输出明确不可执行状态，禁止模拟成功。
6. **回归验证**：运行 `npm run build`、`npm run lint`；在 Electron 开发环境做窗口与三种聊天场景的手工/自动化验收。

## 5. 验收标准

### A. Electron 窗口

- 打开新 assistant/dm/team 子窗口后，窗口只显示/激活一次；`ready-to-show` 不产生重复置顶。
- 点击已打开子窗口，focus 事件不再调用 `bringToFront`，不再调用 `setAlwaysOnTop`；焦点稳定，不发生窗口闪烁或抢回主窗口焦点。
- 从第二实例触发时，最近活动窗口仍能恢复/激活；最小化窗口可恢复；同一聊天 key 不产生第二窗口。
- 关闭主窗口会清理所有子窗口，现有 owner、bounds、single-instance 行为不回归。

### B. AssistantChat

- 在 420px 最小子窗口宽度和普通窗口高度下，设置入口始终位于聊天顶部可见区域，不依赖滚动到底部。
- 点击设置入口仍打开 `AssistantSettingsModal`；保存后 `onSaved` 触发刷新，发送逻辑继续读取最新设置。
- DM/Team chat 不出现重复的 assistant 设置入口或样式污染。

### C. ModelSelector

- assistant、DM、Team 三种 scene 都能打开菜单；菜单不被 `.chat-panel`、`.chat-layout`、`.chat-main`、`.chat-composer` 裁剪。
- 菜单在窗口顶部/底部/左右边界附近均保持可见，最大高度不超过 viewport；滚动窗口或 resize 后位置更新。
- 点击菜单外、Escape、选择模型、手动模型回车均关闭菜单；现有 `assistantModelId`、`activeModelId`、`assistantModelConfig` 保存语义不变。
- 无模型库和多模型库两种状态均无空白/溢出布局；长 provider/model 名称显示省略而不撑破 composer。

### D. 连接器/MCP

- `checkConnector` 不再对所有 MCP 直接返回 WorkBuddy 专属文案；结果能区分 runtime 未发现、工具未发现、运行时可用、HTTP 连接失败等状态。
- 腾讯文档、企业微信在没有真实 MCP runtime 时显示“未发现/不可用”，不能显示“已连接”或产生虚假工具；runtime 可用时展示真实 discovered tools 数量与名称。
- MCP 测试入口可执行并持久化 `status/error/lastChecked` 及能力字段；custom HTTP 的原有 ping 和认证校验不回归。
- `getConnectorTools` 只为 enabled 且可执行的连接器生成工具；同名 MCP tools 不冲突；执行按 connector/server + tool 精确路由。
- 所有敏感 token 不出现在日志、错误文案、工具描述和方案验收输出中。

### E. 工程质量

- `npm run build` 通过。
- `npm run lint` 通过；如 lint 暴露已有问题，需在交付记录中区分新增问题与基线问题。
- 至少覆盖：窗口 focus 回调不调用置顶逻辑、ModelSelector portal 外部点击/边界定位、MCP 无 runtime/有 discovered tool/重复 tool 名、旧 localStorage 连接器数据迁移。

## 6. 风险与回退

- **Electron Windows 置顶差异**：若 `moveTop()` 在特定系统不可靠，只在用户显式打开/复用动作中短暂置顶，并加一次性重入保护；禁止恢复 focus 回调中的置顶。
- **Portal 定位复杂度**：优先 portal；失败时回退到放宽父级 overflow，但必须验证消息区滚动和 composer 高度不回归。
- **MCP bridge 不存在**：不伪造 API；拆为“状态/类型/UI 可解释失败”与“真实 bridge 接入”两个交付阶段。
- **旧 localStorage 数据**：读取时兼容缺少新字段的连接器，保存时补齐默认 runtime/status；不能清空用户已有连接器。
- **同名工具冲突**：执行路由必须携带连接器身份；不能依赖遍历顺序或 action name 首次匹配。

## 7. 变更文件清单

预计实现文件：

- `electron/main.cjs`
- `src/components/chat/AssistantChat.tsx`
- `src/components/chat/ChatOnlyView.tsx`（仅在现有标题栏可复用时）
- `src/components/chat/ModelSelector.tsx`
- `src/components/chat/DmChatApp.tsx`（仅需调整调用容器时）
- `src/components/chat/TeamChatApp.tsx`（仅需调整调用容器时）
- `src/theme.css`
- `src/data/connectors.ts`
- `src/engine/connectorTools.ts`
- `src/components/sidebar/ConnectorPanel.tsx`
- `src/components/sidebar/ConnectorConfigModal.tsx`
- 新增测试文件应放在 `src/__tests__/`，但需按项目现有测试基础设施确认后再创建。

本次 Planner 交付只新增：`plans/window-connector-experience.md`。
