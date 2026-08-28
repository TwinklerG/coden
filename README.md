# CodeN

<!-- markdownlint-disable MD013 -->

CodeN（Code NJU）是一个用 TypeScript 独立实现的极简编程智能体。它直接使用模型原生 Tool Calling，在本地读取、修改文件和执行命令；不依赖 Agent 框架或服务端代码执行。

## 要求与安装

- [Bun](https://bun.sh/) 1.1+
- [Just](https://github.com/casey/just)

```bash
bun install
just check
```

源码仅使用标准 Web/Node.js API；Bun 负责依赖、脚本和 TypeScript 插件运行。

## 使用

```bash
export CODEN_OPENAI_API_KEY=...
bun run src/cli/index.ts "修复当前项目的测试失败"
bun run src/cli/index.ts -p --auto "实现功能并运行测试"

export CODEN_ANTHROPIC_API_KEY=...
bun run src/cli/index.ts --provider anthropic --model claude-sonnet-4-20250514

bun run src/cli/index.ts --resume <session-id>
```

也可执行 `just run -- --help`。无 prompt 时进入 REPL，支持 `/help`、`/session`、`/compact`、`/reload`、`/new` 和 `/quit`。

核心选项：`--provider`、`--model`、`--resume`、`--auto`、`--verbose`、`--max-steps` 和可重复的 `--plugin`。

## 配置

优先级：CLI > 环境变量 > `<workspace>/.coden/config.json` > `~/.config/coden/config.json` > 默认值。

```json
{
  "provider": "openai",
  "model": "gpt-5-mini",
  "maxSteps": 20,
  "contextWindow": 128000,
  "reservedOutputTokens": 8192,
  "safetyMargin": 4096,
  "plugins": []
}
```

支持 `CODEN_PROVIDER`、`CODEN_MODEL`、`CODEN_MAX_STEPS`、`CODEN_OPENAI_API_KEY`、`CODEN_OPENAI_BASE_URL`、`CODEN_ANTHROPIC_API_KEY`、`XDG_CONFIG_HOME` 和 `XDG_DATA_HOME`。凭据只从环境读取。

会话和 trace 位于 `$XDG_DATA_HOME/coden/sessions/<workspace-hash>/`（默认 `~/.local/share/coden`）。

## 工具与权限

默认且仅默认暴露四个工具：`read`、`write`、`edit` 和 `bash`。文件工具拒绝工作区外路径及符号链接逃逸。默认模式自动执行读取，修改需确认，递归删除、`sudo`、破坏性 Git 等高风险命令每次确认。`--auto` 跳过确认，但仍进行 Schema 校验和文件工作区检查。

**这不是通用安全沙箱。** `bash` 和 TypeScript 插件拥有当前用户进程权限；风险分类是防误操作的启发式护栏。Bash 超时会终止其进程组；主进程内的插件只能通过 `AbortSignal` 协作取消，忽略信号的可信插件可能在超时结果返回后继续运行。

## 本地 TypeScript 插件

CodeN 扫描：

- `~/.config/coden/plugins/*.ts`
- `<workspace>/.coden/plugins/*.ts`
- `--plugin` 或配置中的附加目录

项目插件首次加载需信任确认（`--auto` 跳过）。插件应避免模块顶层副作用；`/reload` 基于内容哈希重建模块并原子替换 Registry（内容未变的插件复用已加载模块）。

**插件必须是自包含单文件**：Bun 的模块缓存按真实路径去重且忽略查询参数，因此 CodeN 通过 `data:text/typescript` URL 加载插件源码以保证重载生效——相对路径导入（`./helper.ts`）无法解析，npm 包导入（`import pc from "picocolors"`）正常工作。

```ts
import type { ToolDefinition } from "../../src/core/types.js";

const tool: ToolDefinition = {
  name: "line_count",
  description: "Count lines in supplied text",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async execute(input) {
    const { text } = input as { text: string };
    return { content: String(text.split("\n").length) };
  },
};

export default tool;
```

插件失败或重名不会覆盖内置工具，也不会阻止其他插件。

## npm 插件

CodeN 也支持从公开 npmjs 安装构建后的工具插件。首版只接受 `npm:<package>` 或 `npm:<package>@<version-or-tag>`，固定使用 `https://registry.npmjs.org`，不支持私有 Registry、Git、URL 或本地目录源。

常用命令：

```bash
coden plugin install npm:@scope/coden-plugin-example
coden plugin install npm:@scope/coden-plugin-example@^2 --global
coden plugin list
coden plugin sync
coden plugin remove @scope/coden-plugin-example
```

默认安装到当前项目；`--global` 安装到当前用户。项目级文件位于：

```text
<workspace>/.coden/plugins.json
<workspace>/.coden/plugin-runtime/.gitignore
<workspace>/.coden/plugin-runtime/bun.lock
```

这些文件应提交到版本控制；`plugin-runtime/package.json` 由 `plugins.json` 确定性生成，`node_modules/` 不提交。全局插件位于 `$XDG_DATA_HOME/coden/plugins/`（默认 `~/.local/share/coden/plugins/`），不属于项目仓库。

项目级 npm 插件需要信任当前工作区：`plugin install` 或 `plugin sync` 确认后会记录工作区真实路径；Agent 启动时未信任的项目 npm 插件会被跳过并提示修复。全局插件视为用户主动安装，不在每次启动时重复确认。

安装默认禁用 npm 生命周期脚本（等价于 Bun 的 `--ignore-scripts`）。只有显式传入 `--allow-scripts` 才允许当前包及传递依赖运行 `preinstall`、`install` 或 `postinstall`；`--yes` 只跳过确认，不会自动启用脚本。即使禁用生命周期脚本，CodeN 也会在安装校验时导入插件入口，因此插件顶层代码和静态依赖会以当前用户权限运行。

**npm 插件不是安全沙箱。** 它们在 CodeN 主进程中执行，拥有完整用户进程权限，可访问文件、网络、环境变量和子进程。工具 `risk` 只影响调用确认，不隔离权限。

安装、删除或升级 npm 插件后需要重启 CodeN。`/reload` 仍只保证重新读取本地 `.ts` 插件；npm 包及其依赖通过真实文件 URL 导入，会被运行时模块缓存。

### npm 插件作者协议

插件包必须发布构建后的 `.js` 或 `.mjs` 入口（例如 `dist/index.js`），不能发布仅需 CodeN 直接加载的 TypeScript 源码。`package.json` 必须包含 `type: "module"` 和 `coden` 元数据：

```json
{
  "name": "@scope/coden-plugin-example",
  "version": "1.0.0",
  "type": "module",
  "files": ["dist"],
  "coden": {
    "apiVersion": 1,
    "plugin": "./dist/index.js"
  }
}
```

单工具默认导出一个兼容 `ToolDefinition` 的对象：

```ts
import type { ToolDefinition } from "coden/plugin";

const tool: ToolDefinition = {
  name: "example_echo",
  description: "Echo supplied text",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async execute(input) {
    const { text } = input as { text: string };
    return { content: text };
  },
};

export default tool;
```

多工具默认导出 `CodeNPlugin`，其中 `name` 必须等于 npm 包名：

```ts
import type { CodeNPlugin, ToolDefinition } from "coden/plugin";

const readTool: ToolDefinition = {
  name: "example_read",
  description: "Read example data",
  risk: "read",
  inputSchema: { type: "object", additionalProperties: false },
  async execute() {
    return { content: "read" };
  },
};

const writeTool: ToolDefinition = {
  ...readTool,
  name: "example_write",
  description: "Write example data",
  risk: "modify",
  async execute() {
    return { content: "write" };
  },
};

const plugin: CodeNPlugin = {
  apiVersion: 1,
  name: "@scope/coden-plugin-example",
  tools: [readTool, writeTool],
};

export default plugin;
```

插件可以把 `coden` 放入 `devDependencies` 以获得 `coden/plugin` 类型；构建产物中的类型导入会被移除，运行时不应加载另一份 CodeN。

## 开发与测试

```bash
just fmt      # Biome format
just test     # offline Vitest
just check    # Biome lint + strict tsc + complete offline tests
```

离线集成测试用 `ScriptedProvider` 覆盖工具循环、拒绝、重试和恢复。真实 API 冒烟测试（`test/live.test.ts`）默认跳过，仅在显式设置后运行：

```bash
CODEN_LIVE_TEST=1 CODEN_OPENAI_API_KEY=... bun run test    # 可选 CODEN_LIVE_OPENAI_MODEL / CODEN_LIVE_ANTHROPIC_MODEL
```
