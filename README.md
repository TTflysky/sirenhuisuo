# 私人办公会所（Hermes Office Pro）

AI 虚拟办公室桌面应用 —— 让多名 AI 员工在一间虚拟办公室里协作办公。

## 这是什么

一个基于 Electron + React + TypeScript 的 Windows 桌面应用。你在虚拟办公室里雇佣 AI 员工（PM、Planner、Coder、Checker），组建团队，发起讨论，分配任务，AI 员工自主协作推进项目。支持 OpenAI 兼容 API（DeepSeek、千问、智谱、Kimi、豆包、混元等），每个员工可独立配置模型。

## 核心能力

- **四角色 OPC 架构**：PM（协调者）→ Planner（规划者）→ Coder（编码者）→ Checker（审查者），AI 员工自动编排协作。
- **原生聊天窗口**：每个员工/团队/助手对话都是独立 Windows 窗口，可拖动、自由排列。
- **自主办公**：AI 团队自主规划项目、写代码、跑命令、验证结果，全程自动化。
- **真实文件系统**：AI 可在沙箱工作区内真实读写文件、安装依赖、执行命令。
- **多模型支持**：DeepSeek / 千问 / 智谱 / Kimi / 豆包 / 混元 / OpenAI / Ollama / 自定义端点。
- **技能库**：扫描本地已安装的 WorkBuddy 技能，聊天中 `@` 即可注入技能指令。
- **文件上传/粘贴**：聊天支持图片附件（多模态视觉）和文件附件。
- **产出物面板**：聊天内嵌产出物列表，支持多类型预览（Markdown/HTML/代码/图片）。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 33 |
| 前端 | React 19 + TypeScript 6 |
| UI 库 | Ant Design 6 |
| 构建 | Vite 8 |
| 打包 | electron-builder |
| 存储 | localStorage 全量持久化 |
| LLM | OpenAI 兼容 API（/v1/chat/completions） |

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（Vite + Electron 并行）
npm run dev    # 终端 1：启动 Vite
npm start      # 终端 2：启动 Electron

# 构建 + 打包 Windows 安装程序
npm run dist:win
```

打包产物在 `release/私人办公会所 Setup x.x.x.exe`。

## 换电脑继续开发

```bash
# 克隆完整项目（包含源代码、版本历史、README、CHANGELOG 和全部历史安装包）
git clone https://github.com/TTflysky/sirenhuisuo.git
cd hermes-office-pro
npm install
```

开发前需要准备：

- Windows 10/11，Node.js 22+，Git。
- 在应用设置中填写自己的模型 API，不要把 API Key 写入代码或提交到 Git。
- 若要使用技能库，需要在新电脑安装 WorkBuddy 技能到 `%USERPROFILE%\\.workbuddy\\skills\\`；应用会自动扫描 `SKILL.md`。
- 本地开发：先运行 `npm run dev`，再运行 `npm start`。
- 生成新安装包：先将 `package.json` 和 `package-lock.json` 的版本号升级，再运行 `npm run dist:win`。
- 每次实质性修改后执行：

```bash
git add -A
git commit -m "描述本次修改"
git push origin master:main
```

当前远端：`https://github.com/TTflysky/sirenhuisuo`。本地开发分支是 `master`，远端发布分支是 `main`。

## 项目结构

```
src/
├── main.tsx                  # 应用入口
├── App.tsx                   # 主布局 + 视图切换
├── store.tsx                 # 全局状态（Context + Reducer）
├── types.ts                  # 类型定义
├── theme.css                 # 样式（~1200行）
├── ipcBus.ts                 # 窗口间 IPC 广播
├── electron.d.ts             # Electron API 类型
├── data/
│   ├── hermesClient.ts       # LLM API 调用 + 持久化
│   ├── outputs.ts            # 产出物管理
│   ├── skills.ts             # 技能加载
│   └── avatarPresets.tsx     # 头像预设
├── engine/
│   ├── teamDiscussion.ts     # 团队 AI 讨论编排
│   ├── tools.ts              # AI 工具注册（文件/搜索/命令）
│   └── autopilot.ts          # 自主办公引擎
├── components/
│   ├── chat/                 # DM/团队/助手聊天组件
│   ├── office/               # 办公室工位视图
│   ├── sidebar/              # 侧栏（员工/团队列表）
│   ├── skills/               # 技能库 + @ 技能输入
│   ├── outputs/              # 产出物面板
│   ├── analytics/            # 数据分析
│   ├── autopilot/            # 自主办公面板
│   └── settings/             # 设置弹窗
└── utils/                    # 附件/剪贴板/链接工具
electron/
├── main.cjs                  # Electron 主进程
├── preload.cjs               # IPC 桥接
├── skills.cjs                # 技能扫描与安全读取
└── autoUpdate.cjs            # 自动更新
```

## 配置

- 设置 API → 添加模型（服务商 + API Host + Key + 模型名），测试通畅后高亮。
- 助理机器人可指定默认模型，员工不设模型时自动使用助理模型。
- 模型库支持添加/编辑/删除/测试。
- 用户画像和长期记忆可在设置中编辑。

## 技能库

主窗口「🧩 技能库」标签可浏览本机已安装的 WorkBuddy 技能（`~/.workbuddy/skills/`），查看完整说明。

聊天输入 `@` 可搜索并选择技能，发送时自动将技能指令注入 AI 上下文。最多同时引用 5 个技能，技能正文不写入聊天记录。

## 分发

- 给对方全新空办公室，不内置 API Key，模型配置由对方自行填写。
- 安装包未签名，Windows SmartScreen 可能拦截，需手动放行。

## 版本历史

详见 [CHANGELOG.md](./CHANGELOG.md)
