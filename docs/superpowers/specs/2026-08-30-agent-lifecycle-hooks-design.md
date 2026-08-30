# CodeN Agent 生命周期 Hooks 设计

## 背景与目标

CodeN 需要提供与 Claude Code 等主流编程智能体语义相近的生命周期 Hook。Hook 是 Agent Loop 的正式扩展点，而不是独立的通知模块。macOS 弹窗、系统音效或蜂鸣只是命令 Hook 的消费方式之一。

首版目标如下：

1. 在会话、用户输入、工具调用、权限确认、通知和停止等核心阶段提供稳定 Hook；
2. 支持外部命令 Hook，通过 stdin/stdout JSON 和退出码通信；
3. 允许受控 Hook 阻止流程、修改工具输入、追加上下文或作出权限决定；
4. 使用 Claude Code 风格的事件名、matcher 和协议语义，但不承诺配置文件可直接复制；
5. 用户级与受信任项目级 Hook 可以共同生效；
6. Hook 不能突破工作区路径、安全规则或工作区信任边界；
7. 命令失败默认不阻断 Agent Loop，只有明确决策才能阻止操作；
8. 支持通过 `PermissionRequest` 或 `Notification` 触发 macOS 通知和声音。

## 非目标

首版不提供：

- HTTP、Prompt、Agent 或 TypeScript 插件回调类型 Hook；
- Claude Code 配置文件的直接导入；
- 子 Agent、模型切换、压缩前后等 CodeN 尚未稳定支持的事件；
- Hook 热重载，配置变更需要重启 CodeN；
- Hook 沙箱或操作系统级权限隔离；
- 内置的 macOS、Windows 或 Linux 通知 API；
- 通用 Agent 中间件系统或 Agent Loop 的整体重写。

## 总体架构

新增独立 Hook 子系统：

```text
src/hooks/
├── types.ts          # 事件输入、Hook 输出、聚合结果
├── config.ts         # 配置校验、作用域和 matcher 编译
├── command-runner.ts # 子进程、JSON I/O、超时和退出码
└── engine.ts         # 匹配、并行调度和决策合并
```

HookEngine 通过显式调用嵌入生命周期控制点：

```text
CLI composition
  ├─ 加载用户 Hook
  ├─ 检查工作区信任后加载项目 Hook
  └─ 构造 HookEngine
          │
AgentRuntime ───── SessionStart / UserPromptSubmit / Stop / SessionEnd
ToolExecutor ───── PreToolUse / PostToolUse / PostToolUseFailure
PermissionPolicy ─ PermissionRequest
CLI input layer ── Notification
```

各组件职责如下：

- `HookEngine` 执行 Hook，并返回允许、阻止、修改输入或附加上下文等类型化结果；
- `EventBus` 继续只负责 trace、终端显示和可观测性，不参与 Hook 决策；
- `AgentRuntime` 决定提示词是否提交、模型循环是否继续以及 Turn 何时结束；
- `ToolExecutor` 负责工具前后 Hook、参数重校验、风险分类和路径安全检查；
- `PermissionPolicy` 分离“是否需要授权”和“获取授权决定”，使 PermissionRequest Hook 位于真正的人机确认之前；
- CLI 负责配置来源、工作区信任、会话级 Hook 和需要用户关注的 Notification。

HookEngine 可以在未来增加其他 Handler，但首版只实例化命令 Handler。现有 EventBus 不能直接承担 Hook，因为它面向观测、并行广播且没有结构化决策返回值。

## 生命周期事件

首版支持以下 PascalCase 事件：

