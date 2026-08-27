# CodeN 编程智能体架构设计

日期：2026-08-27

## 1. 背景与目标

CodeN 是一个使用 TypeScript 独立实现的极简编程智能体。它通过模型原生 Tool Calling 接口，自主读取和修改文件、执行命令并完成编程任务。项目不使用任何 Agent 框架或服务端托管的代码执行能力。

设计目标：

1. 可靠完成真实的小型编程任务，而不是堆砌功能；
2. 自行实现 Agent 循环、工具执行、上下文管理、会话持久化、错误处理和权限控制；
3. 同时支持 OpenAI-compatible 与 Anthropic API；
4. 保持默认工具集极小，同时允许用户动态加载 TypeScript 工具插件；
5. 通过统一事件流提供流式终端动画、运行指标和结构化追踪；
6. 支持“CodeN 为自己编写并加载新工具”的自举演示。

## 2. 范围

### 2.1 必须完成

- OpenAI-compatible 与 Anthropic Provider；
- 支持流式文本和流式工具调用的 Agent 循环；
- `read`、`write`、`edit`、`bash` 四个默认工具；
- 默认分级授权模式与无确认的 `--auto` 模式；
- 会话自动持久化及 `--resume`；
- 工具输出裁剪、上下文预算和自动压缩；
- 本地 TypeScript 工具插件、项目信任确认和 `/reload`；
- 统一事件流、TTY 动画、非 TTY 降级和 JSONL trace；
- 关键单元测试、集成测试和可选真实 API 冒烟测试。

### 2.2 时间允许时完成

- 以 npmjs 为分发源的插件安装、删除、启停和搜索；
- 插件依赖自动安装和 lockfile；
- 基于 `ripgrep` 与 `fd` 的 Modern Unix 可选工具插件；
- Docker-backed `sandbox-python` 工具插件；
- npm 插件更新和版本切换。

### 2.3 明确不做

- 完整 TUI、会话树和多行编辑器；
- 多智能体、MCP 和计划模式；
- 自建插件服务器或插件网站；
- 自动运行 npm 生命周期脚本；
- Core 内置的通用安全沙箱；
- Git 自动提交、回滚或检查点系统；
- 会话分支和远程同步。

## 3. 技术选型

- 语言：TypeScript，开启严格类型检查；
- 工具链：Bun，用于依赖管理和脚本执行；
- 源码 API：标准 Web/Node.js API，不使用 `Bun.*`；
- Command Runner：Just；
- Lint 与格式化：Biome；
- 类型检查：TypeScript `tsc --noEmit`；
- 测试：Vitest，由 Bun 脚本启动；
- OpenAI-compatible：官方 `openai` 客户端；
- Anthropic：官方 `@anthropic-ai/sdk`；
- Schema：JSON Schema 与 Ajv；
- CLI 参数：Commander；
- 终端颜色：Picocolors；
- ID：`crypto.randomUUID()`。

TypeScript 插件由 Bun 运行时动态导入。CodeN 的业务源码不依赖 Bun 专有 API，但首版运行环境明确要求 Bun，不承诺直接兼容 Node.js。

## 4. 总体架构

CodeN 采用“事件驱动微内核 + 可插拔工具层”。微内核只负责编排 Agent 状态机，不直接依赖具体终端、模型协议或存储实现。

```text
CLI / REPL
    │
    ▼
AgentRuntime ─────────────── EventBus ──┬─ TerminalRenderer
    │                                  └─ JSONLTraceWriter
    ├─ ContextManager
    ├─ ModelProvider
    ├─ ToolRegistry
    │    ├─ BuiltinTools
    │    └─ PluginLoader
    ├─ ToolExecutor
    ├─ PermissionPolicy
    └─ SessionStore
```

建议目录：

```text
src/
├── core/             # Runtime、领域类型、事件定义和接口
├── providers/        # OpenAI、Anthropic 适配器
├── tools/
│   ├── builtin/      # read、write、edit、bash
│   ├── plugin-loader.ts
│   ├── registry.ts
│   └── executor.ts
├── context/          # 预算、裁剪和压缩
├── sessions/         # JSONL 会话存储与恢复
├── permissions/      # 路径约束和风险策略
├── observability/    # TerminalRenderer 与 trace
├── config/           # 配置合并与数据目录
└── cli/              # 参数、REPL 和斜杠命令
```

