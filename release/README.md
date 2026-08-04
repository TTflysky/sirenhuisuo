# Windows 发布资产

`release/` 是本地打包输出目录。安装器、Blockmap、`latest.yml`、解包目录和构建调试文件不进入 Git 源码历史。

正式版本的完整二进制资产统一发布到 [GitHub Releases](https://github.com/TTflysky/sirenhuisuo/releases)。当前正式版本为 [v3.13.0](https://github.com/TTflysky/sirenhuisuo/releases/tag/v3.13.0)。

发布时必须同时核对：

- `taiji-office-setup-<version>.exe`
- `taiji-office-setup-<version>.exe.blockmap`
- `latest.yml`
- 文件大小与 SHA-256

本地运行打包命令后可以继续使用此目录中的文件进行安装验收，但不得使用强制添加方式把二进制产物提交进源码仓库。
