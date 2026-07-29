# 跨设备同步与交接

办公室和家里的电脑都以 GitHub `main` 和同版本 Release 为唯一共享来源。同步脚本不需要 Git Smart HTTP：它直接读取 GitHub API，把源码下载到带版本和提交号的新目录，并校验安装包的 Release 文件大小。

## 一条命令同步

在任意一份已有源码中执行：

```powershell
npm.cmd run sync:project
```

这条命令会：

1. 查询远端 `main` 的提交号和 `package.json` 版本。
2. 下载到同级目录 `sirenhuisuo-v<版本>-<提交前7位>`，不覆盖正在开发的目录。
3. 如果当前源码已有 `node_modules`，为新目录复用依赖 Junction。
4. 下载对应 GitHub Release 安装包到同级 `downloads/v<版本>`。
5. 按 GitHub Release 记录的字节数校验安装包，避免使用不完整文件。

只查看远端状态：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-project.ps1 -Mode Status
```

只同步源码或安装包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-project.ps1 -Mode Source
powershell -ExecutionPolicy Bypass -File scripts/sync-project.ps1 -Mode Installer
```

静默覆盖安装到统一目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-project.ps1 -Mode Installer -Install
```

默认安装目录为 `E:\AI办公会所\hermes-office-pro`。其他电脑可通过 `-InstallDirectory` 指定路径。

## 安全规则

- 脚本只读取系统 Git Credential Manager 中已有的 GitHub OAuth；不会在仓库保存或显示账号、密码、Token。
- 新源码始终放进新目录，已有目录不会被递归覆盖。
- API Key、聊天记录、长期记忆、真实员工配置、用户 Skill 和工作区文件不进入 GitHub。
- 更新客户端时保留 Electron 用户数据目录，因此员工、团队、模型和聊天记录不会随安装目录覆盖而删除。

## 开始开发

进入同步命令输出的新源码目录后阅读：

1. `docs/PROJECT_HANDOFF.md`
2. `CHANGELOG.md`
3. `package.json` 中的版本

运行：

```powershell
npm.cmd run lint
npm.cmd run build
```

## 完成交接

1. 更新 `docs/PROJECT_HANDOFF.md`、`CHANGELOG.md` 和版本号。
2. 补丁版本只运行 `npm.cmd run dist:win` 和 `npm.cmd run verify:package`，完成本地安装验收；功能大版本验收通过后再提交本次改动。
3. 功能大版本只运行 `npm.cmd run publish:release`。该命令自动回归、打包、推送并创建或更新同版本 Release。
4. 脚本会强制核对安装器、`.blockmap`、`latest.yml` 的远端大小和 SHA-256，任何一项缺失都不会报告成功。
5. 另一台电脑再次运行 `npm.cmd run sync:project`，即可从同一提交继续。

固定分工是：补丁版本开发电脑本地构建验收；功能大版本开发电脑用 `npm.cmd run publish:release`，接手电脑用 `npm.cmd run sync:project`。发布和同步共用 Windows Git Credential Manager 的现有 GitHub 登录，不需要手动填写 Token。
