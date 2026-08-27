# CodeN

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