依赖方向为 `CLI/Adapters → Core Interfaces`。Core 不反向依赖 CLI、具体 Provider、具体工具或具体存储。

## 5. Agent Runtime

### 5.1 状态机

每次用户输入形成一个 `Turn`：

```text
IDLE
  → PREPARING_CONTEXT
  → REQUESTING_MODEL
  → STREAMING_RESPONSE
  ├─→ COMPLETED
  └─→ EXECUTING_TOOLS
       → APPENDING_RESULTS
       → PREPARING_CONTEXT
```

核心循环：

1. ContextManager 从会话构造本次模型上下文；
2. Provider 将规范化请求转换为厂商协议并流式返回事件；
3. Runtime 累积完整的 assistant message；
4. 若没有工具调用，保存最终消息并结束本轮；
5. 若有工具调用，逐个完成校验、授权、执行和结果保存；
6. 工具结果重新进入上下文，继续请求模型。

首版按模型返回顺序串行执行工具调用，以保证权限提示、文件修改和 trace 顺序确定。默认最多执行 20 个模型步骤，并允许通过参数调整。达到上限时产生 `runtime.step_limit`，保存会话并明确结束为失败。

### 5.2 终止条件

- 模型给出不含工具调用的最终文本；
- 用户取消当前 Turn；
- 达到最大步骤数；
- 上下文在紧急压缩后仍然超限；
- Provider 连续失败超过重试限制；
- 会话无法可靠写入；
- 发生其他不可恢复的 Runtime 错误。

## 6. 规范化消息与 Provider

Core 使用厂商无关的消息：

```ts
type AgentMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;
```

`AssistantMessage` 可以包含文本、多个工具调用、模型信息和 usage。每个工具调用拥有稳定的 `callId`，工具结果必须引用对应 ID。

统一 Provider 接口：

```ts
interface ModelProvider {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}
```

首版实现：

- `OpenAICompatibleProvider`；
- `AnthropicProvider`。

Provider 负责：

- 规范化消息与厂商消息格式互转；
- 合并流式文本与工具参数片段；
- 将厂商 usage 转换为统一结构；
- 保证各厂商要求的工具调用与结果顺序。

Provider 不负责 Agent 循环、工具执行、权限或会话保存。

## 7. 工具系统

### 7.1 默认工具

默认只向模型暴露：

1. `read`：按 offset/limit 读取文本；
2. `write`：新建或完整覆写文件；
3. `edit`：唯一文本匹配和精确替换；
4. `bash`：执行命令，支持超时、取消、退出码和输出上限。

`bash` 已能组合绝大多数 Unix 工具。`ripgrep` 和 `fd` 不作为默认工具；模型可以通过 `bash` 调用它们，也可启用基于二者的结构化可选插件。

### 7.2 ToolRegistry

内置工具和插件实现相同接口：

```ts
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: "read" | "modify" | "dangerous";
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
```

Registry 负责名称唯一性、保留名称、Schema 合法性和启用状态。输入经 Ajv 校验后才能进入权限与执行阶段。插件声明的风险只能作为最低风险，CodeN 可以升级风险，不能自动降级风险。

### 7.3 本地 TypeScript 插件

发现位置：

```text
~/.config/coden/plugins/
<workspace>/.coden/plugins/
```

插件默认导出 `ToolDefinition`。加载流程：

1. 扫描 `.ts` 文件；
2. 使用带文件修改时间的模块 URL 动态导入；
3. 校验导出结构和 JSON Schema；
4. 检查工具重名与保留名称；
5. 构建候选 Registry；
6. 完成扫描后原子替换当前 Registry；
7. 发出 `plugin.loaded`、`plugin.unavailable` 或 `plugin.failed`。

单个插件失败不会阻止内置工具和其他插件加载。`/reload` 重新扫描并替换注册表，但不能撤销插件模块顶层产生的全局副作用，因此插件规范要求避免在顶层执行重操作。

项目插件是拥有完整进程权限的可信代码。默认首次加载项目前需要确认并按真实路径记录信任决定；`--auto` 跳过该确认。

PluginLoader 与 ToolExecutor 分离。未来可以增加子进程执行器，但首版插件直接在主进程执行。

