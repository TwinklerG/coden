# CodeN GitHub Actions CI & 自动发布实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为仓库引入 GitHub Actions CI 与通过 Git tag 触发的 npm 自动发布，两种路径都执行 `just check` 并校验构建产物。

**Architecture:** 两个独立 workflow：`ci.yml`（push main / PR 时 check+build）、`release.yml`（push `v*` tag 时校验 tag 与版本号一致 → check → build → 以 Trusted Publishing/OIDC 发布 npm）。版本门禁抽成一个可测试的纯函数模块。

**Tech Stack:** GitHub Actions、Bun（`oven-sh/setup-bun`）、Just（`extractions/setup-just`）、npm Trusted Publishing / OIDC（`actions/setup-node` + `npm/action-setup` + `npm publish --provenance`）。

**Spec:** `docs/superpowers/specs/2026-08-30-coden-github-actions-ci-release-design.md`

## Global Constraints

- Dev/CI 构建运行时仅用 **Bun 最新稳定版**，无 Node 运行时矩阵测试。
- **不在 `package.json` 声明 `engines.node` 禁止 Node**（发布产物是 Node 单文件 CLI，见 spec）。
- 使用 Just 作为 Command Runner（AGENTS.md 约定）。
- 发布：仅接受 `vX.Y.Z` 格式 tag，且 tag 必须与 `package.json.version` 完全一致，否则失败。
- npm 发布走 **Trusted Publishing / OIDC** + `--provenance`，不使用 `NPM_TOKEN`。
- 改动范围仅限：`.github/workflows/*.yml`、`src/release/*.ts`、`test/release/*.test.ts`、`justfile`。
- 不要改动或提交无关的未跟踪文件 `docs/superpowers/plans/2026-08-30-agent-lifecycle-hooks.md`。

---

### Task 1: 版本门禁模块（可测试的纯函数 + CLI 入口）

**Files:**
- Create: `src/release/check-tag-version.ts`
- Create: `src/release/check-tag-version-cli.ts`
- Test: `test/release/check-tag-version.test.ts`
- Modify: `justfile`（新增 `check-tag-version` 配方）

**Interfaces:**
- Produces: `versionMismatch(tag: string, version: string): string | null` —— tag 合法且与 version 一致返回 `null`，否则返回错误信息字符串。
- Consumes: `src/release/check-tag-version.ts` 为纯函数，无依赖。

- [ ] **Step 1: Write the failing test**

```ts
// test/release/check-tag-version.test.ts
import { describe, it, expect } from "vitest";
import { versionMismatch } from "../../src/release/check-tag-version.js";

describe("versionMismatch", () => {
  it("returns null when tag matches version", () => {
    expect(versionMismatch("v0.1.8", "0.1.8")).toBeNull();
  });
  it("rejects non-semver tag", () => {
    expect(versionMismatch("v0.1", "0.1.8")).not.toBeNull();
  });
  it("rejects a tag that does not match the version", () => {
    expect(versionMismatch("v0.1.7", "0.1.8")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/release/check-tag-version.test.ts`
Expected: 报错，`versionMismatch` 未定义。

- [ ] **Step 3: Write minimal implementation**

```ts
// src/release/check-tag-version.ts
export function versionMismatch(tag: string, version: string): string | null {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    return `tag "${tag}" is not a valid semver tag (expected vX.Y.Z)`;
  }
  if (tag !== `v${version}`) {
    return `tag "${tag}" does not match package.json version "${version}"`;
  }
  return null;
}
```

```ts
// src/release/check-tag-version-cli.ts
import { readFileSync } from "node:fs";
import { versionMismatch } from "./check-tag-version.js";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: check-tag-version <vX.Y.Z>");
  process.exit(2);
}
const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };
const error = versionMismatch(tag, pkg.version);
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(`tag ${tag} matches package.json version ${pkg.version}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/release/check-tag-version.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Add justfile recipe**

```just
# Verify a git tag vX.Y.Z matches package.json version
check-tag-version tag:
  bun run src/release/check-tag-version-cli.ts {{tag}}
```

- [ ] **Step 6: Verify CLI locally**

Run:
`just check-tag-version v0.1.8` → 成功（与 package.json `0.1.8` 匹配）
`just check-tag-version v0.1.7` → 以非零退出（不匹配）

- [ ] **Step 7: Commit**

```bash
git add src/release/check-tag-version.ts src/release/check-tag-version-cli.ts test/release/check-tag-version.test.ts justfile
git commit -m "feat: add release tag version gate"
```

---

### Task 2: CI 工作流

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `just check`、`just build`（已存在），无需版本门禁。

- [ ] **Step 1: Create workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - uses: extractions/setup-just@v4
      - run: bun install --frozen-lockfile
      - name: Lint, typecheck, and test
        run: just check
      - name: Build artifact
        run: just build
```

- [ ] **Step 2: Validate YAML**

Run:
`bun -e "const { parse } = await import('yaml'); const fs = await import('node:fs'); for (const f of ['.github/workflows/ci.yml']) { parse(fs.readFileSync(f, 'utf8')); console.log('ok', f); }"`
Expected: `ok .github/workflows/ci.yml`，无报错。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add github actions ci workflow"
```

---

### Task 3: 发布工作流

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `just check-tag-version <tag>`（Task 1）、`just check`、`just build`。

- [ ] **Step 1: Create workflow**

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - uses: extractions/setup-just@v4
      - run: bun install --frozen-lockfile
      - name: Verify tag matches package version
        run: just check-tag-version ${{ github.ref_name }}
      - name: Run checks
        run: just check
      - name: Build artifact
        run: just build
      - name: Set up Node for npm publish
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - uses: npm/action-setup@v4
      - name: Publish to npm (trusted publishing)
        run: npm publish --provenance --access public
```

- [ ] **Step 2: Validate YAML**

Run:
`bun -e "const { parse } = await import('yaml'); const fs = await import('node:fs'); for (const f of ['.github/workflows/release.yml']) { parse(fs.readFileSync(f, 'utf8')); console.log('ok', f); }"`
Expected: `ok .github/workflows/release.yml`，无报错。

- [ ] **Step 3: Run full check locally**

Run: `just check`
Expected: lint + typecheck + test 全部通过。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish npm package via tag release workflow"
```

---

## Self-Review

**1. Spec coverage:**
- CI 触发（push main + PR）→ Task 2。
- CI 执行 check + build 验证产物 → Task 2。
- tag 触发发布、校验 tag 且同样执行 check → Task 3 + Task 1。
- Trusted Publishing / OIDC + `--provenance`、无 NPM_TOKEN → Task 3。
- 不声明 `engines.node` → 未触碰 package.json，符合 Global Constraints。

**2. Placeholder scan:** 所有代码块为完整实义内容，无 TBD/TODO。

**3. Type consistency:** `versionMismatch(tag: string, version: string): string | null` 在 Task 1 定义、CLI 与测试中一致；import 使用 `.js` 后缀与项目 NodeNext 约定一致。
