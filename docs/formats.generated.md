# 本机会话格式核验

核验日期为 2026-11-10。通过逐行读取普通 JSONL 和流式解压 Zstandard，统计文件、字段和类型，仅在本地比较 ID 与内容摘要。没有读取 SQLite 内容，也没有修改代理数据。首次扫描读取了 894 个文件，后续扫描时多出 1 个活动文件。下文注明统计所用的快照。这里的扫描验证文件格式，正式 Reader 的解析覆盖率由 M1 验收。

## Q1 · Codex 会话元数据

首轮 894 个文件均以 `session_meta` 开头。行首字段为 `timestamp`、`type`、`payload`，部分新格式还有 `ordinal`。后续扫描观察到 28 个分叉文件包含父会话的额外 `session_meta`，它出现在第 2 行的样本已纳入测试数据。使用第一条元数据识别当前文件所属会话。

跨已观察元数据结构的共同字段为 `id`、`session_id`、`timestamp`、`cwd`、`cli_version`、`originator`、`model_provider`、`source`、`thread_source`、`history_mode` 和 `base_instructions`。`git` 可缺失、为空对象，或包含 `commit_hash`、`repository_url`，以及可选的 `branch`。分叉使用 `forked_from_id`。子代理来源可通过顶层 `parent_thread_id` 或较旧记录的 `source.subagent.thread_spawn.parent_thread_id` 获得，且存在其他 `source.subagent` 结构。

| 版本组 | 文件数 | 首条元数据中观察到的其他字段 |
| --- | ---: | --- |
| 0.133 | 24 | `dynamic_tools`、`forked_from_id`、`git` |
| 0.140 | 3 | `dynamic_tools`、`git` |
| 0.142 | 53 | `dynamic_tools`、`git`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.144、0.145、0.146、0.149 | 82 | `context_window`、`dynamic_tools`、`git`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.147 | 30 | `agent_nickname`、`agent_path`、`context_window`、`dynamic_tools`、`forked_from_id`、`git`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.148 | 30 | `context_window`、`dynamic_tools`、`forked_from_id`、`git`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.150 | 26 | `context_window`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.151 | 19 | `context_window`、`git`、`history_base`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.152 | 5 | `context_window`、`git`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.153 | 105 | `agent_nickname`、`agent_path`、`context_window`、`dynamic_tools`、`forked_from_id`、`git`、`history_base`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.154 | 21 | `context_window`、`dynamic_tools`、`git`、`history_base`、`multi_agent_version`、`parent_thread_id`、`subagent_history_start_ordinal` |
| 0.155 | 95 | `agent_nickname`、`agent_path`、`context_window`、`forked_from_id`、`history_base`、`multi_agent_version`、`parent_thread_id`、`runtime_workspace_roots`、`subagent_history_start_ordinal` |
| 0.158、0.162、0.163、0.164 | 280 | `context_window`、`creator_account_id`、`creator_user_id`、`git`、`history_base`、`multi_agent_version`、`parent_thread_id`、`runtime_workspace_roots`、`subagent_history_start_ordinal` |
| 0.159、0.167 | 12 | `context_window`、`creator_account_id`、`creator_user_id`、`git`、`multi_agent_version`、`parent_thread_id`、`runtime_workspace_roots`、`subagent_history_start_ordinal` |
| 0.165、0.166 | 110 | `agent_nickname`、`agent_path`、`context_window`、`creator_account_id`、`creator_user_id`、`forked_from_id`、`git`、`history_base`、`multi_agent_version`、`parent_thread_id`、`runtime_workspace_roots`、`subagent_history_start_ordinal` |

按版本号前两段分组，合并字段集合相同的组。预发布部分可形如 `-alpha.N.N`。

脱敏参考见 [旧版记录](../fixtures/codex-0.133.jsonl)、[较新记录](../fixtures/codex-0.162.jsonl)、[分叉](../fixtures/codex-fork.jsonl) 和 [子代理](../fixtures/codex-subagent.jsonl)。

## Q2 · Codex 用量

