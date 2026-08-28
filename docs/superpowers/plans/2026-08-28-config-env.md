# CodeN 配置文件 env 字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许在 `config.json` 的 `env` 字段定义环境变量（含敏感密钥），加载配置时注入 `process.env`（不覆盖已存在键），用户无需再手动 `export`。

**Architecture:** 只改 `src/config/config.ts`：`CodeNConfig`/`ConfigOverrides` 增加 `env: Record<string,string>`，`pickOverrides` 从 JSON 提取 `env` 并校验值为 string，`loadConfig` 把两级 `env`（project 覆盖 user）显式合并后注入 `process.env`（仅在键不存在时写入）。注入后 `createProvider`、bash tool、插件、`runner` 因继承 `process.env` 自动可见。

**Tech Stack:** TypeScript + Bun（vitest）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-08-28-config-env-design.md`

## Global Constraints

- 严格 TS；`bun run lint`（biome check）必须通过：import 顺序字母序、行宽 100 列（新增 import 用 `bun x biome check --write .` 修）。
- 测试沿用现有 `vi.stubEnv` + `vi.unstubAllEnvs` + `mkdtemp` 临时目录模式（见 `test/config.test.ts`）。
- 运行测试 `bun run test`；本功能纯离线，不涉及 live 测试。
- env 值只接受 string；非 string 抛错，错误消息格式 `env "<key>" must be a string`。注意 `readJson` 会把该错误重新包装为 `Cannot read config <file>: <msg>`，测试用 substring 断言。
- 注入判定用 `process.env[k] === undefined`（键不存在时读取返回 `undefined`；shell 设为空串同样不覆盖）。
- 测试用带 `CODEN_TEST_` 前缀的唯一键，避免与真实环境及其它用例冲突；对**断言 `process.env` 值**的用例（如注入用例），断言后 `delete process.env[测试键]` 清理。纯合并断言用例的注入键为唯一前缀、进程结束即消失，可接受。

---

### Task 1: config env 提取、合并与注入

**Files:**
- Modify: `src/config/config.ts`（类型、`pickOverrides`、`loadConfig`）
- Test: `test/config.test.ts`
- Modify: `README.md`（配置小节）

**Interfaces:**
- Produces: `CodeNConfig.env: Record<string, string>`（两级 config 合并后的 env 记录）；`process.env` 已在 `loadConfig` 内被注入。
- Consumes: 无需其它任务。

- [ ] **Step 1: 加类型骨架（使 `config.env` 可编译，逻辑暂不处理）**

在 `src/config/config.ts`：

```ts
export interface CodeNConfig {
  provider: ProviderName;
  model: string;
  maxSteps: number;
  contextWindow: number;
  reservedOutputTokens: number;
  safetyMargin: number;
  plugins: string[];
  dataDir: string;
  env: Record<string, string>;
}
export type ConfigOverrides = Partial<Omit<CodeNConfig, "plugins" | "dataDir" | "env">> & {
  plugins?: string[];
  env?: Record<string, string>;
};
```

`loadConfig` 的 `defaults` 增加 `env: {}`：

```ts
const defaults: CodeNConfig = {
  provider: "openai",
  model: "gpt-5-mini",
  maxSteps: 20,
  contextWindow: 128000,
  reservedOutputTokens: 8192,
  safetyMargin: 4096,
  plugins: [],
  dataDir: userDataDir(),
  env: {},
};
```

此时尚未提取/合并 `env`，现有 2 个测试仍应通过：

```bash
bun run test
```
Expected: 全过（`config.env` 恒为 `{}`）。

- [ ] **Step 2: 写失败测试（合并、注入、不覆盖、抛错）**

在 `test/config.test.ts` 顶部（`afterEach` 之后）加一个测试辅助函数：

```ts
async function makeTmpConfigs(
  userEnv: Record<string, unknown>,
  projectEnv: Record<string, unknown>,
): Promise<{ workspace: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-config-"));
  const workspace = path.join(root, "workspace");
  const configHome = path.join(root, "config");
  await mkdir(path.join(workspace, ".coden"), { recursive: true });
  await mkdir(path.join(configHome, "coden"), { recursive: true });
  await writeFile(
    path.join(configHome, "coden", "config.json"),
    JSON.stringify({ env: userEnv }),
  );
  await writeFile(
    path.join(workspace, ".coden", "config.json"),
    JSON.stringify({ env: projectEnv }),
  );
  vi.stubEnv("XDG_CONFIG_HOME", configHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(root, "data"));
  return { workspace };
}
```

在 `describe("configuration", ...)` 内追加 4 个用例：

```ts
it("merges project env over user env", async () => {
  const { workspace } = await makeTmpConfigs(
    { CODEN_TEST_USER: "u", CODEN_TEST_PROJECT: "user-key" },
    { CODEN_TEST_PROJECT: "project-key", CODEN_TEST_NEW: "n" },
  );
  const config = await loadConfig(workspace);
  expect(config.env).toEqual({
    CODEN_TEST_USER: "u",
    CODEN_TEST_PROJECT: "project-key",
    CODEN_TEST_NEW: "n",
  });
});

