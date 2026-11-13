# TLineage

[English](README.md)

把本地 Codex 历史生成独立的会话星图，查看相关工作，并导出 Markdown 接力包。

## 一分钟快速开始

本轮演练使用 Node.js 20 或 22。CLI 安装后需位于 PATH 中，请在有本地 Codex 历史的仓库里运行：

```sh
tlineage map --open
tlineage handoff --cwd . --to md
tlineage install codex --dry-run
tlineage install codex
```

安装器会预览 Codex MCP 和 Skill 的改动并询问确认。运行 `tlineage uninstall codex` 可移除受管理的集成。npm 包长期注册 MCP 时需要 PATH 上的全局命令。开发目录使用绝对路径，移动目录或 Node 可执行文件后可能失效。

当前为私有发布演练，参见[发布清单](docs/RELEASE.md)生成并安装本地候选包。运行 `tlineage map --demo` 可用纯合成数据查看星图。[演示录制说明](docs/DEMO.md)记录了首屏动图的素材和操作。

## 功能与隐私边界

- 会话来源仅支持 Codex。Claude Code 安装分支为 experimental，未经实测。接力包是 Markdown，可以粘贴给其他代理，接力行为已在 Codex 上验证。
- CLI 只读代理历史，所有分析在本地执行，无遥测。CLI 可写本地缓存和导出文件，安装器在确认后可修改 Codex 配置。MCP 服务只读，默认限于启动仓库。
- Codex 日志格式可能变化。首次扫描可能比后续调用慢。未验证的平台需等待 CI 结果。
- 地图可嵌入标题、摘要、相对文件路径、主线名和接力包。接力包可含历史摘录和 Git 状态。`--redact-titles` 用短 ID 替换标题和由用户消息生成的主线名，移除摘要并省略接力包。相对路径和其他主线名仍会保留。分享前请检查地图和接力包。
- 脱敏覆盖已知密钥模式，赋值匹配采用保守规则，可能误伤普通值。自然语言里的密码无法识别。

MCP 可能把脱敏后的会话内容副本保存在 `~/.tlineage/cache/mcp`，也会只读复用 CLI 已有缓存。运行 `tlineage cache status` 查看 MCP 缓存占用，运行 `tlineage cache clear` 随时清除其条目，或用 `tlineage mcp --no-cache` 跳过两层磁盘缓存。脱敏后的内容仍可能敏感。安装器的可选预热需要单独确认。 用 `tlineage doctor` 或 `tlineage cache status` 查看缓存故障原因。残留锁在下次写入或清理时自动恢复。确认没有写进程后，可用 `tlineage cache clear --force-unlock` 处理损坏的锁。

## 同领域项目

- [Cairn](https://github.com/CheswickDEV/cairn) 提供本地 MCP、接力包以及决策和证据台账。
- [Entire CLI](https://github.com/entireio/cli) 将代理会话采集接入 Git 工作流，并与提交一起索引。
- [Agent History](https://github.com/nihen/ah) 提供跨代理的命令行会话浏览和搜索。
- [Agent Sessions](https://github.com/jazzyalex/agent-sessions) 是 macOS 会话浏览器，提供会话文本和用量视图。
- [session-porter](https://github.com/liwala/session-porter) 转换 Claude Code 与 Codex 会话格式。

本项目聚焦按仓库和主线组织的 Codex 独立星图，以及 Markdown 接力包和本地 MCP。

[贡献指南](CONTRIBUTING.md) · [安全报告](SECURITY.md) · [许可证](LICENSE)