| 事件 | 触发位置 | 可返回的控制结果 |
| --- | --- | --- |
| `SessionStart` | Runtime 构造完成、首次用户输入之前；启动或恢复各触发一次 | 追加会话上下文 |
| `UserPromptSubmit` | 用户输入持久化、发送给模型之前 | 允许、阻止、追加上下文 |
| `PreToolUse` | 原始参数通过 Schema 校验之后、权限与执行之前 | 允许、阻止、要求确认、修改输入、追加上下文 |
| `PermissionRequest` | 确认需要人工授权之后、显示终端问题之前 | `allow`、`deny`、`ask` |
| `PostToolUse` | 工具成功返回之后 | 仅观察 |
| `PostToolUseFailure` | 工具拒绝、超时或执行失败之后 | 仅观察 |
| `Notification` | CodeN 即将等待用户关注时 | 仅观察 |
| `Stop` | 模型返回无工具调用的最终回复、`turn.completed` 之前 | 允许停止，或携带原因要求继续 Agent Loop |
| `SessionEnd` | CLI 会话退出时 | 仅观察 |

`SessionStart` 每次 CLI 启动或恢复只触发一次；REPL 中 `/new` 只重置当前对话，不创建新的 CLI 会话，因此不再次触发。`SessionEnd` 在成功、失败、取消、EOF、`/quit` 等退出路径中 best-effort 触发，并携带退出原因。

`Notification` 首版至少定义：

- `permission_prompt`：即将显示人工授权问题；
- `attention_required`：Turn 失败或发生必须由用户处理的情况。

后续可以增加 `idle_prompt` 等通知类型，不改变命令协议。

## 公共输入协议

每次命令调用的 stdin 是单个 JSON 对象，包含公共字段：

```json
{
  "schemaVersion": 1,
  "hookEventName": "PermissionRequest",
  "sessionId": "session-id",
  "turnId": "turn-id",
  "cwd": "/absolute/workspace",
  "permissionMode": "default"
}
```

事件再附加专属字段：

- `SessionStart`：`source`，取 `startup` 或 `resume`；
- `UserPromptSubmit`：完整 `prompt`；
- `PreToolUse`：工具名、call ID、完整输入和初始风险；
- `PermissionRequest`：工具名、call ID、完整输入、最终风险和请求原因；
- `PostToolUse`：工具名、call ID、最终输入、结果和持续时间；
- `PostToolUseFailure`：工具名、call ID、最终输入、错误类型、错误文本和持续时间；
- `Notification`：`notificationType`、标题和消息；
- `Stop`：最终回复、工具执行数量和 `stopHookActive`；
- `SessionEnd`：退出原因。

Hook 属于用户安装或已信任项目中的代码，因此可以接收完整提示词、工具参数和相关结果。stdin 序列化结果仍设置 1 MiB 上限，超过上限时该 Hook 记为失败并按 fail-open 处理。工具结果继续遵循现有截断上限。

## 工具与权限数据流

工具调用顺序固定为：

```text
模型生成 ToolCall
  → 查找工具并执行初次 Schema 校验
  → PreToolUse
  → 合并决策和可选 updatedInput
  → 对最终输入重新执行 Schema 校验
  → 重新执行风险分类、真实路径解析和工作区限制
  → 判断是否需要普通授权
  → PermissionRequest Hook
      ├─ allow：跳过终端确认
      ├─ deny：返回拒绝工具结果
      └─ ask：触发 Notification(permission_prompt)，然后显示终端确认
  → 执行工具
  → PostToolUse 或 PostToolUseFailure
```

只有通过初次 Schema 校验的模型工具调用才进入 `PreToolUse`。如果一个 Hook 返回 `updatedInput`，最终输入必须重新通过 Schema 校验、Bash 风险分类、结构化文件真实路径解析和工作区规则。修改后的输入无效时，工具以明确的 Hook 输入错误结束，不回退执行原始输入。

`PreToolUse` 的 `allow` 可以跳过普通逐次授权，`ask` 可以强制进入人工授权，`deny` 阻止工具。三者都不能：

- 建立工作区信任；
- 覆盖显式 deny 安全规则；
- 绕过结构化文件路径限制；
- 绕过修改后参数的 Schema 校验；
- 改变不由 PermissionPolicy 管理的硬失败。

`--auto` 下仍执行 `PreToolUse`，且 `deny` 仍然有效。`--auto` 不进入人工 PermissionRequest 流程；如果 `PreToolUse` 返回 `ask`，该工具调用被安全拒绝，不重新开启交互提示。普通 `--auto` 下工作区外结构化文件操作仍被拒绝，只有显式的 `--auto --allow-outside-workspace` 可以通过现有边界。