- `event_msg.payload.type = token_count`。其 `info` 可能为 `null`。有数据时，`info` 包含 `last_token_usage`、`total_token_usage` 和 `model_context_window`，部分记录另有 `last_usage_includes_reasoning`。前者记录最近一次用量，后者是累计快照。首轮同文件相邻累计值中观察到 30,002 次不下降、75 次下降，读取器不能假设跨整个文件严格单调，也不能逐条累加快照。
- 较新格式另有顶层 `token_usage_record`。行上有 `ordinal`，载荷有 `session_id`、`thread_id`、`turn_id`、`root_turn_id`、`response_id`、`usage`、`turn_token_usage`、`thread_token_usage`。抽查两个文件共 25 对记录，`usage.total_tokens` 与旧事件的 `last_token_usage.total_tokens` 全部相等，`thread_token_usage.total_tokens` 与旧事件累计值全部相等。两种来源可能重复。见 [新旧用量共存样本](../fixtures/codex-token-record.jsonl)。
- 两种来源的用量对象都观察到 `input_tokens`、`cached_input_tokens`、`cache_write_input_tokens`、`output_tokens`、`reasoning_output_tokens`、`total_tokens`。
- 分叉的继承用量口径暂不可确认。34 个带分叉 ID 的文件中，28 个有父元数据，6 个子文件与其本地父会话某一文件的首个累计值相等。抽查的较新分叉在父元数据之后、新任务开始之前没有用量记录。这些观测无法判断第一个新用量快照是否含父历史，也无法确定安全的扣减基线。

## Q3 · Codex 文件变更与命令

- `event_msg.payload.type = item_completed` 可包含 `item.type = FileChange`。`changes` 可为路径键控对象，条目观察到 `{ type, content }` 或 `{ type, move_path, unified_diff }`。
- 同一事件还可包含 `item.type = CommandExecution`，其中有 `command`、`status`、`exit_code`，并可能含 `cwd`、`duration` 和不同形式的输出。也观察到 `response_item` 中 `name = apply_patch` 的 `custom_tool_call`，以及 `name = exec_command` 的 `function_call`。
- 部分命令结果只有工具输出字符串，退出状态出现在输出头部。已观察到非零退出样本。普通 shell 命令修改文件时是否能在各版本稳定恢复文件清单，暂不可确认。见 [补丁和文本退出码](../fixtures/codex-0.133.jsonl) 及 [结构化退出码](../fixtures/codex-token-record.jsonl)。

## Q4 · Codex 压缩上下文

301 条 `compacted` 记录都有字符串 `message` 和数组 `replacement_history`，而 `message` 全为空。还观察到窗口、前序窗口、用量和恢复相关字段，例如 `window_id`、`previous_window_id`、`latest_token_usage_record`、`resume_metadata`。没有验证 `replacement_history` 可以作为直接可复用的摘要。脱敏样本中的替换历史仅用于验证结构。

## Q5 · Codex 压缩、归档与同 ID 文件

首轮 `sessions` 下有 778 个 `.jsonl.zst` 和 67 个 `.jsonl`，`archived_sessions` 下有 49 个 `.jsonl.zst`。已确认 `session_index.jsonl` 和 `state_5.sqlite` 存在，默认目录下未见 `history.jsonl`。48 个文件存在超过 4 MiB 的单行，最大观测值为 21,860,863 字节。

第二轮扫描的 895 个文件有 862 个不同会话 ID，其中 20 个 ID 对应多个文件。按同 ID 文件配对，51 对的非空原始行序列均有差异，未观察到字节级相同副本或严格行前缀。续写与快照重写的边界暂不可确认。实现时应以首条元数据归组，再决定如何合并记录。见 [样本 A](../fixtures/codex-duplicate-a.jsonl) 和 [样本 B](../fixtures/codex-duplicate-b.jsonl)。

除初稿的五种常见类型，还重复观察到顶层 `world_state`、`token_usage_record`、`realtime_item`、`inter_agent_communication_metadata`。

## Q6 · Claude Code 行类型与用量去重

暂不可用。本机没有发现 `claude` CLI、`~/.claude/projects` 或 `~/.claude/history.jsonl`，环境未设置 `CLAUDE_CONFIG_DIR`。无法实测记录类型、版本、用量重复情况和去重键。

## Q7 · Claude Code 工具及父子关系

暂不可用。缺少本机样本，无法核验工具输入、`parentUuid`、`isSidechain` 或子代理目录结构。

## Q8 · Windows / WSL

暂不可用。本次在 macOS 上核验，未在 Windows 或 WSL 环境运行，也没有经来源确认的对应样本。

## Q9 · MCP 与技能路径

本机 Codex CLI 为 `0.133.0`。其帮助列出 `codex mcp add <NAME> (--url <URL> | -- <COMMAND>...)`，stdio 可传 `--env KEY=VALUE`，HTTP 可传 `--bearer-token-env-var`。该子命令帮助没有 `--scope`，只核验了帮助输出，未验证实际写入位置。默认 `~/.codex/skills` 存在，未设置 `CODEX_HOME`。本机 `~/.claude/skills` 是空目录，Claude CLI 的语法、范围和实际技能发现行为暂不可用。

## Q10 · Node、Zstandard 与 npm 名称

