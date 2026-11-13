# Release checklist

## Private rehearsal

Keep `private: true` and `0.0.0-rehearsal.0` in the root manifest. Use the root `package.json` as the source for the package name, executable name, display name, and repository name. The copyright attribution is pending input from the owner. Verify installation with a frozen lockfile and run tests from a clean clone. Record the uncommitted files included in the rehearsal.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
node scripts/release-notices.mjs --check
node scripts/stage-release.mjs /tmp/tlineage-candidate
cd /tmp/tlineage-candidate
npm pack --ignore-scripts --json
npm install --global --ignore-scripts ./tlineage-local-rehearsal-0.0.0-rehearsal.0.tgz
```

Use a temporary npm installation prefix, HOME, and Codex configuration directory. Make sure the staging destination does not exist before creating it.

- [ ] Check the version and CHANGELOG. Record Node and pnpm versions, the source commit, and working-tree changes.
- [ ] Check the npm package contents, compressed and unpacked sizes, SHA-256, and the inclusion of LICENSE, THIRD-PARTY-NOTICES, and SECURITY.md.
- [ ] Rehearse map and handoff generation and Codex installation and removal with synthetic data. Verify that npm mode registers the executable on PATH and development mode warns about absolute paths.
- [ ] Scan the source, npm package, and delivery ZIP for real session data, absolute paths, usernames, email addresses, private repository names, and secrets. Use only synthetic data in demo materials.
- [ ] Record Node 20 and 22 verification and GitHub Actions results for each platform.
- [ ] Have the owner enable GitHub Private vulnerability reporting and confirm the response and disclosure periods in the security policy.

`scripts/release-notices.mjs` scans the modules that contribute bytes to either build output using their metafiles. It reads installed package metadata and files for versions, licenses, and license texts. It lists optional runtime dependencies separately. The script fails on unclassified build inputs or external modules, and package staging requires the notice to match the build. After upgrades, regenerate the notice and review the changes.

## First public release (proposal, pending owner confirmation)

After confirming the package name, product name, copyright attribution, and version, use `0.1.0-alpha.1` and the npm `alpha` tag for the first public release. The README will use `npx <package>@alpha`. Persistent MCP registration still requires a stable executable on PATH. A first public release of a scoped package requires `--access public`. The planned stable version is `0.1.0`.

Verify that the final commit, package checksum, provenance, and release version match. The owner then confirms and performs Git tagging and publishing. Before release, check the requirements for generating and verifying npm provenance in the relevant CI environment. Keep the rehearsal package private.

---

# 发布清单

## 私有演练

保留根清单的 `private: true` 和 `0.0.0-rehearsal.0`。包名、命令名、显示名和仓库名以根 `package.json` 为准。版权署名待所有者提供。用干净克隆验证冻结锁文件安装和测试，并记录本次演练纳入的未提交文件。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
node scripts/release-notices.mjs --check
node scripts/stage-release.mjs /tmp/tlineage-candidate
cd /tmp/tlineage-candidate
npm pack --ignore-scripts --json
npm install --global --ignore-scripts ./tlineage-local-rehearsal-0.0.0-rehearsal.0.tgz
```

演练使用临时 npm 安装前缀、临时 HOME 和临时 Codex 配置目录。创建候选目录前保证目标尚不存在。

- [ ] 检查版本与 CHANGELOG，记录 Node 和 pnpm 版本、源码提交及工作区差异。
- [ ] 核对 npm 包清单、压缩前后大小、SHA-256，以及 LICENSE、THIRD-PARTY-NOTICES、SECURITY.md 三项。
- [ ] 使用合成数据演练地图、接力包和 Codex 安装及卸载。验证 npm 模式注册 PATH 命令、开发模式提示绝对路径。
- [ ] 扫描源码、npm 包和交付 ZIP。排除真实会话数据、绝对路径、用户名、邮箱、私有仓库名及密钥。演示素材仅用合成数据。
- [ ] 记录 Node 20 和 22 验证，以及 GitHub Actions 各平台结果。
- [ ] 由所有者启用 GitHub Private vulnerability reporting，并确认安全政策的回复与披露时间。

`scripts/release-notices.mjs` 遍历两个构建产物清单中实际贡献字节的模块，从安装的包元数据读取版本、许可证和许可文本。它还单列按需安装的运行时依赖。构建出现无法归类的输入或外部模块时失败；暂存包要求许可清单与构建结果一致。升级后运行该脚本更新许可清单并审查差异。

## 首次公开发布（提案，待所有者确认）

待确认包名、产品名、版权署名和版本后，首发采用 `0.1.0-alpha.1` 与 npm `alpha` 标签，README 届时采用 `npx <包名>@alpha` 的用法。长期注册 MCP 仍需稳定的 PATH 命令。若采用带作用域的包，首次公开发布需要 `--access public`。稳定版计划采用 `0.1.0`。

核对最终提交、包校验值、来源证明与发布版本一致后，由所有者确认并执行 Git 标签与发布。发布前在对应的 CI 环境核对 npm provenance 的生成和验证条件。演练包保持私有。