`PermissionRequest` 只在调用实际需要逐次确认或被 `PreToolUse` 强制要求确认时触发。其 `allow` 或 `deny` 可以替代终端选择，`ask` 或无决定继续显示终端问题。

## 用户输入、上下文和停止行为

`UserPromptSubmit` 在用户文本写入会话和首次模型请求之前运行。明确阻止时，文本不写入会话、不用于会话标题，也不请求模型。Hook 返回的附加上下文必须与原始用户输入区分，并以可恢复的 Hook 上下文记录持久化；终端恢复历史不能把它伪装成用户输入。

`SessionStart` 附加上下文作为会话级 Hook 上下文加入系统指导。`UserPromptSubmit` 和 `PreToolUse` 的附加上下文进入当前 Agent Loop，并保留在后续模型请求所需的会话状态中。实现需要使用显式 Hook 上下文记录或等价内部表示，不能通过不可辨识地拼接原始用户文本实现。

当模型返回不含工具调用的回复时，Runtime 先调用 `Stop`：

- 无阻止决定时，发出 `turn.completed` 并返回；
- 返回 `decision: "block"` 时，把 `reason` 作为明确标记的 Hook 反馈加入模型上下文，并继续下一模型步骤；
- `stopHookActive` 告诉 Hook 当前循环是否由先前 Stop Hook 引起；
- 继续过程仍消耗 Agent step 并受 `maxSteps` 限制，不能无限绕过上限。

## 配置格式

用户配置位于 `~/.config/coden/config.json`，项目配置位于 `<workspace>/.coden/config.json`。示例：

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "bash|edit|write",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"CodeN 正在等待授权\" with title \"CodeN\"'; afplay /System/Library/Sounds/Glass.aiff",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

配置规则：

- `hooks` 的键必须是受支持事件；
- `matcher` 是区分大小写的正则表达式；省略或写 `"*"` 表示全部匹配；
- 工具事件匹配工具名；
- `Notification` 匹配通知类型；
- `SessionStart` 匹配启动来源；
- 不具备匹配目标的事件只接受省略 matcher 或 `"*"`；
- Hook 项首版只接受 `type: "command"`；
- `command` 必须是非空字符串；
- `timeout` 单位为秒，省略时为 10 秒，允许范围为 1–600 秒；
- 单次事件最多匹配 64 个命令；
- 未知字段、无效正则、非法事件或非法限制在启动阶段形成配置错误，不静默忽略。

用户级和项目级 Hook 采用追加合并：项目配置不能覆盖、删除或重排用户 Hook。配置顺序只用于稳定标识、诊断和附加上下文排序；所有匹配命令仍然并行执行。

## matcher 语义

事件的匹配目标如下：

| 事件 | matcher 目标 |
| --- | --- |
| `PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure` | 工具名 |
| `Notification` | 通知类型 |
| `SessionStart` | `startup` 或 `resume` |
| 其他事件 | 无独立目标，只允许省略或 `*` |

正则按完整配置原样编译，匹配行为区分大小写。非法表达式在启动阶段拒绝配置。首版不提供 glob、否定 matcher 或多字段表达式。

## 命令执行

命令 Handler 使用系统 shell 执行静态 `command`，工作目录固定为当前工作区。事件字段只通过 stdin JSON 传入，不插值到命令字符串中。

子进程继承当前环境，并增加：

- `CODEN_PROJECT_DIR`；
- `CODEN_SESSION_ID`；
- `CODEN_HOOK_EVENT`。

stdout 只用于协议 JSON；stderr 用于诊断以及退出码 `2` 的阻止原因。stdout 和 stderr 各自上限为 10 KiB。超时、Agent 取消或 CLI 退出时终止整个子进程组，避免遗留 shell、`osascript` 或孙进程。

退出规则：

