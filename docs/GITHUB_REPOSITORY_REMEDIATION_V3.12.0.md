# 太极 GitHub 仓库整改报告 v3.12.0

日期：2026-08-04

整改依据：`太极项目_GitHub整改清单_for_Codex.md`

## 结论

本轮完成不改写历史即可落地的仓库治理：许可证、忽略规则、项目入口、发布门禁、版本资料和图文证据。历史安装包造成的仓库体积问题已经定位，但本轮不执行历史重写和强制推送，避免正在开发和多台电脑同步期间破坏提交引用；该项保留到项目收尾时统一处理。

## 已完成

- 新增根目录 `LICENSE`，采用 MIT License，版权人 `TTflysky`。
- 完善 `.gitignore`，忽略依赖、构建目录、安装包、压缩包、本地备份、环境变量文件和证书；保留正式客户端图标 `build/icon.ico`。
- `package.json` 补齐 `license`、`homepage`、`repository` 和 `bugs` 元数据。
- README 增加版本、平台、许可证和发布门禁徽章，提供 30 秒介绍、最新 Release、交接和阶段报告入口。
- README 和本报告使用真实界面/项目快照，不以模型描述代替运行证据。
- Windows Release Actions 改为运行完整核心门禁、人格门禁和发布治理门禁，不再只运行基础单元测试。
- 版本号、README、CHANGELOG、交接、SBOM、来源证明、安装包、Blockmap、`latest.yml` 和 SHA-256 继续作为同一发布门禁核对。
- GitHub Description、Homepage 和 Topics 已同步；`v3.12.0` Release 已发布并完成远端提交、标签和资产哈希核验。

## 快照

### 太极办公室 v3.12.0

![太极办公室 v3.12.0](./screenshots/office-overview.png)

### 安装版真实项目产出

| 桌面验收 | 375px 窄屏验收 |
| --- | --- |
| ![风险看板桌面验收](./evidence/v3.11.0/risk-board-desktop-1440x900.png) | ![风险看板窄屏验收](./evidence/v3.11.0/risk-board-narrow-375x844.png) |

## 仓库体积诊断

- 当前 Git pack 总大小约 `319.36 MiB`。
- 当前工作树只跟踪 `release/README.md`，不再跟踪新的安装器、Blockmap 或 `latest.yml`。
- 历史最大对象是早期提交到 `release/` 的 Windows 安装器，单个约 `94 MB`；多个 `0.1.x`、`0.2.x` 安装器仍保留在 Git 历史中。
- `.gitignore` 只能阻止后续安装包再次进入历史，不能缩小已经存在的对象。

## 延期项：历史重写

暂不执行 `git filter-repo`、BFG 或 `git push --force`。原因：

1. 本地仍有 v3.7-v3.12 连续开发成果等待一次正式发布，多台电脑还需要保持正常拉取和交接。
2. 历史重写会改变所有相关提交 ID，并要求所有开发副本重新克隆或严格重置。
3. GitHub Release 已经能够独立承载安装包，没有必要在本轮冒险修改历史。

项目收尾时应单独建立维护窗口：备份远端、冻结提交、重写 `release/*.exe` 等历史对象、重新推送、重新克隆验证，并记录旧标签和新标签映射。

## 后续建议

- GitHub 仓库 Description 使用“Windows 多模型 AI 虚拟办公室，支持专业员工、团队编排、可恢复长任务、Coding Runtime、Skill 与真实证据交付”。
- Topics 建议：`ai-agents`、`multi-agent`、`electron`、`react`、`windows`、`agent-orchestration`、`coding-agent`、`workflow`。
- 正式版本只通过 GitHub Release 分发安装器，不把二进制重新提交到 Git 历史。
- 历史重写前继续监控 `.git` 体积，但不把体积问题误判为当前源码或安装包构建失败。