## 8. npm 插件分发

npm 功能属于时间允许范围，不影响本地插件闭环。

npm 插件通过 `package.json` 声明：

```json
{
  "name": "@example/coden-code-stats",
  "version": "1.0.0",
  "type": "module",
  "keywords": ["coden-plugin"],
  "coden": {
    "tools": ["./src/code-stats.ts"]
  },
  "dependencies": {
    "some-library": "^2.0.0"
  }
}
```

计划支持：

```text
coden plugin install <package[@version]>
coden plugin remove <package>
coden plugin list
coden plugin enable <package>
coden plugin disable <package>
coden plugin search <query>
```

插件安装到独立用户数据目录，不修改当前项目的 `package.json`。CodeN 以该目录为 cwd 调用 Bun 安装依赖，禁用依赖安装生命周期脚本，并保留准确版本和 lockfile。安装成功且 manifest 校验通过后才更新启用状态；失败时保持现有 Registry。

`search` 查询 npm registry 并优先展示具有 `coden-plugin` keyword 的包。npmjs 只承担存储、搜索、版本和依赖分发，CodeN 自己维护插件规范、信任确认和启用状态。

禁用生命周期脚本只能减少安装阶段风险。插件导入时仍会执行任意代码，因此默认安装前展示包名、版本、来源和权限警告；`--auto` 跳过确认。

## 9. 权限和工作区

### 9.1 权限等级

每次工具调用依次经过：

```text
Schema 校验 → 工作区约束 → 风险分类 → 权限策略 → 执行
```

默认模式：

| 等级 | 示例 | 行为 |
|---|---|---|
| `read` | `read`、只读插件工具 | 自动执行 |
| `modify` | `write`、`edit`、普通 `bash` | 允许本次、会话内允许或拒绝 |
| `dangerous` | `rm -rf`、`sudo`、`git reset --hard` | 每次单独确认 |

高风险调用不提供会话级授权。`--auto` 跳过所有授权和项目信任确认，但仍保留 Schema 校验、文件工具工作区约束和完整事件记录。

会话内临时授权不跨进程恢复。

### 9.2 Bash 风险分类

`CommandRiskClassifier` 识别递归删除、提权、破坏性 Git 命令、磁盘操作、大范围结束进程、系统路径修改、下载后直接执行等常见危险特征。无法确定时按 `modify` 处理。

Shell 命令可以动态拼接，因此风险分类是防止误操作的启发式护栏，不是安全证明。Bash 在工作区中启动，但在没有容器或操作系统沙箱时仍可访问工作区外部。

### 9.3 文件路径边界

`read`、`write` 和 `edit`：

1. 将输入解析为绝对路径并规范化 `..`；
2. 对已存在路径检查真实路径，防止符号链接逃逸；
3. 对新文件检查最近存在父目录的真实路径；
4. 拒绝工作区外路径。

## 10. 会话与上下文管理

### 10.1 三类数据

- Session History：恢复所需的完整事实记录；
- Model Context：从历史生成、受 token 预算限制的请求投影；
- Trace Events：状态、耗时、重试和错误等观测数据。

上下文压缩不删除 Session History，trace 中的运行噪声也不发送给模型。

### 10.2 会话存储

会话保存在用户数据目录而不是项目仓库：

```text
<user-data>/coden/sessions/<workspace-hash>/
├── <session-id>.jsonl
└── <session-id>.trace.jsonl
```

会话文件包括 `session.created`、用户消息、assistant 消息、工具结果和压缩记录。每条记录具有 schema version、ID 和时间戳。

存储采用单一写入者顺序追加。恢复时校验消息结构和工具调用配对；若崩溃导致最后一行是不完整 JSON，则忽略该行并发出警告。写入失败时停止当前 Turn，避免继续扩大执行状态与历史状态的不一致。

`--resume <id>` 恢复消息和最近有效的压缩状态，但使用当前环境中的 API 凭据和当前权限状态。

### 10.3 上下文预算

每个模型配置：

```text
contextWindow
reservedOutputTokens
safetyMargin
```

输入预算为：

```text
inputBudget = contextWindow - reservedOutputTokens - safetyMargin
```

`TokenEstimator` 为不同 Provider 提供保守估算；API 返回 usage 后记录实际值。上下文优先级为系统提示、项目说明、工具定义、压缩摘要、最近完整消息。

