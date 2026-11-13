# Security policy

## Reporting vulnerabilities

Report vulnerabilities privately through **Security → Report a vulnerability** in the GitHub repository. Please keep vulnerability details out of public issues. Provide a minimal reproduction with synthetic data and avoid including real sessions, paths, or secrets.

Only the latest prerelease is supported. Responses are on a best-effort basis, with receipt typically acknowledged within 7 days. The coordinated disclosure period is generally 90 days.

## Scope

In scope are path or command injection in the installer, unauthorized changes to user configuration, bypasses of MCP repository scoping or redaction, and accidental disclosure of session content or secrets in pages or exports.

Out of scope are the known limitations listed in the README (such as passwords expressed in natural language) and issues that require the local machine to already be compromised.

---

# 安全政策

## 报告漏洞

请在 GitHub 仓库的 **Security → Report a vulnerability** 私密报告。请勿在公开 issue 披露漏洞。使用合成数据提供最小复现，避免附上真实会话、路径和密钥。

仅支持最新的预发布版本。响应尽力而为，通常在 7 天内确认收到。协调披露期一般为 90 天。

## 范围

范围内包括安装器的路径或命令注入、对用户配置的越权修改、MCP 仓库限域绕过、脱敏绕过，以及页面或导出文件意外泄露会话内容或密钥。

范围外包括 README 已列出的限制（例如自然语言密码无法识别），以及需要本机已被攻陷才能利用的问题。
