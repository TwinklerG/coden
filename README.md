# CodeN

[中文](README.md) | [English](README.en.md)

<!-- markdownlint-disable MD013 -->

CodeN（Code NJU）是一个用 TypeScript 独立实现的极简编程智能体。它直接使用模型原生 Tool Calling，在本地读取、修改文件和执行命令；不依赖 Agent 框架或服务端代码执行。

## 安装与使用

### 从 npm 安装（发布后的 CLI）

```bash
bun add -g @twinklerg/coden     # 或 npm install -g @twinklerg/coden
coden --version                 # 0.1.9
coden --help
```

发布产物是构建后的单文件 Node CLI（`dist/index.js`，已 minify），运行时需要 **Node.js 22+**，不需要 Bun。

### 从源码运行（开发）

- [Bun](https://bun.sh/) 1.1+
- [Just](https://github.com/casey/just)

```bash
bun install
just check
```

源码仅使用标准 Web/Node.js API；Bun 负责依赖、脚本和 TypeScript 插件运行。

### 使用示例

```bash
export CODEN_OPENAI_API_KEY=...
coden                             # 默认进入 CLI/REPL
coden "修复当前项目的测试失败"   # 在 CLI 中自动提交并继续交互
coden --tui                       # 显式启动 TUI
coden --cli                       # 显式使用 CLI/REPL
coden -p --auto "实现功能并运行测试" # 纯文本输出后退出
coden --smart-approve "实现功能并运行测试"
coden --lang en --help            # 仅为当前进程切换为英文
coden --thinking high "分析并修复这个并发问题"

export CODEN_THINKING_LEVEL=medium
coden --resume <session-id>

export CODEN_ANTHROPIC_API_KEY=...
coden --provider anthropic --model claude-sonnet-4-20250514

coden --resume <session-id>      # 恢复指定会话
coden --resume                   # 列出当前工作区的会话
```

`coden` 默认进入连续输出 CLI；`--tui` 可在支持的 TTY 中显式启动 Ink 全屏 TUI，`--cli` 可显式指定 CLI。非 TTY、`TERM=dumb` 或无法进入 raw mode 时，显式 `--tui` 会降级为 CLI 并显示警告。`-p/--print` 始终保持纯文本、可管道化并在单轮后退出。`NO_COLOR` 只关闭颜色，不影响界面模式。

TUI 内容区保持 CLI 风格，瞬时思考/工具活动跟随当前对话位置进入 transcript 流，不再固定在底部；输入区由上下两条贯穿全宽的水平线包围，下方依次是 provider/model、workspace、授权模式、阶段、上下文占用状态。Enter 提交；Shift+Enter 或行尾单个 `\` 插入换行；方向键在显式换行或自动折行的草稿行间移动，不会切换历史，仅 `Ctrl+P`/`Ctrl+N` 浏览输入历史；`PageUp`/`PageDown` 和鼠标滚轮浏览 transcript，`End` 回到最新内容；运行中 `Ctrl+C` 取消当前任务；空输入 `Ctrl+D` 或空闲时 `Ctrl+C` 退出。TUI 保持单任务串行，不在运行中排队输入。

工具授权、工作区信任和插件确认都以内联请求显示在 transcript 中，不再弹出 dialog。等待选择时任务输入区保持可见但禁用；普通授权使用 `y` 允许一次、`s` 本会话、`n`/`Esc` 拒绝，危险操作不提供会话授权。请求、可用选项和最终选择会永久保留在当前 TUI transcript 中。

TUI 与传统 CLI 均支持 `/help`、`/skills`、`/session`、`/sessions`、`/compact`、`/reload`、`/new`、`/lang`、`/thinking` 和 `/quit`。`/lang` 列出 `zh`、`en` 及当前语言；`/lang en` 或 `/lang zh` 会原子写入用户配置并立即切换界面、系统提示词和内建工具描述。`/thinking` 列出六种思考等级、当前值与有效映射；`/thinking <level>` 在空闲时切换并持久化到当前会话。传统 CLI 继续提供完整多行编辑与启动横幅。

CodeN 固定默认中文，不读取系统区域设置。`--lang zh|en` 仅覆盖当前进程且不写配置。系统提示词、内建工具和界面共享同一语言；用户在单次任务中明确要求其他回复语言时，Agent 可以遵从，但不会更改界面或持久化偏好。第三方插件的名称、描述、输出和错误始终保留插件作者原文。

核心选项：`--tui`、`--cli`、`--lang`、`--provider`、`--model`、`-p/--print`、`--resume [session-id]`、`--smart-approve`、`--auto`、`--allow-outside-workspace`、`--verbose`、`--max-steps`、`--thinking <level>`、可重复的 `--plugin` 和 `--version`。`--tui` 不能与 `--cli` 或 `--print` 同时使用。

## 配置

配置字段来自五层（从高到低）：CLI 参数 > `CODEN_*` 环境变量 > `<workspace>/.coden/config.json`（项目级）> `~/.config/coden/config.json`（用户级）> 默认值。

```json
{
  "language": "zh",
  "provider": "openai",
  "model": "gpt-5-mini",
  "approvalModel": "gpt-5-mini",
  "approvalStrictness": "medium",
  "maxSteps": 20,
  "contextWindow": 128000,
  "reservedOutputTokens": 8192,
  "safetyMargin": 4096,
  "thinkingLevel": "default",
  "plugins": [],
  "env": {
    "CODEN_OPENAI_API_KEY": "sk-..."
  }
}
```

`language` 是用户专属偏好，只从 `~/.config/coden/config.json` 读取；项目 `.coden/config.json` 中的同名字段会被忽略，不能覆盖个人界面或 Agent 语言。只接受规范值 `zh`、`en`。启动参数 `--lang` 的优先级最高，但仅影响本次进程；REPL `/lang <zh|en>` 会保留配置中的其他字段，以 `0600` 权限原子更新用户文件。

支持 `CODEN_PROVIDER`、`CODEN_MODEL`、`CODEN_MAX_STEPS`、`CODEN_THINKING_LEVEL`、`CODEN_OPENAI_API_KEY`、`CODEN_OPENAI_BASE_URL`、`CODEN_ANTHROPIC_API_KEY`、`XDG_CONFIG_HOME` 和 `XDG_DATA_HOME`。

`env` 字段（用户级与项目级均可）声明环境变量（含敏感密钥），加载配置时注入进程环境，无需手动 `export`。两级 `env` 合并时**项目级逐键覆盖用户级**；注入**不覆盖** `shell` 中已导出的同名变量（CLI > 环境变量 > 配置 env）。密钥请放 `~/.config/coden/` 或 `.coden/`（已被 `gitignore` 忽略、默认不入库），不要放进会被提交、共享或分发的目录。

`approvalModel` 使用与任务相同的 provider 和凭据，未设置时回退到 `model`。`approvalStrictness` 只能是 `soft`、`medium` 或 `hard`，默认 `medium`。

### 思考等级

CodeN 通过统一的 `default | off | minimal | low | medium | high` 六种等级控制模型的推理强度，可经 CLI `--thinking <level>`、环境变量 `CODEN_THINKING_LEVEL`、配置 `thinkingLevel` 或会话内 `/thinking [level]` 设置。默认 `default` 不发送任何 thinking 参数，保持升级 CodeN 前的既有行为。

- OpenAI 映射到 `reasoning_effort`：`off` 映射 `minimal` 并在界面显示 `off→minimal`（OpenAI 推理模型没有统一的真正关闭值）；`minimal`/`low`/`medium`/`high` 分别映射同名值。
- Anthropic 映射到 `thinking`：`off` 发送 `{ type: "disabled" }`；`minimal` 使用 1024 tokens；`low`/`medium`/`high` 分别使用 `reservedOutputTokens` 的 25%/50%/75%，并按 `[1024, reservedOutputTokens - 1]` 截断。thinking 预算包含在 `reservedOutputTokens` 内，提高等级会减少同一次输出中用于最终文本和工具调用的 tokens。启用 thinking 要求 `reservedOutputTokens > 1024`。
- CodeN 不维护模型能力白名单，也不因参数被拒绝而静默降级；显式设置会原样发送，不支持的服务会返回清晰的 Provider 错误。
- thinking level 只作用于主 Agent 请求，上下文压缩和 Smart Approval 审查请求保持 Provider 默认行为。同一 turn 内的工具循环与 Provider 重试使用该 turn 开始时的快照。
- 恢复会话时，`--resume` 使用会话最后保存的等级；显式 `--thinking` 优先于保存值、环境变量、项目配置和用户配置，并在启动时覆盖写入会话。`/new` 只重置当前对话，不改变等级；`/thinking` 只影响当前进程与会话，不修改用户或项目配置文件。

Anthropic extended thinking 依赖将 `thinking`、`redacted_thinking` 和签名块原样回传给后续请求。CodeN 会把这些块作为 `providerState` 随 assistant 消息保存到会话，并在工具调用与 resume 后自动回传；切换 provider 时会忽略不匹配的 provider 状态。

会话和 trace 位于 `$XDG_DATA_HOME/coden/sessions/<workspace-hash>/`（默认 `~/.local/share/coden`）。目录和文件继续使用 `0700`、`0600` 权限。**注意**：会话 JSONL 和 trace 可能包含模型推理内容、`redacted-thinking`、签名、用户输入和代码片段，属于敏感数据；请勿未经审查地分享或分发，并保留本地私有权限。

## Agent Skills

CodeN 兼容 [Agent Skills](https://agentskills.io/specification) 的渐进式披露格式。启动时扫描以下目录的直接子目录；每个候选项必须为 `<skill-name>/SKILL.md`：

```text
~/.agents/skills/<skill-name>/SKILL.md
<workspace>/skills/<skill-name>/SKILL.md
<workspace>/.agents/skills/<skill-name>/SKILL.md
```

其中 `skills/` 用于仓库随附、可公开分发的 Skill，`.agents/skills/` 用于本地安装的项目级 Skill。同名条目按上述顺序覆盖，因此本地安装的项目级 Skill 优先级最高。

项目级 Skill 覆盖同名用户级 Skill。`SKILL.md` 使用 YAML frontmatter，最小内容如下：

```markdown
---
name: pdf-processing
description: Use when reading or modifying PDF documents.
---

# PDF workflow

Read the relevant files before changing them.
```

启动上下文只包含有效 Skill 的名称和描述，不会注入完整正文。任务匹配时，模型调用只接受名称的 `activate_skill` 加载完整说明和 Skill 绝对根目录；引用的 `references/`、`scripts/` 等资源仍按需使用普通工具读取。`/skills` 不调用模型，按名称列出当前生效的名称、描述和 `project`/`user` 来源。Skill 仅在启动时发现，文件变更需重启后生效。无效、超限或通过符号链接逃逸扫描根目录的条目会被跳过；`--verbose` 显示原因。

仓库提供 [`coden-tool-plugin-development`](skills/coden-tool-plugin-development/SKILL.md) Skill，用于指导兼容 Agent Skills 的编程智能体创建、修改和测试本地 TypeScript 或 npm 分发的 CodeN 工具插件，并完成发布前验证。可从本仓库安装指定 Skill：

```bash
npx skills add TwinklerG/CodeN --skill coden-tool-plugin-development
```

## 工具与权限

默认提供 `read`、`write`、`edit`、`bash` 和只读的 `activate_skill`；没有有效 Skill 时，激活工具会返回 `skill.not_found`。结构化文件工具按最终真实路径（新文件按最近存在的真实父目录）分类，避免符号链接绕过：

| 模式 | 工作区内 `read`/`write`/`edit` | 工作区外 `read`/`write`/`edit` |
| --- | --- | --- |
| 默认交互模式 | `read` 自动允许；`write`/`edit` 人工确认 | 作为修改操作请求逐次或会话授权 |
| `--smart-approve` | `read` 自动允许；普通 `write`/`edit` 逐次由独立 LLM 审查，不确定时人工确认 | 直接人工确认 |
| `--auto` | 自动允许 | 返回 `permission.outside_workspace_denied` |
| `--auto --allow-outside-workspace` | 自动允许 | 自动允许 |

`--allow-outside-workspace` 只能与 `--auto` 一起使用，并且**只**控制 `read`、`write`、`edit`。它会允许修改当前工作区之外的任意文本文件，应仅在明确需要时使用。`activate_skill` 仅自动读取已发现且重新验证过的入口 `SKILL.md`；使用普通 `read` 访问用户级 Skill 的附属资源仍适用表中的外部路径规则。

**这不是通用安全沙箱。** `bash` 不受结构化文件路径开关约束，仍以工作区作为当前目录但可以访问外部路径；`bash` 和 TypeScript 插件拥有当前用户进程权限。风险分类是防误操作的启发式护栏。Bash 超时会终止其进程组；主进程内的插件只能通过 `AbortSignal` 协作取消，忽略信号的可信插件可能在超时结果返回后继续运行。

## 本地 TypeScript 插件

CodeN 扫描：

- `~/.config/coden/plugins/*.ts`
- `<workspace>/.coden/plugins/*.ts`
- `--plugin` 或配置中的附加目录

项目插件首次加载始终需人工信任确认；`--auto` 只跳过工具调用确认，不会跳过工作区插件信任。智能审批对每次普通工作区内修改独立审查；危险、工作区外、无效输出、超时或模型故障都转人工，且没有输入时失败关闭。LLM 审批不是沙箱。插件应避免模块顶层副作用；`/reload` 基于内容哈希重建模块并原子替换 Registry（内容未变的插件复用已加载模块）。

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
import type { ToolDefinition } from "@twinklerg/coden/plugin";

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
import type { CodeNPlugin, ToolDefinition } from "@twinklerg/coden/plugin";

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

`@twinklerg/coden/plugin` 是 CodeN 提供给插件作者的公共契约子路径。插件把 `@twinklerg/coden` 放入 `devDependencies` 以在构建时获得类型；`import type` 会在构建时被移除，运行时不加载另一份 CodeN。`ToolContext.signal` 使用 `AbortSignal`，请确保 tsconfig 提供一个定义它的 lib（如 `@types/node` 或 DOM）。

插件契约以 `src/plugin/index.ts` 为唯一来源；构建时自动生成 `dist/plugin/index.d.ts` 和仅包含公开常量的最小 JavaScript 入口，不发布 `src`。CodeN 的 npm 包只暴露 `/plugin` 这一条子路径，主入口 `"."` 未公开，`import "@twinklerg/coden"` 会被拒绝——它定位为 CLI，不作为程序化导入库。

## 生命周期 Hooks

CodeN 支持九个命令 Hook：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Notification`、`Stop` 和 `SessionEnd`。工具类事件按工具名匹配，`Notification` 按通知类型匹配，`SessionStart` 按 `startup|resume` 匹配；其他事件只接受省略 matcher 或 `"*"`。

Hook 配置位于用户级 `~/.config/coden/config.json`（或 `$XDG_CONFIG_HOME/coden/config.json`）以及项目级 `<workspace>/.coden/config.json`。用户 Hook 总在项目 Hook 之前；配置改变后需重启。示例：

```json
{
  "hooks": {
    "PermissionRequest": [{
      "matcher": "bash|edit|write",
      "hooks": [{
        "type": "command",
        "command": "osascript -e 'display notification \"CodeN 正在等待授权\" with title \"CodeN\"'; afplay /System/Library/Sounds/Glass.aiff",
        "timeout": 5
      }]
    }]
  }
}
```

命令在工作区通过系统 shell 运行，从 stdin 接收一个 JSON 对象。公共字段为 `schemaVersion`、`hookEventName`、`sessionId`、可选 `turnId`、`cwd` 和 `permissionMode`，并附加事件数据。环境额外提供 `CODEN_PROJECT_DIR`、`CODEN_SESSION_ID` 和 `CODEN_HOOK_EVENT`。命令不应把事件字段插入 shell 字符串。

退出码 `0` 可在 stdout 返回单个 JSON 对象；退出码 `2` 在可控制事件中明确阻止；其他失败、超时或非法/超限输出均警告并 fail-open。`PreToolUse` 可返回 `permissionDecision: allow|ask|deny`、一个 `updatedInput` 和 `additionalContext`；更新后仍会重新执行 schema、路径、风险和权限检查。并行结果按 `deny > ask > allow` 合并；多个输入更新发生冲突并全部作废。`PermissionRequest` 可返回 `decision.behavior`，`Stop` 可返回顶层 `decision: "block"` 和 `reason`。

以下 Node 脚本可作为 `PreToolUse` 命令，读取 stdin 并批准调用：

```js
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  JSON.parse(input);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" }
  }));
});
```

Stop 检查脚本可输出 `{"decision":"block","reason":"测试尚未运行"}` 要求模型继续；继续仍受 `maxSteps` 限制。

**安全警告：Hook 不是沙箱。** 它继承 CodeN 环境（包括 API Key），可访问文件、网络、完整提示词、工具参数和结果。项目 Hook 与项目插件共用按工作区真实路径保存的显式信任；`manual`、`smart`、`auto` 均不会隐式信任项目代码。`--auto` 只跳过普通工具确认，仍执行 `PreToolUse`，且 `deny` 生效、`ask` 会安全拒绝。使用 `--verbose` 查看成功 Hook；失败、阻止和输入冲突始终显示。Hook stderr/消息会清除终端控制字符，trace 不记录敏感输入输出。

## 开发与测试

```bash
just fmt          # Biome format
just test         # offline Vitest
just check        # Biome lint + strict tsc + complete offline tests
just build        # build the CLI and generate the public plugin contract in dist/
just publish-dry-run  # verify exactly what npm would publish (no upload)
just publish      # lint + typecheck + test, then publish to npm (--access public)
```

离线集成测试用 `ScriptedProvider` 覆盖工具循环、拒绝、重试和恢复。真实 API 冒烟测试（`test/live.test.ts`）默认跳过，仅在显式设置后运行：

```bash
CODEN_LIVE_TEST=1 CODEN_OPENAI_API_KEY=... bun run test    # 可选 CODEN_LIVE_OPENAI_MODEL / CODEN_LIVE_ANTHROPIC_MODEL
```