### 10.4 工具结果裁剪

- `read` 强制支持 offset/limit；
- `bash` 限制输出字符数并保留头尾；
- 省略内容明确标记省略量；
- 模型可通过更精确的读取或命令继续查询。

### 10.5 自动压缩

估算占用达到输入预算约 80% 时：

1. 固定保留系统提示、当前任务和最近完整轮次；
2. 选取较老的连续消息前缀；
3. 调用当前模型生成结构化摘要；
4. 保存引用源消息范围的 `CompactionEntry`；
5. 后续上下文使用摘要代替旧消息。

摘要保留用户目标、约束、决策、已修改文件、工具与测试结果、未解决错误和下一步。工具调用和对应结果必须一起保留或一起压缩。

主动压缩失败时采用确定性裁剪并记录警告。Provider 返回上下文超限时执行一次紧急压缩并重试；重试后仍超限则产生 `context.exhausted`。

## 11. 错误处理

### 11.1 统一错误模型

结构化错误包含：

- `category`：provider、context、tool、permission、plugin、session 或 runtime；
- `code`：稳定、可测试的错误码；
- `message`：面向用户的说明；
- `cause`：供调试使用的原始异常；
- `retryable`：是否可重试；
- `details`：工具名、call ID、HTTP 状态等元数据。

错误行为分为：

```text
可恢复错误   → 反馈给模型继续循环
可重试错误   → Runtime 按策略自动重试
不可恢复错误 → 保存状态并清晰终止
```

### 11.2 Provider 错误

- 网络中断、429 和部分 5xx：尊重 `Retry-After`，指数退避加抖动，最多三次；
- API key 无效、模型不存在和非法请求：立即失败；
- 上下文超限：紧急压缩后重试一次；
- 流式响应中断：trace 可记录已收到片段，但不把不完整工具调用写成有效消息；
- 响应格式异常：记录摘要并终止本轮。

### 11.3 工具和插件错误

- Schema 不合法、文件不存在、编辑匹配失败、命令非零退出：作为工具结果反馈给模型；
- 用户拒绝授权：返回明确的 permission denied 工具结果；
- 命令或插件执行超时：取消执行并返回超时结果；
- 未知工具异常：转换为 `tool.internal_error`，防止 Runtime 崩溃；
- 插件导入、Schema 或依赖失败：跳过该插件并继续加载其余工具；
- 工具重名：拒绝后加载者，不静默覆盖内置工具。

### 11.4 Runtime 兜底

- `AbortController` 统一传播用户取消；
- Runtime 顶层捕获未知错误，并优先写入失败事件；
- 每轮必须产生 `turn.completed` 或 `turn.failed`；
- 非交互模式以退出码区分成功、配置错误和执行失败；
- TerminalRenderer 在失败或取消时恢复终端光标和当前行。

## 12. 事件与终端体验

核心事件包括：

```text
turn.started
context.prepared
provider.started
provider.delta
provider.retry
provider.completed
tool.requested
permission.requested
tool.started
tool.completed
context.compacted
plugin.loaded
plugin.failed
turn.completed
turn.failed
```

### 12.1 TerminalRenderer

渲染状态机：

```text
IDLE → SPINNING → STREAMING → TOOL_STATUS → IDLE
```

TTY 环境使用 ANSI 转义和 Node.js `readline` API提供 spinner、颜色和原地更新。模型文本按 delta 实时写入；工具运行时显示动态状态；状态变化前清理活动行。

非 TTY、CI 或 `NO_COLOR` 环境降级为稳定纯文本。`-p` 模式的最终回答写 stdout，运行状态写 stderr，便于管道组合。动画只订阅 EventBus，不进入 Runtime。

每轮结束显示工具数量、耗时、输入/输出 token 和上下文占用。`--verbose` 显示重试、上下文构造、插件加载和错误码；完整结构化事件写入 trace JSONL。

## 13. CLI 与配置

主要用法：

```bash
coden
coden "修复当前项目的测试失败"
coden -p "实现功能并运行测试"
coden -p --auto "实现功能并运行测试"
coden --resume <session-id>
```

核心参数：

```text
--provider <openai|anthropic>
--model <model-id>
--resume <session-id>
--auto
--verbose
--max-steps <number>
--plugin <path>
```

