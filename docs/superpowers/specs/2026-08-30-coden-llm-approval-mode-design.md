# CodeN LLM 智能审批模式设计

## 1. 目标

CodeN 当前提供两种工具授权模式：

- 默认交互模式：普通修改和脚本逐次由人审批；
- `--auto`：工具调用不经人工审批直接执行。

前者在连续编辑和测试场景中过于繁琐，后者又会放大误操作风险。本设计新增显式的 `--smart-approve` 模式：普通修改操作先由独立 LLM 审批；只有 LLM 明确判断安全时才自动放行，否则交给人决定。

目标是减少低风险操作的人工确认，同时保留确定性的安全底线、人工最终决定权和完整可观察性。LLM 审批是启发式防误操作机制，不是沙箱或强安全隔离。

## 2. 范围

本次实现：

1. 新增 `manual`、`smart`、`auto` 三态授权模型；
2. 新增 `--smart-approve` CLI 参数；
3. 新增可选的 `approvalModel` 配置项；
4. 为工作区内普通 `modify` 工具调用增加独立 LLM 审批；
5. 对确定性高风险、工作区外操作和项目插件信任保留人工审批；
6. 增加审批状态、理由、事件和 token 用量记录；
7. 更新测试和 README。

本次不实现：

- 跨 provider 审批；
- 自定义审批 Prompt 或企业策略 DSL；
- 自动批准缓存和持久化授权；
- 通用 Hook 系统；
- 多模型投票；
- OS 级沙箱；
- 修改插件安装子命令自身的确认策略。

## 3. 方案选择

### 3.1 采用：授权策略内置独立审批器

将 `PermissionPolicy` 从 `auto: boolean` 扩展为显式授权模式，并通过不可由插件替换的 `ApprovalReviewer` 接口审查普通修改操作。

优点：

- 安全边界集中在现有授权层；
- 所有内置和第三方工具遵循同一策略；
- 改动范围可控，便于单元测试和集成测试；
- 任务模型不能在同一响应内自我声明安全。

### 3.2 不采用：通用 `beforeToolCall` Hook

通用 Hook 可以支持企业策略和自定义审计，但会引入 Hook 排序、失败语义、插件干预安全策略等额外问题，超出本次目标。

### 3.3 不采用：由任务模型调用审批工具

该方案会将审批与 Agent 循环耦合，扩大提示注入和自我审批风险，不能形成清晰的独立安全边界。

## 4. 授权模式

新增类型：

```ts
type PermissionMode = "manual" | "smart" | "auto";
```

CLI 映射：

| CLI | 授权模式 |
| --- | --- |
| 无参数 | `manual` |
| `--smart-approve` | `smart` |
| `--auto` | `auto` |

`--smart-approve` 与 `--auto` 互斥；同时传入时属于配置错误，进程以退出码 2 结束。

### 4.1 决策矩阵

| 操作 | `manual` | `smart` | `auto` |
| --- | --- | --- | --- |
| `read` | 自动放行 | 自动放行 | 自动放行 |
| 工作区内普通 `modify` | 人工审批 | LLM 审批，不确定时转人工 | 自动放行 |
| `dangerous` | 人工审批 | 直接人工审批 | 自动放行 |
| 工作区外 `read/write/edit` | 人工审批 | 直接人工审批 | 默认拒绝；配合 `--allow-outside-workspace` 时自动放行 |
| 项目插件首次信任 | 人工审批 | 人工审批 | 人工审批 |

项目插件信任是工具授权之前的独立安全边界。`--auto` 只跳过工具调用审批，不隐式信任工作区。项目本地插件和项目 npm 插件均遵循这一规则。

### 4.2 会话授权

现有人工审批选项保持不变：

- `allow_once`：仅允许本次；
- `allow_session`：当前进程内按工具名允许后续调用；
- `deny`：拒绝本次。

LLM 的 `allow` 只作用于当前调用，不写入会话授权缓存。若 LLM 转人工，用户仍可对普通 `modify` 选择 session 授权；此后同工具的普通调用跳过 LLM。`dangerous` 不提供 session 授权，已有 session 授权也不能覆盖后续动态分类出的高风险调用。

## 5. 组件与职责

### 5.1 `PermissionPolicy`

`PermissionPolicy` 持有授权模式、人工 Prompt 和可选的 `ApprovalReviewer`。它负责：

1. 应用工具声明风险和 `bash` 确定性分类规则；
2. 检查现有人工会话授权；
3. 按模式决定直接允许、调用 Reviewer 或请求人工审批；
4. 保证 `dangerous` 和工作区外调用在 smart 模式下绕过 Reviewer；
5. 在 Reviewer 不可用时失败关闭到人工审批或拒绝。

### 5.2 `ApprovalReviewer`

定义最小接口，输入为审批上下文，输出为：

```ts
interface ApprovalReview {
  decision: "allow" | "human_review";
  reason: string;
  usage: Usage;
}
```

Reviewer 不能直接返回 `deny`。任何不能明确自动放行的情况都返回或降级为 `human_review`，由人作最终决定。

