# 更新日志

## v0.2.4 (2026-07-23)

### 新增
- **技能库板块**：第四主视图「🧩 技能库」，扫描本地已安装 WorkBuddy 技能（`~/.workbuddy/skills/`），展示名称、说明、来源、版本，支持搜索和详情查看。
- **聊天 @ 技能引用**：DM/团队/助手输入框输入 `@` 弹出技能选择，键盘导航，选中显示 chip，发送时读取正文注入 AI 上下文。消息和 localStorage 不存正文。
- **GitHub 远端**：项目推送至 https://github.com/TTflysky/sirenhuisuo，每次修改自动推送溯源。

### 新增文件
- `electron/skills.cjs` — 技能扫描与安全读取服务
- `src/data/skills.ts` — 技能数据加载层
- `src/components/skills/SkillLibraryView.tsx` — 技能库浏览面板
- `src/components/skills/SkillMentionInput.tsx` — @ 技能搜索选择输入组件
- `README.md`、`CHANGELOG.md`

---

## v0.2.3 (2026-07-22)

### 修复
- **聊天窗口被主界面遮挡**：Windows 上聊天窗口改为主窗口的非模态 owned window，始终位于本应用上方，但不压住外部应用。移除 300ms 临时全局置顶方案。
- **输入栏不能贴底**：补齐 `html → body → #root → .app-root` 全高 flex 链，消息区自动占满剩余高度并独立滚动，输入栏固定底部。
- **顶栏 Segmented 不可点击**：`.view-tabs` 及其后代显式 `no-drag`，修复 Ant Design Segmented 被 Electron 拖拽区吞点击。「数据分析」「自主办公」恢复点击。
- **级联窗口重叠**：改用实际占用探测算法，对角槽优先、有限网格回绕。开 A/B/C 后关 B 开 D 不会与 C 重叠。

---

## v0.2.2 (2026-07-22)

### 修复
- **统一原生聊天窗口**：左侧员工头像与办公室工位统一调用 `openDmChat`；DM/团队/助手统一通过 Electron `BrowserWindow` 打开。
- **删除双轨浮窗**：移除 `FloatWindowLayer`、`WinState` 及应用内浮窗 actions。
- **窗口去重复用**：按聊天业务 key 用 `Map` 管理，重复点击聚焦已有窗口。
- **级联定位**：新窗口按主窗口位置 28px 级联偏移，限制在显示器工作区。
- **标题栏按钮**：`ChatOnlyView` 统一最小化/关闭按钮。
- **消息滚动**：补齐 flex 高度链，消息区独立滚动，输入栏自适应。

---

## v0.2.1 (2026-07-22)

### 发布
- 安装包 `release/私人办公会所 Setup 0.2.1.exe`

---

## v0.2.0 (2026-07-22)

### 修复
- **套娃根因**：移除 `sessionStorage` 子窗口检测，仅用 `location.hash` 判断。
- **标题栏按钮失效**：拖拽区域仅限 `.titlebar-left`。
- **对话框自适应+滚动**：补齐聊天 flex 高度链。
- **多模型库**：Settings 支持添加/编辑/删除/测试模型，测试通过高亮绿点。
- **助理模型选择器**：办公页侧栏直接切换模型。
- **模型回退**：员工→助理模型→全局设置三阶回退。

---

## v0.1.14 (2026-07-22)

### 修复
- **标题栏按钮失效**：drag 区域仅限 titlebar-left，右侧按钮区独立 no-drag。
- **团队展开为空**：修复 TeamChatApp 三元表达式破坏 `.map()` 回调的问题。

---

## v0.1.13 (2026-07-22)

### 修复
- **点击员工替换主窗口**：移除 hashchange 监听器，子窗口检测仅首次渲染读一次 hash。
- **浏览器 fallback**：从 `location.hash` 改为 `window.open` 新标签页。

---

## v0.1.12 (2026-07-22)

### 修复
- **点击失效真因**：App.tsx 把所有 hooks 移到 hash 判断前，加 hashchange 监听。
- **助理模型选择**：侧栏嵌入模型选择器，三阶回退（员工→助理→全局）。

---

## v0.1.11 (2026-07-22)

### 修复
- **点击失效**：Electron fallback → 非 Electron 环境走 `location.hash`。
- **团队管理**：Dropdown 操作菜单（重命名/归档/删除），二次确认弹窗。

---

## v0.1.10 (2026-07-22)

### 新增
- **Ant Design 引入**：antd ^6.5.1，全局 ConfigProvider+AntApp，theme token 主色 `#1a1f36`。
- 迁移：顶栏 Segmented+Button、SettingsModal、EditEmployeeModal、AutopilotPanel。

---

## v0.1.9 (2026-07-22)

### 新增
- **自主办公可中断**：停止按钮，`shouldStop` 回调。
- **工作区一键导出 zip**：powershell Compress-Archive，零额外依赖。

---

## v0.1.8 (2026-07-22)

### 新增
- **自主代理引擎**：真实文件系统桥（沙箱工作区），ReAct 内核工具调用循环。
- **改名**：软件对外名「私人办公会所」。

---

## v0.1.7 (2026-07-22)

### 新增
- **窗口间 IPC 广播层**：主办公室与聊天子窗口实时状态同步。
- **store 跨窗口同步**：团队消息/任务/进度/员工实时一致。

---

## v0.1.6 (2026-07-22)

### 新增
- **聊天窗口改为原生桌面窗口**：独立 BrowserWindow，frame:false 无边框，CSS drag 拖动。
- **文件上传/粘贴**：附件分类、图片多模态视觉、文件保存为产出物。
- **ChatOnlyView**：解析 #chat hash，统一聊天子窗口入口。

---

## v0.1.5 (2026-07-22)

### 修复
- HTML 产出物撑开 UI → iframe sandbox 沙箱。
- 浮窗全屏覆盖，clampPos 全屏范围。

---

## v0.1.4 (2026-07-22)

### 修复
- 产出物面板不再导致全局布局变化。
- 外部浏览器打开产出物预览。

---

## v0.1.3 (2026-07-22)

### 新增
- **ChatOutputsPanel**：聊天内嵌产出物面板。
- **OutputRenderer**：多类型预览（Markdown/HTML/代码/JSON/CSV/图片/URL）。
- **OutputRecord**：contentType + scope 字段，分项目过滤。

---

## v0.1.2 (2026-07-22)

### 新增
- **浮窗拖拽边界 clamp + 置顶 + 文本复制 + 右侧产出物面板**。
- **链接可点击**：linkify 自动检测渲染。
- 安装包 `Hermes 主动协作办公室 Setup 0.1.2.exe`（80MB）。

---

## v0.1.1 (2026-07-22)

### 新增
- **初始版本**：Electron + Vite + React 骨架，OPC 四角色种子员工和团队，OpenAI 兼容 API 调用。
- 安装包 `Hermes 主动协作办公室 Setup 0.1.1.exe`（80MB）。
