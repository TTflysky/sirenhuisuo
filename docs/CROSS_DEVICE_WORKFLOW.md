# 跨设备 Codex 协作流程

办公室和家里的 Codex 都以 GitHub `main` 分支为唯一共享事实来源。不要依赖聊天记忆、桌面文件或某一台电脑的安装目录来判断项目状态。

## 每次开始开发

```powershell
cd 'E:\私人办公会所项目'
git pull --ff-only origin main
npm.cmd run status:project -- -Fetch
```

状态命令统一显示版本、分支、最新提交、与远端的领先/落后数量、未提交改动和当前版本安装包是否已经构建。GitHub 暂时不可达时，命令会保留本地结果并明确提示刷新失败，不能把它误判为项目故障。

接着阅读：

1. `docs/PROJECT_HANDOFF.md`：产品规则、架构、隐私边界和发布要求。
2. `CHANGELOG.md`：每个版本的已完成改动。
3. `git log -5 --oneline` 和 `git status --short`：本次接力的直接上下文。

## 每次交接或发布

1. 在 `docs/PROJECT_HANDOFF.md` 更新当前版本、已验证内容和未完成风险。
2. 升级 `package.json`、`package-lock.json`、README 和 CHANGELOG 中的版本号。
3. 执行 `npm.cmd run build` 和 `npm.cmd run dist:win`；安装器文件名固定为 `hermes-office-pro-setup-<version>.exe`。
4. 提交并推送 `main`。
5. 创建同版本 GitHub Release，上传安装器、同名 `.blockmap` 与 `latest.yml`。三者缺一不可，否则客户端不能完成热更新。
6. 在另一台电脑执行本文件的“每次开始开发”命令，确认 `behind 0, ahead 0` 后再开始新的改动。

## 同步范围

提交到 GitHub：源码、文档、脱敏的 `config/local-test-profile.sanitized.json`、版本记录、构建配置。

不得提交：API Key、Token、代理密码、聊天记录、长期记忆、真实本机员工配置、用户数据目录、上传附件、工作区文件和安装包缓存。另一台电脑导入脱敏配置后，在本机重新填写 API Key。

当一台电脑正在改动时，另一台电脑不得在旧提交上继续修改同一个文件。先提交并推送，另一端拉取后再接力；若远端不可达，保留本地改动，不要猜测对方状态或强行覆盖。
