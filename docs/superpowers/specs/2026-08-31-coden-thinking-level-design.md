# CodeN Thinking Level 设计

## 1. 目标

CodeN 当前能够展示部分 Provider 返回的 reasoning 流，但不能控制模型的推理强度。本设计增加统一的 thinking level：用户可通过配置、环境变量、CLI 或会话内命令选择推理等级，CodeN 再将统一语义适配为 OpenAI 和 Anthropic 的原生参数。

目标是：

1. 为 OpenAI 和 Anthropic 提供统一、可理解的 thinking level；
2. 默认保持现有请求行为，不因升级 CodeN 改变延迟、费用或模型输出；
3. 支持在 CLI 和 TUI 会话中动态切换；
4. 将选择持久化到对应 session，确保 resume 后保持不变；
5. 完整支持 Anthropic extended thinking 与工具调用、会话恢复的连续性要求；
6. 不维护容易过时的模型能力白名单，不对显式设置做静默降级。

## 2. 范围

本次实现：

- 新增 `default | off | minimal | low | medium | high` 六种统一等级；
- 新增 `thinkingLevel` 配置、`CODEN_THINKING_LEVEL` 环境变量和 `--thinking` CLI 参数；
- 新增 CLI/TUI 共用的 `/thinking [level]` 命令；
- thinking level 只作用于主 Agent 的回答和工具调用请求；
- 在 TUI 状态栏显示配置等级及必要的有效映射；
- 按 Provider 映射 OpenAI reasoning effort 和 Anthropic thinking budget；
- 保存并恢复 session 的 thinking level；
- 保存并回传 Anthropic thinking、redacted-thinking 和签名状态；
- 更新中英文界面、README、配置说明和测试。

本次不实现：

- 基于模型 ID 的能力白名单或自动等级选择；
- 为上下文压缩请求配置独立 thinking level；
- 为 Smart Approval reviewer 配置或继承 thinking level；
- 按任务内容自动调整等级；
- 将 `/thinking` 写入用户或项目配置；
- 在一个正在执行的 turn 中途改变 thinking level；
- 为不同 Provider 暴露独立的原生 thinking 配置项。

## 3. 方案选择

### 3.1 采用：核心统一语义，Provider 负责适配

thinking level 是模型请求语义，因此在核心层定义统一类型并由 `ModelRequest` 携带。`AgentRuntime` 管理当前等级，OpenAI 和 Anthropic Provider 分别完成原生参数映射。

Anthropic 工具调用要求后续请求原样回传此前的 thinking 状态。因此 assistant message 额外携带带 Provider 标识、可 JSON 序列化的不透明状态；Runtime 和 session 只负责传递和保存，不解释其中内容。

该方案的优点：

- 主请求、上下文压缩和审批请求的边界明确；
- Provider 差异不会泄漏到 Runtime 控制流；
- 动态切换、重试和 session resume 有单一状态来源；
- 后续增加 Provider 时可复用统一请求语义；
- Anthropic 连续性数据能够随消息完成持久化和上下文淘汰。

### 3.2 不采用：Provider 实例保存可变等级

让 Provider 暴露 `setThinkingLevel()` 虽然减少核心类型改动，但主 Agent、上下文压缩和 Smart Approval 共用 Provider，辅助请求容易错误继承等级。Provider 内部缓存 Anthropic thinking blocks 也难以可靠支持 session resume。

### 3.3 不采用：Application 层包装 Provider

为主 Agent 创建 thinking-aware Provider wrapper 可以隔离辅助请求，但 session 恢复仍需要修改核心消息结构，并会重复 Provider 映射和状态管理边界，整体复杂度高于直接扩展 `ModelRequest`。

## 4. 统一等级语义

新增统一类型：

```ts
type ThinkingLevel =
  | "default"
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high";
```

语义如下：

| 等级 | 统一语义 |
| --- | --- |
| `default` | 不发送 thinking 参数，完全采用模型或服务端默认行为 |
| `off` | 显式要求关闭 thinking；无法真正关闭时使用 Provider 定义的最低等级并明确展示映射 |
| `minimal` | 使用 Provider 可表达的最小推理强度 |
| `low` | 低推理强度 |
| `medium` | 中等推理强度 |
| `high` | 高推理强度 |