it("does not override an existing process.env key", async () => {
  const key = "CODEN_TEST_EXISTING";
  vi.stubEnv(key, "shell-value");
  const { workspace } = await makeTmpConfigs({ [key]: "config-value" }, {});
  const config = await loadConfig(workspace);
  expect(process.env[key]).toBe("shell-value");
  expect(config.env[key]).toBe("config-value");
});

it("injects a config env key missing from process.env", async () => {
  const key = "CODEN_TEST_INJECT";
  delete process.env[key];
  const { workspace } = await makeTmpConfigs({ [key]: "injected" }, {});
  await loadConfig(workspace);
  expect(process.env[key]).toBe("injected");
  delete process.env[key];
});

it("rejects a non-string env value", async () => {
  const { workspace } = await makeTmpConfigs({ CODEN_TEST_BOOL: true }, {});
  await expect(loadConfig(workspace)).rejects.toThrow("must be a string");
});
```

运行首个用例确认失败（env 尚未被提取/合并，`config.env` 为 `{}`）：

```bash
bun run test
```
Expected: FAIL（`merges project env over user env` 期望非空，实为 `{}`）。

- [ ] **Step 3: 实现提取与合并注入**

在 `src/config/config.ts` 的 `pickOverrides` 内（`plugins` 块之后）追加：

```ts
if (raw.env !== undefined) {
  if (typeof raw.env !== "object" || raw.env === null || Array.isArray(raw.env))
    throw new Error("env must be an object");
  const env: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(raw.env)) {
    if (typeof entryValue !== "string")
      throw new Error(`env "${entryKey}" must be a string`);
    env[entryKey] = entryValue;
  }
  overrides.env = env;
}
```

在 `pickOverrides` 之后新增：移除 `env` 键，避免顶层 spread 浅覆盖：

```ts
function stripEnv(overrides: ConfigOverrides): ConfigOverrides {
  const { env: _env, ...rest } = overrides;
  return rest;
}
```

在 `loadConfig` 里，把 `merge` 一行替换为：先显式深合并两级 `env`、注入 `process.env`（只在缺键时），再以 `env: mergedEnv` 构建 merged：

```ts
const mergedEnv = { ...(user.env ?? {}), ...(project.env ?? {}) };
for (const [k, v] of Object.entries(mergedEnv)) {
  if (process.env[k] === undefined) process.env[k] = v;
}
const merged = { ...defaults, ...stripEnv(user), ...stripEnv(project), ...env, ...cli, env: mergedEnv };
```

注意原变量 `env`（process.env → `CODEN_PROVIDER`/`CODEN_MODEL`/`CODEN_MAX_STEPS`）保留原名，`mergedEnv` 为 config env。

- [ ] **Step 4: 运行测试确认全过**

```bash
bun run test
```
Expected: 6 个用例全过（原 2 + 新 4）。

```bash
bun run typecheck
```
Expected: 无 TS 错误。

```bash
bun run lint
```
Expected: 通过；若 import 顺序报错，执行 `bun x biome check --write .` 再跑 lint。

- [ ] **Step 5: 更新 README「配置」小节**

把 `README.md` 中这一行：

```
支持 `CODEN_PROVIDER`、`CODEN_MODEL`、`CODEN_MAX_STEPS`、`CODEN_OPENAI_API_KEY`、`CODEN_OPENAI_BASE_URL`、`CODEN_ANTHROPIC_API_KEY`、`XDG_CONFIG_HOME` 和 `XDG_DATA_HOME`。凭据只从环境读取。
```

改为：

```
支持 `CODEN_PROVIDER`、`CODEN_MODEL`、`CODEN_MAX_STEPS`、`CODEN_OPENAI_API_KEY`、`CODEN_OPENAI_BASE_URL`、`CODEN_ANTHROPIC_API_KEY`、`XDG_CONFIG_HOME` 和 `XDG_DATA_HOME`。凭据只从环境读取。

配置文件（用户级 `~/.config/coden/config.json` 或项目级 `<workspace>/.coden/config.json`）可用 `env` 字段声明环境变量（含敏感密钥），加载时注入进程环境，无需手动 `export`。注入**不会覆盖** `shell` 中已导出的同名变量（CLI > shell 环境变量 > 配置 env）。密钥请放 `~/.config/coden/` 或 `.coden/`（`gitignore` 忽略、默认不入库），不要放进会被提交或共享的目录。
```

- [ ] **Step 6: 提交**

```bash
git add src/config/config.ts test/config.test.ts README.md
git commit -m "feat(config): allow env vars in config.json env field"
```

---
