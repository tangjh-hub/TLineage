# Contributing

Please avoid pasting real session content, paths, usernames, email addresses, or secrets. For diagnostics, run `tlineage doctor --json` locally and share only aggregate fields such as coverage, record types, and counts. Keep paths and file identifiers from the full output on your machine.

## Adding an agent reader

Implement the `AgentReader` interface in `packages/core/src/types.ts`. Use the Codex reader as a reference for streaming, unknown records, truncated final lines, and oversized lines. When checking real formats, record only aggregate observations. Tests should use synthetic or reviewed redacted fixtures. The current release covers Codex. The Claude Code reader is pending.

```sh
node scripts/sanitize-fixture input.jsonl > sanitized.jsonl
pnpm verify
```

Review the fixture after redaction, especially for natural-language passwords and project identifiers. Submit the smallest set of records that reproduces the issue, covering known formats, missing fields, and malformed input. For format changes, include the agent version, affected record types, aggregate counts, and reproduction steps using a synthetic fixture.

Report security issues through [private vulnerability reporting](SECURITY.md).

New fixture vocabulary requires fresh owner review before it can be added to `fixtures/vocabulary.json`. Approval applies only to the recorded category and, for a value, its recorded field.

---

# 贡献指南

请勿粘贴真实会话内容、真实路径、用户名、邮箱或密钥。诊断时可本地运行 `tlineage doctor --json`，只摘录覆盖率、记录类型、数量等聚合字段。完整输出中的路径和文件标识请留在本机。

## 添加 agent 读取器

实现 `packages/core/src/types.ts` 的 `AgentReader` 接口，参照 Codex 读取器处理流式读取、未知记录、截断尾行和超长行。对照真实格式时只记录聚合观察结果，测试使用合成或审查过的脱敏样本。当前发布范围为 Codex，Claude Code 读取器尚未实现。

```sh
node scripts/sanitize-fixture input.jsonl > sanitized.jsonl
pnpm verify
```

脱敏后仍需逐项检查样本，尤其是自然语言密码和项目标识。提交能复现问题的最小记录，覆盖已知格式、缺失字段和损坏输入。格式变化类报告请附 agent 版本、受影响的记录类型、聚合计数和合成样本的复现步骤。

安全问题请走 [私密漏洞报告](SECURITY.md)。

样本引入的新词汇必须经 owner 重新审阅，才能加入 `fixtures/vocabulary.json`。审阅仅对登记的类别有效，值还须匹配登记字段。
