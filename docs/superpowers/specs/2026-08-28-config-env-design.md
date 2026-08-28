# CodeN 配置文件 env 字段设计

日期：2026-08-28

## 1. 背景与目标

CodeN 目前 API 凭据只从 `process.env` 读取（`src/cli/agent-command.ts` 的 `createProvider` 直接读 `CODEN_OPENAI_API_KEY` / `CODEN_ANTHROPIC_API_KEY`），用户每次运行都要先 `export`，体验抽象。

参照 Claude Code 的 "Env Var in Settings files"，本设计允许用户在**配置文件**（`config.json`）里定义环境变量（含敏感密钥），由 CodeN 在加载配置时注入进程环境，用户无需再手动 `export`。

## 2. 目标行为

- 用户级 `~/.config/coden/config.json` 与项目级 `<workspace>/.coden/config.json` 均支持 `env` 键。
- 加载配置时，把两级 `env` 合并后注入 `process.env`。
- 注入不覆盖 `process.env` 里**已存在**的键：shell 已 `export` 的变量优先，配置只兜底。
- CLI 参数（`--provider` / `--model` / `--max-steps`）优先级不变，仍高于配置。
- 注入到 `process.env` 后，`createProvider`、bash tool、插件、`runner` 均因继承 `process.env` 而自动可见。

## 3. 明确不做（YAGNI）

- 不引入独立的 `settings.json`（沿用现有单一 `config.json`）。
- 不限制 `env` 键名只能 `CODEN_*`（工具/插件可能需要任意变量）。
- 不做 env 值脱敏、不拦截打印（当前无打印 env 值的位置）。
- 不提供 CLI 的 `--env` 选项（用户仅通过配置文件设置）。
- 不做加密 / 密钥管理器，安全兜底依赖"配置不入库"。

## 4. 架构与组件

只涉及 `src/config/config.ts`。

### 4.1 类型

`CodeNConfig` 增加：

```ts
env: Record<string, string>;   // 两级 config 合并后的 env 声明记录
```

`ConfigOverrides` 增加：

```ts
env?: Record<string, string>;  // 从 config.json 提取，非 CLI 来源
```

### 4.2 `pickOverrides` 提取 env

从 `raw.env` 提取 env，仅接受**值必须是 string** 的键，`env` 本身必须是普通对象（非数组、非 null）。值非 string 时**抛错**，明确提示用户写错了：

```ts
env: "CODEN_OPENAI_API_KEY" — value must be a string
```

### 4.3 `loadConfig` 合并与注入

两级 `env` 必须**显式深合并**，不能依赖顶层 `{ ...user, ...project }` 展开（那是浅覆盖，`project.env` 会整体覆盖 `user.env`，丢失用户级独有键）。流程：

```ts
const user = await readJson(userConfigDir(), "config.json");
const project = await readJson(path.join(workspace, ".coden", "config.json"));

// 1) 显式合并两级 env：project 逐 key 覆盖 user
const mergedEnv = { ...(user.env ?? {}), ...(project.env ?? {}) };

// 2) 注入 process.env：仅在键不存在时写入（shell 已 export 的优先）
for (const [k, v] of Object.entries(mergedEnv)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

// 3) 构建 merged；从 user/project 中剔除 env，避免顶层 spread 浅覆盖 env
const merged: CodeNConfig = {
  ...defaults,
  ...stripEnv(user),
  ...stripEnv(project),
  ...env,          // process.env → CODEN_PROVIDER/CODEN_MODEL/CODEN_MAX_STEPS
  ...cli,
  env: mergedEnv,  // 已解析的 env 记录（供断言/调试）
};
```

`stripEnv` 返回去掉 `env` 键的对象，保证其余合并逻辑（provider/model 等）与现状完全一致。

注入放在 `loadConfig` 内是**刻意**的副作用：`loadConfig` 是所有 CLI 进入路径（`agent-command.ts` 的 `loadConfigOrFail`）都经过的唯一入口，在此注入能让 bash tool、插件、`runner`（它们都继承 `process.env`）自动复用。

### 4.4 注入判定

只检查 `process.env[k] === undefined`。`process.env` 中键不存在时读取返回 `undefined`；shell 设为空串（`FOO=""`）时读回空串，`=== undefined` 为假，同样**不覆盖**。任何已存在的键一律不动。

## 5. 优先级链（确认一致）

| 来源 | 层次 | 说明 |
|------|------|------|
| CLI 参数 | 最高 | 走 `...cli`，最后合并 |
| 进程环境变量（shell `export`） | 中 | 留在 `process.env`，配置 env 不覆盖 |
| 配置 env（project > user 合并） | 低（兜底） | 仅在 `process.env` 缺键时补入 |

## 6. 测试

`test/config.test.ts`（若不存在则新建）：

- user.env + project.env 合并：两键都出现。
- project.env 覆盖同键 user.env。
- `process.env` 已存在键不被覆盖（预置 `process.env[k]` 后断言其值不变）。
- `process.env` 未存在键被注入。
- 注入后 `process.env[k]` 可见（`createProvider` 等据此读到）。
- env 值非 string（如写 `true`）导致抛错。
- 补丁说明：注入 `process.env` 是副作用，每个用例用**唯一**的测试键并在 `afterEach` 里 `delete process.env[测试键]`，避免污染其它用例与真实环境。

该功能纯离线，不涉及 live 测试。现有离线测试全量与新增并行通过。

## 7. 文档与安全

- README「配置」小节：在环境变量支持列表旁补 `env` 字段示例与说明（含优先级语义）。
- **安全提醒**：密钥放 `~/.config/coden/config.json`（个人目录）或 `<workspace>/.coden/config.json`（已被 `.gitignore` 忽略，默认不入库）；**不要**放进会被提交、共享或分发的目录。选 B（允许敏感密钥进配置）的成立前提是"配置不入库"这一兜底，文档须明确。
- 说明 CLI 参数优先级仍高于配置 env，配置 env 相比 shell 环境变量始终是下风。