本机默认 Node 为 `v22.23.1`，`node:zlib.createZstdDecompress` 可用，已用于读取会话和验证压缩样本。官方 npm Registry 返回已有 `tlineage@0.1.0`。仓库暂用私有工作区名称 `tlineage-workspace`，最终发布名称待定。[npm Registry 元数据](https://registry.npmjs.org/tlineage/latest)

## Q11 · 现有交接工具

TStansel/handoff 的默认产物为 `.agent-handoff/latest.md`，也可在交接时启动目标代理。[`handoff` 项目说明](https://github.com/TStansel/handoff#commands)

`continues` 支持通过 `inspect ... --write-md` 导出 Markdown，批量导出支持 Markdown 和 JSON，可通过 `--debug-prompt` 检查传给目标代理的交接提示。核验来自上游说明，未运行工具或导出本机内容。[`continues` 项目说明](https://github.com/yigitkonur/cli-continues#inspect-for-debugging)

## 与初稿的差异

- Zstandard 是本机样本的主要格式，归档目录存在。超长行已有样本。重复 ID 真实存在，不能从同 ID 直接推断文件是续写。
- 只读取首条元数据作为文件身份。增加顶层 `parent_thread_id`、嵌套旧式子代理来源、可选 Git、运行时根目录、历史窗口与预发布版本变体。
- 用量兼有两条记录路径，旧事件可无数据，累计值偶尔回落，分叉用量基线暂不可确认。
- 文件变更及命令有结构化 `item_completed` 记录，退出码也可能只出现在工具输出头。
- 本机压缩上下文的 `message` 全为空，实际结构包含替换历史和窗口字段。未核实其中是否含可复用摘要或真实图片编码。
- 初稿的 Claude Code 与 Windows/WSL 格式暂未获得本机证据。`history.jsonl`、代理目录覆盖行为和实际 MCP 配置落点也未在本机验证。

## 样本边界

`fixtures/` 只保存允许公开的结构。自由文本、路径、账号标识、时间、实际 ID 和用量数值均已替换。ID 的相等关系在同一批转换内保留。超长和截断尾行是合成边界，无法用样本中的数值验证实际用量。真实会话内容和原始记录哈希均不进入仓库。

## M1 私有诊断 · 2026-11-11

诊断在临时目录运行，仅保留聚合计数。时间戳和 ID 只在进程内比较，以下结果取自一次扫描快照。诊断跳过超过 4 MiB 的记录正文。

| 检查 | 聚合结果 |
| --- | --- |
| 同 ID 文件 | 20 组、51 对，均位于 `sessions`。51 对的首时间、尾时间和行数均不同。 |
| 记录类型序列 | 使用有序三元组多重集合的交并比。41 对低于 50%，10 对在 50% 到 90% 之间，0 对达到 90%。没有足够证据判断是续写或快照重写。 |
| 无回落文件的增量校验 | 676 个文件有旧式用量。按单次用量和累计快照联合签名去重后，565 个的总 Token 增量之和等于最后快照，111 个不等。41 个文件首个累计值与首个增量不同。 |
| 回落上下文 | 75 次回落。前后各 10 条已解析记录内，1 次附近有 `compacted`，42 次有 `turn_context`，0 次有已识别子代理事件，0 次有额外元数据。相邻关系不足以确认原因。 |
| fork 继承假设 | 34 个带 fork ID 的文件都能找到本地父会话和不晚于分叉时间的父快照。0 个子文件的首个累计值与该快照相等，0 个扣除首个增量后相等。分叉继承语义仍未证实。 |
| 压缩上下文文本 | 164 条未超长的 `compacted` 记录可检查，全部含非空消息文本，134 条命中摘要相关词。关键词不足以确定文本来源、完整性或是否适合接力包，M1 不提取该文本。 |

双来源补查中，3,762 个轮次同时出现新旧用量记录。按单次和累计向量配对，2,219 个轮次的两侧全部可配对。未精确配对的旧式增量中，5,396 条与新式用量区间不重叠，4,634 条有重叠。按轮次保留新式响应 ID 去重后的增量，合并可比较且不重叠的旧式增量。完全配对的记录计一次，重叠或不可比较时保留新来源并标为近似。区间只用于判定重叠，最终快照只用于校验结果。

## M1 真实文件和内存验收

- Node 22.23.1 原生 zstd 与 Node 20.17.0 纯 JS 回退分别读完 895/895 个文件，解析覆盖率均为 100%。两次均选出 862 个 canonical 和 33 个 alternates，发现 138 条超长行。活动文件在两次扫描间新增少量记录。
- 本机最大的会话文件约 151.3 MB，两个解码路径均能读完。下表取 M1 初次实现复跑时独立进程的峰值 RSS，单位为 MiB。
- 合成压缩文件解压后约 2,112 MiB，含 96 条约 22 MiB 的单行。运行时只保留超长行的前 64 KiB，随后继续读取。性能文件和脚本均保存在临时目录。

| 输入 | Node 22 原生 zstd | Node 20 JS 回退 |
| --- | ---: | ---: |
| 最大真实文件 | 136.9 MiB | 169.3 MiB |
| 合成超长行文件 | 119.2 MiB | 216.1 MiB |

M1 初次实现复核了 862 个唯一会话，其中 360 个用量标为近似。收尾后的统计见下文。已在隔离的 Node 20 运行环境验证缺少回退库时会列出失败文件、显示数量并返回部分解析退出码 2。

## M1 三条真实会话用量对照

所有者提供了三个会话并授权查询。桌面历史接口可读取三个会话，但响应中无累计用量字段。对照值直接读取 Codex 在 canonical 文件中写下的两类末次累计快照，界面显示值未单独核实。OpenAI Docs 将 App Server 的用量更新列为活动会话事件。[Codex App Server](https://learn.chatgpt.com/docs/app-server#turn-events)

| 匿名样本 | Codex 旧式快照 | Codex 新式快照 | 文件内用量 | 文件前基线 | 质量 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 11,977,721 | 11,977,721 | 3,454,426 | 8,523,295 | exact |
| 2 | 63,753,976 | 64,206,181 | 64,206,181 | — | approx |
| 3 | 35,537 | 35,537 | 35,537 | — | exact |

- 样本 1 首个旧式快照为 8,748,351，首个增量为 225,056。两者差值为 8,523,295，基线加文件内用量可以逐计数项对齐末次快照，文件内质量为 `exact`。该会话另有一个 alternate，合计使用 canonical 可见增量。
- 样本 2 的 275 条新式增量按响应 ID 去重后正好等于新式末次快照。旧来源额外有 690,028 Token 的表面不重叠区间，混合求和会超出新式快照。由于该会话没有仅含旧式增量的轮次，最终使用已和新式快照对齐的增量，同时保留两类快照不一致的近似标记。
- 样本 3 的两类来源记录同一笔用量，去重后与两类快照一致。

## M1 收尾复验

`ls --json` 的 `schemaVersion` 为 2。`inFile` 是去重后的文件内增量。`baseline` 是首笔增量之前的正基线，需要同一条记录的累计值和增量，且能与末次校验快照逐计数项对齐。`threadCumulative` 展示按文件顺序最后读到的有效累计快照。基线和累计快照各标注来源，可用于解释差额和校验，合计使用文件内用量。没有证据时对应字段为 `null`。样本 2 的 `threadCumulative` 是文件最后一条旧式快照，而文件内用量采用和新式快照对齐的增量。

- fork 私有诊断比较正增量和累计快照的完整签名。34 对父子文件中，28 对无匹配，6 对的匹配均在子文件开头，且在父文件中按同一顺序连续出现。子文件共 2,611 个不同签名，1,567 个匹配。实际合计纳入 28 个无重叠的 fork、5 个扣除连续前缀后的 fork，1 个因证据不足暂缓。扣除只影响合计，节点继续展示完整文件内用量。
- 33 个 alternates 与 canonical 未发现签名重叠，其中 2 个缺少可比签名。canonical 选择规则仍按末次有效时间戳、行数和路径排序。
- 以原诊断的口径复现了 676 个旧式快照无回落的文件，其中 111 个增量合计与末次快照不同。24 个差额恰好等于文件前基线，0 个能通过按轮区分重复签名来解释。回落在该队列的筛选条件中已排除，归因数为 0。其余 87 个的旧式差额仍未解释，其中 22 个的新式增量能和各自的新式快照对齐。
- 同一批文件上，原生 zstd 和纯 JS 解码得到相同的质量标记。近似会话从 360/862（41.8%）降至 333/862（38.6%），减少 27 个和约 3.1 个百分点。表格回归覆盖三种样本形状、双来源去重、回落、fork、同 ID 备选文件及快照或增量缺失。脱敏测试覆盖五类凭证、幂等性和 1 MiB 病态输入。

## M1 脱敏边界

- 新增 Stripe 的 secret 和 restricted key、Google API key、npm 令牌、GitLab 默认前缀的访问令牌和 SendGrid API key 的格式匹配。相关测试使用合成值。 [Stripe 密钥文档](https://docs.stripe.com/keys) · [GitLab 默认令牌前缀](https://docs.gitlab.com/administration/settings/account_and_limit_settings/#personal-access-token-prefix)
- 通用赋值规则保留对子串的保守匹配。收窄到下划线分隔或驼峰形式会失去对 `deploymentkey = short-demo-value` 这类自定义密钥变量的覆盖，因此 `primaryKey: id`、`sortKey = name` 和 `monkey: banana` 仍会被遮盖。
- 脱敏依赖可识别的格式或结构化赋值。自然语言中的「密码是 xxx」无法仅凭此规则识别。