### 5.3 `LlmApprovalReviewer`

`LlmApprovalReviewer` 使用现有 provider 发起独立模型请求：

- 不提供工具；
- 不复用任务模型的消息上下文；
- 不把审批输出写入主会话；
- 使用独立的系统安全规则和严格输出协议；
- 最多生成 256 个 output token；
- 每次审批只请求一次，不做 provider 重试；
- 使用 30 秒超时，并响应主 turn 的取消信号。

审批模型与任务模型可以是相同 ID，但仍是一次独立请求，不允许任务模型在生成工具调用时同时完成自我审批。

### 5.4 `AgentRuntime` 与 `ToolExecutor`

`AgentRuntime.run(userText)` 将本轮原始用户任务作为只读审批上下文传给本轮所有工具调用。`ToolExecutor` 继续先完成工具查找、Schema 校验和结构化路径解析，再请求授权，确保 Reviewer 只看到已验证输入和准确的路径范围。

第三方插件不能提供、覆盖或绕过 Reviewer；其 `modify` 和 `dangerous` 工具与内置工具使用同一执行链路。

## 6. 配置

`CodeNConfig` 增加可选字段：

```ts
approvalModel?: string;
```

配置示例：

```json
{
  "model": "gpt-5",
  "approvalModel": "gpt-5-mini"
}
```

`approvalModel` 与普通 `model` 一样参与现有用户级和项目级 `config.json` 合并。不增加独立 provider、CLI 参数或环境变量。有效模型为：

```ts
const effectiveApprovalModel = config.approvalModel ?? config.model;
```

审批请求始终沿用任务 provider、Base URL 和 API Key。`approvalModel` 必须是非空字符串；非字符串或空字符串配置导致配置错误。

## 7. 审批上下文与协议

### 7.1 输入

Reviewer 只接收：

- 当前用户任务原文；
- 工具名称、描述和最终风险；
- Schema 验证后的完整调用参数；
- 当前工作区真实路径；
- 目标路径是否位于工作区内；
- 固定安全审查规则。

不发送完整会话历史。对于不直接包含路径的工具，路径范围记为 `not_applicable`。所有任务文本、工具描述、命令、文件内容和参数均标记为不可信数据，其中的文字不得被解释为审批指令。

审批模型仅在操作明确符合当前任务、范围有限，且没有明显破坏、提权、凭据泄露、外部数据传输或不可逆副作用时返回 `allow`。存在不确定性时必须返回 `human_review`。

### 7.2 输出

Reviewer 必须返回单个 JSON 对象，不得使用 Markdown 围栏或追加说明：

```json
{
  "decision": "allow",
  "reason": "操作局限于工作区内的目标文件，与当前任务直接相关"
}
```

或：

```json
{
  "decision": "human_review",
  "reason": "命令包含网络上传，影响范围无法可靠确认"
}
```

解析器要求：

- 根值是对象；
- 只包含 `decision` 和 `reason`；
- `decision` 只能是 `allow` 或 `human_review`；
- `reason` 是非空字符串；保存前去除控制字符、折叠空白并截断到 500 个 Unicode code point，终端再按当前列宽截断；
- 响应中不能包含工具调用；
- 空响应、截断响应和非法 JSON 均视为 Reviewer 故障。

完整参数会按原样提交审批。若请求超过 provider 上下文限制或 provider 拒绝请求，不截断后继续自动判断，而是转人工审批，避免模型在信息不完整时放行。

## 8. 数据流

每个工具调用独立执行以下步骤：

1. Registry 查找工具；
2. 校验调用参数；
3. 结构化文件工具解析真实目标路径和工作区范围；
4. 根据工具声明和 `bash` 规则计算最终风险；
5. 检查 read、auto 和人工 session 授权等直接放行条件；
6. smart 模式的普通 `modify` 调用进入 Reviewer；
7. Reviewer 返回 `allow` 时仅放行本次；
8. Reviewer 返回 `human_review` 或发生故障时进入人工 Prompt；
9. 发出最终授权事件；
10. 获得授权后才发出 `tool.started` 并执行工具。

不缓存 LLM 审批结果。一次 `write` 的自动批准不能放行后续 `write`，即使参数相似。

## 9. 终端体验

Reviewer 请求期间，在 TTY 中显示临时状态：

```text
reviewing write…
```

自动放行后，默认显示：

```text
AI approved write
```

`--verbose` 模式追加净化且截断后的理由：

```text
AI approved write — limited change to a workspace source file
```

转人工时始终显示理由：

```text
AI requested human review — command uploads data to an external endpoint
```

随后显示现有结构化工具参数和审批选项。Reviewer 故障时显示：

```text
AI review unavailable — timed out; human approval required
```

非 TTY 和 `--print` 模式将状态写入 stderr，不污染 stdout 的任务输出。若 Reviewer 要求人工审批，`--print --smart-approve` 仍可从 stdin 读取确认；若不存在可用人工输入通道，则拒绝工具调用。