`default` 与 `off` 不等价：前者不干预 Provider，后者表达显式关闭意图。由于 OpenAI reasoning 模型不提供统一的真正关闭值，OpenAI 上的 `off` 会映射为 `minimal`，界面显示 `off→minimal`，避免误导。

默认等级是 `default`。升级 CodeN 后，未配置该功能的用户不会新增请求参数，也不会改变现有模型行为。

## 5. 核心类型与组件职责

### 5.1 请求类型

`ModelRequest` 增加可选 thinking level：

```ts
interface ModelRequest {
  model: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
  thinkingLevel?: ThinkingLevel;
  signal?: AbortSignal;
}
```

主 Agent 请求携带当前 turn 快照的等级，包括 `default`。Provider 看到 `default` 时不发送原生参数。上下文压缩和 Smart Approval 请求不设置 `thinkingLevel`，从结构上保证它们保持 Provider 默认行为。

### 5.2 Provider 消息状态

核心层增加 JSON 值和不透明状态类型：

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface ProviderMessageState {
  provider: string;
  data: JsonValue;
}
```

`AssistantMessage` 增加可选 `providerState`。`ModelEvent` 增加一个完整状态事件，Provider 在一次流结束前发出，Runtime 收集后附到 assistant message。状态必须通过 JSON 可序列化结构校验，禁止放入 SDK 实例、函数或循环引用。

Provider 只读取与自身标识匹配的状态。恢复 Anthropic session 后改用 OpenAI 时，OpenAI 忽略 Anthropic 状态；消息内容和工具调用仍可正常转换。

### 5.3 `AgentRuntime`

`AgentRuntime` 持有当前 `ThinkingLevel`，并提供查询和更新接口。每个 `run()` 开始时快照当前等级；该 turn 内的首次请求、工具结果后的后续请求以及 Provider 重试均使用同一个快照。`/thinking` 只能在空闲状态执行，因此切换从下一 turn 开始生效。

Runtime 只在主循环构造的 `ModelRequest` 中填写 level。`refineSummary()` 继续直接构造不含 level 的请求。

### 5.4 `AgentApplication`

`AgentApplication` 负责 thinking 状态的应用级协调：

1. 结合配置、session 和显式 CLI 参数解析启动等级；
2. 校验等级及当前 Provider 的确定性预算约束；
3. 更新 Runtime 当前等级；
4. 更新 `AgentApplicationMetadata`；
5. 将变更写入 session；
6. 发出 `thinking.changed` 事件，供 TUI 和其他观察者刷新。

CLI 和 TUI 的 `/thinking` 共用该应用接口，不直接修改 Runtime、Provider 或 session。

## 6. 配置与优先级

`CodeNConfig` 增加：

```ts
thinkingLevel: ThinkingLevel;
```

配置示例：

```json
{
  "provider": "openai",
  "model": "gpt-5-mini",
  "thinkingLevel": "medium"
}
```

环境变量和 CLI：

```bash
export CODEN_THINKING_LEVEL=medium
coden --thinking high
```

普通新 session 继续采用项目既有的配置优先级：

```text
CLI --thinking
  > CODEN_THINKING_LEVEL
  > <workspace>/.coden/config.json
  > ~/.config/coden/config.json
  > default
```

resume 时需要在该优先级上插入 session 状态：

```text
显式 CLI --thinking
  > session 最后保存的 thinking level
  > CODEN_THINKING_LEVEL
  > 项目配置
  > 用户配置
  > default
