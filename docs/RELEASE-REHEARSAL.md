# 私有发布演练核对记录

## README 命令

| 命令或说明 | 依据 |
| --- | --- |
| `tlineage map --open` | 已安装的 npm CLI 从临时仓库读取合成历史并生成 HTML。隔离的系统打开命令收到该文件。 |
| `tlineage handoff --cwd . --to md` | 同一临时仓库生成 Markdown，包含预置的合成目标。 |
| `tlineage install codex --dry-run` | 运行后未创建临时 Codex 配置。 |
| `tlineage install codex` | 在临时 HOME 运行，自动化通过 `--yes` 确认。真实 Codex CLI 查询到注册命令 `tlineage mcp`，Skill 标记存在。 |
| `tlineage uninstall codex` | 在临时 HOME 通过提示确认。Codex 注册和受管理 Skill 均已移除。 |
| `tlineage map --demo` | 用安装后的 CLI 生成合成星图。首屏动图操作见 [DEMO.md](DEMO.md)。 |
| `--redact-titles` | CLI 帮助、地图页脚与 viewer 测试。 |

## 数字、范围与对比

| README 内容 | 依据 |
| --- | --- |
| Node 20 与 22 | macOS 上从本地基线克隆，叠加本轮未提交变更后冻结锁文件安装。Node 20 为 137 通过、1 跳过，Node 22 为 138 通过。跳过项是依赖 Node 内置 zstd 的脚本测试。 |
| 一分钟快速开始 | 中文 README 的操作指引标题。完整流程耗时受首次扫描和手动确认影响。 |
| 本地运行、Codex 来源、MCP 默认仓库限域 | 核心读取器、MCP 范围测试、安装器和 [06-surfaces.md](06-surfaces.md)。 |
| 首次扫描可能更慢 | [DECISIONS.md](DECISIONS.md) 的 M6 冷启动记录。 |
| 脱敏边界 | 核心脱敏测试和 [07-security.md](07-security.md)。 |
| Cairn 的接力和台账 | [Cairn](https://github.com/CheswickDEV/cairn) |
| Entire CLI 的 Git 工作流和索引 | [Entire CLI](https://github.com/entireio/cli) |
| Agent History 的跨代理 CLI 搜索与浏览 | [Agent History](https://github.com/nihen/ah) |
| Agent Sessions 的 macOS 会话浏览与用量视图 | [Agent Sessions](https://github.com/jazzyalex/agent-sessions) |
| session-porter 的会话格式转换 | [session-porter](https://github.com/liwala/session-porter) |

CI 包含 Linux、macOS、Windows 的 Node 20/22 矩阵，工作流尚未实际运行。演练未实测 Claude Code。