REPL 首版命令：

```text
/help
/session
/compact
/reload
/new
/quit
```

配置优先级：

```text
CLI 参数 > 环境变量 > 项目 .coden/config.json > 用户配置 > 内置默认值
```

API 凭据从 `CODEN_OPENAI_API_KEY`、`CODEN_OPENAI_BASE_URL` 和 `CODEN_ANTHROPIC_API_KEY` 等环境变量读取。项目配置只保存 provider、model、插件路径和最大步骤等非凭据信息。

## 14. 可选 Python 沙箱插件

`sandbox-python` 是时间允许时实现的独立工具插件，而不是 Core 的安全承诺：

```text
AgentRuntime
  → sandbox_python Tool Plugin
      → DockerSandboxBackend
          → isolated Python process
```

插件可接受脚本、指定输入文件和超时。Docker 后端关闭网络，使用只读文件系统、丢弃 capabilities、禁止权限提升，并限制内存、CPU、进程数和执行时间。仅挂载临时目录或明确指定的只读输入。

该隔离只保护被执行的 Python 脚本。`sandbox-python` TypeScript 插件自身仍是主进程中的可信代码，Docker 也不被描述为绝对安全边界。

## 15. 测试策略

### 15.1 单元测试

- 两种 Provider 的消息转换和流式工具参数合并；
- JSON Schema 校验；
- 文件路径规范化与符号链接逃逸；
- `edit` 的零匹配、多匹配和成功替换；
- Bash 风险分类；
- 插件非法导出、重名、缺失依赖和单插件失败隔离；
- token 预算、工具输出裁剪和压缩边界；
- 工具调用与结果配对保护；
- JSONL 最后一行损坏恢复；
- TerminalRenderer 的 TTY、非 TTY、取消和流中断行为。

### 15.2 集成测试

使用不访问网络的 `ScriptedProvider` 驱动完整循环，覆盖：

- read → edit → bash test → 最终回答；
- 工具失败后模型读取错误并重试；
- 用户拒绝授权；
- Provider 暂时失败后重试；
- 上下文超限后压缩；
- TypeScript 插件加载和 `/reload`；
- 退出后恢复会话并继续；
- `--auto` 下不出现确认。

### 15.3 真实 API 冒烟测试

真实 API 测试默认不进入 CI，只在显式设置 `CODEN_LIVE_TEST=1` 时运行。每种 Provider 验证一次文本响应和一次工具调用。

## 16. 自举演示

视频在 CodeN 仓库的临时副本或演示分支中进行，避免修改正在运行的程序实例：

1. 启动 CodeN，展示模型、工作区、会话、模式和已加载工具；
2. 要求 CodeN 阅读 `ToolDefinition` 及一个插件示例；
3. 让它实现一个原本不存在、规模可控的 TypeScript 工具及测试；
4. CodeN 使用默认四工具修改代码并运行测试；
5. 输入 `/reload`，展示 `plugin.loaded` 事件；
6. 让 CodeN 在下一轮实际调用刚新增的工具；
7. 展示结果及工具耗时、token 和上下文指标。

演示工具选择标准：核心实现约 20–40 行、输入输出直观、有 2–3 个测试、不重复默认四工具。候选包括代码语言与行数统计、结构化 Git diff 摘要、依赖更新查询或目录大小统计。

演示前固定模型、初始仓库状态和任务描述，并至少完成三次全流程演练。

## 17. 验收标准

1. 两种 Provider 均能完成一次包含工具调用的真实任务；
2. `ScriptedProvider` 集成测试可稳定复现完整 Agent 循环；
3. 默认只向模型暴露四个工具；
4. 默认模式按风险授权，`--auto` 全程无确认；
5. 会话可退出后恢复，损坏尾记录不会导致整个会话不可读；
6. 大型工具输出受到限制，长会话可主动或被动压缩；
7. 新增本地 TypeScript 插件后可通过 `/reload` 注册并调用；
8. 单个插件失败不影响 Core 和其他插件；
9. TTY 中流式文本和状态动画正常，非 TTY 输出可稳定用于管道；
10. trace 可以解释一次 Turn 中的 Provider、上下文、权限和工具行为；
11. 视频中的自举任务能够重复完成，而非依赖一次性偶然结果。