```

这里的“显式 CLI”通过 `AgentCommandOptions.thinking` 是否存在判断，不能仅查看合并后的 `CodeNConfig`。因此当前环境变量或配置变更不会意外改变已存在 session；用户仍可用 `--resume <id> --thinking <level>` 主动覆盖。

所有入口共用严格解析器，只接受六个规范小写值。非法配置、环境变量或 CLI 参数导致配置错误；非法 `/thinking` 参数只产生命令错误，不改变当前状态。

## 7. Session 持久化与恢复

使用追加式记录保存抽象等级，不保存映射后的 Provider 值：

```json
{
  "version": 1,
  "type": "session.thinking",
  "data": { "level": "medium" }
}
```

规则如下：

1. 新 session 第一次运行时，先创建 session，再在首条消息前写入当前 level；
2. 新 session 在首轮运行前执行 `/thinking` 时只更新内存，首次运行记录最终值，避免创建空 session；
3. 已创建 session 执行 `/thinking` 后立即追加记录；
4. 切换到当前相同值属于无操作，不追加重复记录；
5. resume 读取最后一条 `session.thinking`；
6. resume 时显式 CLI level 与保存值不同时，启动完成后立即追加覆盖记录；
7. `/new` 只重置当前 session 的对话，不改变 thinking level；
8. 旧 session 没有 thinking 记录时回退当前配置；
9. 旧版本会忽略新的记录类型，因此 JSONL schema 保持 version 1。

`RecoveredSession` 增加可选 `thinkingLevel`。已识别但结构非法的 `session.thinking` 按现有 session 损坏规则报错，不能悄悄应用未知值。

Anthropic `providerState` 随 assistant message 走现有 `message` 记录，无需增加独立状态日志。session 恢复校验允许合法的可选状态，并拒绝不可序列化或结构错误的数据。

## 8. OpenAI 映射

OpenAI 和 OpenAI-compatible Provider 使用 `reasoning_effort`：

| CodeN level | `reasoning_effort` |
| --- | --- |
| `default` | 不发送 |
| `off` | `minimal` |
| `minimal` | `minimal` |
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high` |

`off` 不得在界面中伪装为真正关闭；metadata 和 `/thinking` 将其描述为 `off→minimal`。

CodeN 不根据模型 ID判断能力，也不为 OpenAI-compatible 服务维护单独列表。显式非 `default` 值始终映射并发送：支持该参数的服务正常处理，会忽略该参数的兼容服务可以继续运行，拒绝该参数的服务返回清晰 Provider 错误。CodeN 不自动回退到 `default`。

当前 reasoning stream 的 `reasoning_content` 兼容处理保持不变。OpenAI 不需要持久化 Provider reasoning 状态。

## 9. Anthropic 映射

### 9.1 Thinking budget

Anthropic 使用 `thinking` 配置：

| CodeN level | Anthropic 参数 |
| --- | --- |
| `default` | 不发送 `thinking` |
| `off` | `{ type: "disabled" }` |
| `minimal` | `{ type: "enabled", budget_tokens: 1024 }` |
| `low` | enabled，目标为 `maxOutputTokens × 25%` |
| `medium` | enabled，目标为 `maxOutputTokens × 50%` |
| `high` | enabled，目标为 `maxOutputTokens × 75%` |

`low`、`medium` 和 `high` 使用以下公式：

```text
budget = min(
  maxOutputTokens - 1,
  max(1024, floor(maxOutputTokens × ratio))
)
```

默认 `maxOutputTokens = 8192` 时，结果为：

| level | budget tokens |
| --- | ---: |
| `minimal` | 1024 |
| `low` | 2048 |
| `medium` | 4096 |
| `high` | 6144 |

Anthropic thinking budget 是 `max_tokens` 的组成部分，不额外扩大 `reservedOutputTokens` 或上下文窗口。提高 thinking level 会减少同一输出预算内可用于最终文本和工具调用的 token，这是用户显式选择的成本。

Anthropic 要求 `budget_tokens >= 1024` 且小于 `max_tokens`。当有效 level 需要启用 thinking、但 `maxOutputTokens <= 1024` 时，CodeN 在启动或 `/thinking` 切换阶段给出明确配置错误；`default` 和 `off` 不受此约束。

### 9.2 流式 reasoning

Anthropic Provider 增加以下处理：

- 将 `thinking_delta` 转换为核心 `reasoning_delta`，复用现有 CLI/TUI 展示；
- 收集 thinking 文本和 `signature_delta`；
- 收集 redacted-thinking 内容块；
- 保留 reasoning 内容块的原始顺序；
- 在流结束前发出完整 `provider_state`；
- reasoning 内容不合并进 assistant 最终文本。

### 9.3 工具调用回传

将 assistant message 转换为 Anthropic 消息时，如果 `providerState.provider === "anthropic"`，Provider 将保存的 thinking 和 redacted-thinking 块原样放回 assistant content，并置于普通文本和 `tool_use` 块之前。

