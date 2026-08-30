# CodeN GitHub Actions CI & 自动发布设计

## 背景与目标

项目当前没有任何 `.github/workflows`。仓库使用 Bun（`package.json` 要求 Bun 1.1+）作为 JS/TS 工具链，用 Just 作为 Command Runner，发布产物是构建后的单文件 CLI（`dist/index.js`，已 minify）。

本设计为仓库引入 GitHub Actions：CI 流水线 + 通过 Git tag 触发的 npm 自动发布，并在两种触发路径上都校验构建产物。

## 范围决策

### 开发构建运行时：仅 Bun（不测试 Node）

本项目在 CI / 开发构建阶段只使用 Bun 最新稳定版执行检查与构建，**不加入 Node 运行时矩阵测试**。原因：源码与构建工具链完全由 Bun 承担。

> **重要说明**：发布产物 `dist/index.js` 的 shebang 为 `#!/usr/bin/env node`，并且该产物本身是 Node 可运行的 CLI（README 约定“运行时只需 Node，不需要 Bun”）。因此这里的“不支持 Node”**仅指 CI / 开发构建不测 Node**，并非发布产物不能在 Node 上运行。
>
> 结论：**不在 `package.json` 声明 `engines.node` 来禁止 Node**——那会与「发布产物是 Node CLI」这一事实冲突。`package.json` 保持现状（仅声明 `engines.bun`）。

### 发布认证：npm Trusted Publishing / OIDC

发布不使用长期 `NPM_TOKEN`，改用 npm Trusted Publishing / OIDC。需要在 npm 包设置中为 `@twinklerg/coden` 绑定 `TwinklerG/CodeN` 仓库与发布 workflow（账户侧一次性配置，不在仓库内完成）。

### 版本校验

仅接受符合 `vX.Y.Z` 格式的 Git tag。发布前必须校验 tag 与 `package.json` 中的 `version` 完全一致，不一致则失败。

## 文件设计

### 1. `.github/workflows/ci.yml`（CI）

- **触发**：`push` 到 `main`，以及所有 `pull_request`。
- **steps**：
  1. `actions/checkout`
  2. `oven-sh/setup-bun`（最新稳定版）
  3. `bun install --frozen-lockfile`
  4. `just check`（lint + typecheck + test）
  5. `just build`（生成 `dist/index.js`，验证发布产物可构建）
- **矩阵**：无 Node 步骤。

### 2. `.github/workflows/release.yml`（自动发布）

- **触发**：仅 `push` `v*` tag（如 `v0.1.8`）。
- **permissions**：`contents: read`，`id-token: write`（供 OIDC 使用）。
- **steps**：
  1. `actions/checkout`，`fetch-depth: 0`（确保 tag 与历史可用）
  2. `oven-sh/setup-bun`（最新稳定版）
  3. `bun install --frozen-lockfile`
  4. **门槛校验脚本**：比较 tag `vX.Y.Z` 与 `package.json.version`，不一致立即失败
  5. `just check`
  6. `just build`
  7. npm 发布（`npm/action-setup` + `npm publish --provenance`，走 Trusted Publishing / OIDC）

> tag 触发同样执行 `just check`（步骤 5），与 CI 保持一致的代码质量门槛。

## 版本号「跳过 Node」说明

`engines.node` 在 npm 中只能表达版本范围，无法表达“不使用 node”，且仅是警告而不会强制阻止他人用 Node 安装运行。鉴于发布产物是 Node 单文件 CLI，本项目既不声明 `engines.node`，也不尝试“禁止 Node”。

## 后续一次性配置（非仓库内）

- 在 npm 包设置中为 `@twinklerg/coden` 配置 Trusted Publishing，绑定 `TwinklerG/CodeN` 仓库。

## 验证清单

- `just check` 在本地通过（基线）。
- `just build` 产出 `dist/index.js`。
- 本地能解析 tag 与 `package.json` 版本校验逻辑。
- `.github/workflows/*.yml` 语法与权限设置正确。