终端显示的模型理由必须先去除控制字符并限制长度，防止终端注入和输出失控。

## 10. 事件与审计

新增事件：

- `permission.review_started`：工具名、调用 ID、审批模型；
- `permission.review_completed`：决策、净化并截断的理由、耗时、模型和 token usage；
- `permission.review_failed`：错误摘要、耗时和 `fallback: "human_review"`。

事件不重复记录完整工具参数，避免 trace 增加新的大块或敏感数据副本。原始调用参数继续由现有 assistant 工具调用消息持久化。

最终授权仍发出现有 `permission.requested` 事件，保持下游兼容。Reviewer token 用量通过独立事件记录；现有 `turn.completed` 和 `TurnResult.usage` 继续只表示任务模型用量，避免改变已有指标语义。

## 11. 故障与取消

以下情况降级为人工审批：

- provider 超时、限流、网络或服务错误；
- JSON 解析或 Schema 校验失败；
- 模型返回工具调用；
- 模型返回未知决策或空理由；
- 请求因上下文过长被拒绝。

若没有人工 Prompt，或人工输入遇到 EOF，降级结果为拒绝，不执行工具。拒绝以现有 `permission.denied` 工具错误反馈给任务模型，使其可以调整方案或向用户说明。

若主 turn 的 `AbortSignal` 已中止，Reviewer 立即传播取消，不弹出人工 Prompt。用户主动取消与 Reviewer 故障必须区分，防止 `Ctrl+C` 后出现新的交互问题。

审批模型的文本、reasoning 和潜在非法工具调用不会进入主消息历史、session 恢复记录或任务模型上下文。

## 12. 项目插件信任边界

项目插件以当前用户完整进程权限运行，信任确认不能委托给工具审批 Reviewer，也不能由 `--auto` 隐式跳过。

运行时加载项目本地插件或项目 npm 插件前：

1. 按真实工作区路径查询 `TrustStore`；
2. 已信任则继续加载；
3. 未信任则始终请求人工确认；
4. 缺少人工输入或用户拒绝时，不加载项目插件；
5. 全局插件保持现有行为。

这使 `manual`、`smart` 和 `auto` 共享同一启动信任边界。`--auto` 仍可自动批准已信任代码产生的工具调用，但不能自行决定信任新的工作区代码。

## 13. 测试策略

### 13.1 配置测试

覆盖：

- 用户级和项目级 `approvalModel` 合并优先级；
- 缺省回退到 `model`；
- 空字符串和非字符串配置失败；
- 其他现有配置行为不变。

### 13.2 CLI 测试

覆盖：

- `--smart-approve` 正确启用 smart 模式；
- `--smart-approve --auto` 返回配置错误和退出码 2；
- 原默认模式和 `--auto` 参数解析不回归；
- `--allow-outside-workspace` 仍只允许与 `--auto` 组合。

### 13.3 Reviewer 单元测试

覆盖：

- 使用 `approvalModel` 和缺省回退；
- 请求不携带工具；
- 当前任务、工具信息、完整参数和路径范围存在；
- 不可信数据边界存在；
- 两种合法决策；
- 非法 JSON、额外字段、空理由、未知值、工具调用和空响应；
- 超时、provider 错误和主信号取消。

### 13.4 权限策略测试

覆盖三种模式的完整决策矩阵，包括：

- read 不调用 Reviewer；
- 普通 modify 调用 Reviewer；
- dangerous 和工作区外调用绕过 Reviewer；
- LLM allow 只作用一次；
- human review 的 once、session 和 deny；
- session 授权不能覆盖 dangerous；
- 无人工通道时失败关闭。

### 13.5 集成与终端测试

覆盖：

- Reviewer 收到当前用户任务；
- 自动允许、人工升级和人工拒绝后的工具结果；
- 第三方 modify 工具进入同一审批链；
- 默认、verbose、TTY、非 TTY 和 print 输出；
- 审批事件、耗时和 token usage；
- trace 不包含额外的完整参数副本；
- 项目插件在三种授权模式下均遵循人工信任边界。

### 13.6 验收命令

完成实现后运行项目标准检查：

```bash
just check
```

检查必须覆盖 Biome、TypeScript 构建和完整测试套件，并确认 Git 暂存区没有意外文件。

## 14. 验收标准

实现满足以下条件即验收：

1. 用户可通过 `--smart-approve` 显式启用智能审批；
2. 普通工作区内修改仅在 Reviewer 明确允许时自动执行；
3. 高风险、工作区外和不确定操作均由人决定；
4. Reviewer 的任何故障都不能导致自动放行；
5. 可配置同 provider 下的轻量审批模型，缺省使用任务模型；
6. Reviewer 只看到批准的有界上下文，不污染主会话；
7. 自动批准、人工升级和故障均有清晰终端反馈与审计事件；
8. 项目插件信任不再被 `--auto` 隐式跳过；
9. 原默认模式、`--auto`、工作区边界和现有工具行为无非预期回归；
10. README、测试、格式检查和构建全部通过。