每个 assistant message 只携带自身的状态。工具执行后的后续模型请求、后续用户 turn 和 session resume 都通过普通消息历史完成回传，不依赖 Provider 进程内缓存。

ContextManager 当前对完整 message JSON 估算 token，因此状态内容自动计入预算。消息所属对话单元被压缩淘汰时，其 Provider 状态一起淘汰；确定性摘要只读取 assistant 最终文本和工具结果，不把 reasoning 内容复制到摘要。

## 10. `/thinking` 命令

CLI 和 TUI 共用以下命令：

```text
/thinking
/thinking default
/thinking off
/thinking minimal
/thinking low
/thinking medium
/thinking high
```

无参数时显示：

- 六种可用等级；
- 当前配置等级；
- 当前 Provider 的有效映射；
- Anthropic 启用 thinking 时的实际 token budget；
- 简短用法。

有参数时：

1. 解析规范值；
2. 校验确定性 Provider 约束；
3. 原子更新 Runtime 和 metadata；
4. 在已创建 session 中追加记录；
5. 发出变更事件；
6. 返回当前值和有效映射。

非法参数不会被当作普通用户消息发送给模型。切换失败时旧 Runtime 值、metadata 和 session 均保持不变。

## 11. CLI 与 TUI 展示

CLI help 增加：

```text
--thinking <default|off|minimal|low|medium|high>
```

中英文 i18n 增加配置说明、参数错误、命令列表、当前值、有效映射、切换成功和失败文本。README 的核心选项、配置示例、环境变量和 REPL 命令同步更新。

`AgentApplicationMetadata` 增加 thinking 配置值和有效显示值。TUI 状态栏示例：

```text
openai/gpt-5-mini · workspace · smart · think off→minimal · idle · context 42%
anthropic/claude-sonnet · workspace · manual · think medium · idle · context 42%
```

显示规则：

- `default` 显示 `think default`；
- 映射与配置同名时显示配置值；
- OpenAI `off` 显示 `think off→minimal`；
- Anthropic 的具体 token budget 由 `/thinking` 展示，避免状态栏过长；
- thinking 信息始终参与完整状态栏；窄屏沿用现有按空间裁剪的退化策略；
- 动态切换后通过事件立即刷新，不需要重启 TUI。

传统 CLI 无常驻状态栏，切换结果和 `/thinking` 查询承担可观察性。

## 12. 错误、重试与兼容性

### 12.1 本地错误

以下错误在发送请求前发现：

- 非法 thinking level；
- Anthropic 启用 thinking 时输出预算不足；
- session thinking 记录格式损坏；
- Provider 状态不满足 JSON 结构要求。

启动配置错误按现有 `ConfigError` 路径报告。`/thinking` 错误作为命令输出显示，不终止交互会话。

### 12.2 Provider 错误

模型或兼容端点不支持映射后的参数时，保留服务端错误。参数类 4xx 错误不得通过移除 thinking 参数后静默重试；现有可重试网络、限流和服务错误继续使用同一 turn 快照的 level。

### 12.3 兼容性

- `default` 不发送新参数，保持现有行为；
- `thinkingLevel` 为新配置字段，旧配置继续有效；
- `providerState` 是可选 assistant 字段，旧 session 消息继续有效；
- session JSONL 保持 version 1；
- 使用旧 CodeN 打开新 session 时，未知 `session.thinking` 记录会被忽略；
- OpenAI 忽略 Anthropic 状态，Anthropic 忽略其他 Provider 状态；
- 当前安装的 OpenAI 和 Anthropic SDK 已包含所需请求与流事件类型，不要求升级依赖。

## 13. 数据安全与可观察性

完整 Anthropic 工具调用支持要求 session JSONL 保存 thinking、redacted-thinking 和签名。模型 reasoning 可能包含用户输入、代码片段或其他敏感内容。README 必须明确说明：

- session 和 trace 可能包含模型推理内容；
- 数据保存在 `$XDG_DATA_HOME/coden/sessions/<workspace-hash>/`；
- 目录和文件继续使用现有 `0700`、`0600` 权限；
- 用户不应无审查地分享 session 或 trace。

现有 trace 已记录 `provider.reasoning_delta`；本次持久化的 Provider 状态用于 API 连续性，不进入最终 assistant 文本。确定性摘要不复制 reasoning 内容，但尚未被压缩的消息状态仍会随 session 保存并计入上下文预算。