- 退出码 `0`：成功，解析可选 stdout JSON；
- 退出码 `2`：在可控制事件中明确阻止，原因来自 stderr；
- 其他非零退出码：警告并继续；
- 启动失败、超时、无效 JSON 或输出超限：警告并继续；
- 在 `PostToolUse`、`PostToolUseFailure`、`Notification`、`SessionEnd` 等只观察事件中，退出码 `2` 只能产生警告，不能撤销已经发生的行为。

## 输出协议

成功 Hook 可以不输出内容，或输出单个 JSON 对象。公共可选字段包括 `systemMessage`；它只显示给用户，不发送给模型。

`SessionStart`、`UserPromptSubmit` 和 `PreToolUse` 可以在 `hookSpecificOutput` 中返回 `additionalContext`。`PreToolUse` 示例：

```json
{
  "systemMessage": "使用本地工具策略",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "符合团队策略",
    "updatedInput": {
      "command": "just test"
    },
    "additionalContext": "测试必须通过 Just 运行"
  }
}
```

`permissionDecision` 可取 `allow`、`ask` 或 `deny`。`PermissionRequest` 使用：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "message": "由本地安全策略批准"
    }
  }
}
```

`behavior` 可取 `allow`、`ask` 或 `deny`。`Stop` 使用顶层决定：

```json
{
  "decision": "block",
  "reason": "测试尚未运行，请继续完成验证"
}
```

事件不支持的控制字段视为无效协议输出。无效协议按 Hook 失败处理并 fail-open，不尝试猜测用户意图。

## 并行执行和合并

所有匹配命令并行启动并全部等待结束。一个 Hook 的拒绝不会取消已经启动的兄弟 Hook。

结果合并规则：

1. 权限决定按 `deny > ask > allow > 无决定` 合并；
2. 任一明确阻止足以阻止当前动作；
3. `additionalContext` 按用户级配置顺序、项目级配置顺序稳定拼接，不按进程完成顺序排列；
4. 只有一个 Hook 返回 `updatedInput` 时采用该修改；
5. 多个 Hook 返回 `updatedInput` 时，所有修改作废，继续使用原始输入并报告冲突；
6. 输入冲突不抹除其他 Hook 的拒绝、确认或附加上下文决定；
7. 多条 `systemMessage` 按配置顺序写入 stderr；
8. 聚合附加上下文设总大小上限，超出部分按配置顺序截断并给出警告。

这保留主流 Agent 并行 Hook 的低延迟，同时避免“最后完成者覆盖输入”造成不确定行为。

## 工作区信任

项目 Hook 可以执行任意 shell 命令，因此只有工作区真实路径已显式信任后才能执行。用户级 Hook 视为用户主动配置，不重复询问。

信任规则：

1. 项目配置可以先被解析以判断是否包含 Hook，但解析本身不能执行命令；
2. 检测到项目 Hook 或项目插件且工作区未信任时，启动阶段明确展示风险并请求确认；
3. 同意后通过现有 `TrustStore` 按 `realpath` 持久化，文件权限保持 `0600`；
4. 拒绝后跳过所有项目 Hook 和项目插件，用户级 Hook 与内置工具继续可用；
5. `--auto` 不能建立或暗示工作区信任；它只影响工作区已信任后的 Agent Loop 逐次授权。

Hook 与项目插件共享同一工作区信任记录。实现本设计时必须同步移除当前本地及 npm 项目插件对 `--auto` 的信任绕过，并更新 README 中“`--auto` 跳过项目插件确认”的旧描述，使所有可执行项目扩展遵循同一边界。

## 安全模型

命令 Hook 不是沙箱。它拥有 CodeN 用户的进程权限，可以访问：

- 文件系统和网络；
- CodeN 进程环境变量，包括 API Key；
- 完整用户提示词、工具参数以及事件携带的工具结果；
- 当前工作区中的任意可信数据。

首次信任提示和 README 必须明确这些能力。Hook 输出不能绕过工具 Schema、真实路径、工作区硬限制和显式 deny。终端展示的 Hook 消息、stderr 和阻止原因必须清除 ANSI 控制序列及不可见控制字符，防止终端注入。

## 可观测性

HookEngine 向 EventBus 发出：

```text
hook.started
hook.completed
hook.failed
hook.blocked
hook.input_conflict
```

trace 只记录：

- Hook 事件名、配置作用域和稳定配置序号；
- 持续时间、退出码和是否超时；
- 是否返回决定、附加上下文或输入修改。

trace 不记录完整 stdin、stdout、stderr、工具参数、附加上下文、修改后参数或 Hook 返回的敏感消息。普通成功只在 `--verbose` 下显示；失败、阻止和输入冲突始终显示。

## 故障处理

命令失败默认 fail-open，避免通知脚本、系统服务或用户配置故障卡住 Agent。只有以下结果可以改变控制流：

- 可控制事件中的退出码 `2`；
- 通过验证的显式 JSON 阻止或权限决定；
- 通过验证的单一工具输入修改；
- 通过验证的 Stop block。

`SessionEnd` 永远 best-effort，失败不能改变 CodeN 原始退出状态。HookEngine 自身的内部异常必须转换为 `hook.failed` 和终端警告，不能导致未捕获异常逃出 Agent Loop；Agent 已取消时除外，此时应尽快中止 Hook 子进程并保留原始取消语义。

## 测试策略

### 配置和 matcher

覆盖：

- 用户级与项目级追加合并；
- 配置来源和稳定序号；
- 合法及非法事件、字段、正则、timeout 和数量限制；
- 工具名、通知类型和启动来源匹配；
- 无匹配目标事件拒绝具体 matcher；
- 未信任项目 Hook 被跳过；
- `--auto` 不自动建立工作区信任。

### CommandRunner

覆盖：

- 工作目录、环境变量和 stdin JSON；
- 空 stdout、合法 JSON和非法 JSON；
- 退出码 `0`、`2` 和其他非零；
- stdout/stderr/输入大小上限；
- 超时、AbortSignal 和子进程组清理。

### HookEngine

覆盖：

- 匹配 Hook 并行执行；
- `deny > ask > allow`；
- 附加上下文按配置顺序合并；
- 单一输入修改；
- 多输入修改冲突、原始输入回退和冲突事件；
- 观察事件不能改变已发生行为；
- trace 不含敏感 Hook 内容。

### Agent Runtime 集成

覆盖：

- 九个生命周期事件的触发位置与顺序；
- `UserPromptSubmit` 阻止时不持久化、不设置标题、不请求模型；
- Hook 上下文的模型可见性、持久化和恢复；
- 修改后的工具输入重新执行 Schema、风险和真实路径校验；
- Hook 无法突破工作区边界或显式 deny；
- PermissionRequest 的 allow、deny 和 ask；
- `--auto` 下 PreToolUse 仍执行，ask 安全拒绝；
- PostToolUse 与 PostToolUseFailure 精确二选一；
- Stop 阻止后继续模型循环并受 `maxSteps` 限制；
- 成功、失败、取消和正常退出均 best-effort 触发 SessionEnd。

### 人工验收

在 macOS 上配置通知和声音 Hook，触发 Bash 审批，确认：

1. 终端授权问题出现前收到系统通知和声音；
2. Hook 能通过 JSON 决定批准或拒绝；
3. 通知脚本失败或超时不会卡住 Agent；
4. 修改项目 Hook 后，未信任工作区不会执行命令；
5. `--verbose` 能定位 Hook，普通 trace 不泄露完整参数或输出。

最终执行 `just check`、`just build` 和 `git diff --check`。构建后的 Node CLI 不能依赖 Bun 专有 API。

## 文档更新

README 增加：

- 生命周期事件表和触发顺序；
- 输入输出协议与 matcher 规则；
- 用户级和项目级配置示例；
- macOS 通知、声音、自动批准和阻止示例；
- 工作区信任、敏感数据、环境变量和非沙箱警告；
- `--auto` 与 Hook、项目插件信任的准确关系；
- 超时、退出码、冲突和 `--verbose` 故障排查说明。