新增 `thinking.changed` 事件只记录抽象等级、有效映射和 Anthropic 预算等非敏感元数据，不重复记录 thinking 内容。

## 14. 测试策略

### 14.1 配置测试

覆盖：

- 六种合法值和各种非法类型、未知值；
- 默认值为 `default`；
- CLI、环境变量、项目配置和用户配置优先级；
- `CODEN_THINKING_LEVEL`；
- resume session 高于普通配置；
- 显式 `--thinking` 高于 resume session；
- 其他现有配置行为不回归。

### 14.2 Runtime 测试

覆盖：

- 主 Agent 请求携带 level；
- `default` 到达 Provider 后不产生原生参数；
- 上下文压缩请求不携带 level；
- Smart Approval 请求不携带 level；
- 工具调用 turn 的所有步骤使用同一快照；
- Provider 重试保持同一快照；
- `/thinking` 切换只影响下一 turn；
- Provider 状态被收集并附到对应 assistant message。

### 14.3 OpenAI Provider 测试

覆盖：

- 六种等级的请求体映射；
- `default` 不包含 `reasoning_effort`；
- `off` 映射为 `minimal`；
- reasoning delta 和现有工具调用流不回归；
- 不支持参数的 Provider 错误不触发静默降级。

### 14.4 Anthropic Provider 测试

覆盖：

- `default`、disabled 和四档启用参数；
- 1025、默认 8192 和自定义输出预算的动态比例边界；
- 输出预算不足错误；
- thinking delta 展示；
- signature delta 聚合；
- redacted-thinking 保存；
- 多 reasoning 块顺序；
- thinking 块、文本和 tool use 的回传顺序；
- 工具结果后的下一请求完整回传；
- Provider 标识不匹配时忽略状态；
- session resume 后继续完整回传。

### 14.5 Session 测试

覆盖：

- 新 session 首条消息前记录初始 level；
- 首轮前多次切换只记录最终值；
- 已创建 session 动态切换追加记录；
- 相同值不重复记录；
- resume 恢复最后值；
- 显式 CLI 覆盖并持久化；
- `/new` 保留等级；
- 旧 session 无记录时回退配置；
- 非法记录失败；
- assistant Provider 状态通过保存和恢复保持一致。

### 14.6 CLI、REPL 与 TUI 测试

覆盖：

- `--thinking` help、解析和错误；
- `/thinking` 查询、六种切换和非法输入；
- 非法命令不会发送给模型；
- CLI 与 TUI 共用行为；
- 状态栏完整显示 `default`、普通等级和 `off→minimal`；
- 窄屏退化；
- 动态事件触发 metadata 和状态栏刷新；
- 中英文消息与 README 示例。

### 14.7 验收命令

实现完成后运行：

```bash
just check
just build
node dist/index.js --help
```

同时运行 `git diff --check`，并确认用户已有未跟踪文件未被纳入提交。

## 15. 验收标准

实现满足以下条件即验收：

1. 未配置时使用 `default`，所有 Provider 请求保持当前行为；
2. 用户可通过配置、环境变量和 `--thinking` 设置六种统一等级；
3. `/thinking` 可在 CLI/TUI 空闲状态查询和动态切换；
4. thinking level 只作用于主 Agent 请求，不影响压缩和 Smart Approval；
5. OpenAI 按表映射，`off` 明确显示为 `off→minimal`；
6. Anthropic 按输出预算动态计算 thinking tokens，且不突破 `reservedOutputTokens`；
7. 不支持 thinking 参数的模型或端点产生清晰错误，不静默降级；
8. 同一 turn 内的工具循环和 Provider 重试使用稳定等级；
9. session 保存最后选择，resume 默认恢复，显式 CLI 可覆盖并更新 session；
10. Anthropic thinking、redacted-thinking 和签名能够跨工具调用及 resume 原样回传；
11. TUI 状态栏始终纳入 thinking 信息，`/thinking` 可查看完整有效映射；
12. session/trace 推理数据的隐私影响在 README 中明确说明；
13. 现有配置、会话、OpenAI、Anthropic、CLI 和 TUI 行为无非预期回归；
14. README、测试、格式检查、构建和 CLI 冒烟测试全部通过。
