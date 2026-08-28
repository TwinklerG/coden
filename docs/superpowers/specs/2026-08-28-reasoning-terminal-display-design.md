# Reasoning 终端展示设计

日期：2026-08-28

## 1. 背景

OpenAI-compatible 模型可能在流式响应的 `delta.reasoning_content`
字段中返回思考内容。当前 provider 只处理 `delta.content` 和工具调用，
因此 thinking spinner 期间的 reasoning 不会显示。

本改动让 TTY 用户在等待正式回答时看到简短的实时 reasoning 状态，并在正式回答开始后将其折叠为耗时提示。Reasoning 不属于最终回答，不得进入会话历史、模型上下文或非交互管道输出。

## 2. 目标与非目标

### 2.1 目标

- 在 TTY 中以灰色临时单行实时展示 `reasoning_content`；
- 从 `provider.started` 到首个正式 content 计算耗时；
- 首个正式 content 到达时，将临时 reasoning 清除并折叠为灰色 `thought for 3.2s`；
- 正式 content 开始后，忽略后续 reasoning 的界面更新；
- 保持正式文本流、重试语义和非 TTY 输出稳定；
- 通过独立事件表达 reasoning，避免与正式文本混淆。

### 2.2 非目标

- 持久化、回放或展开完整 reasoning；
- 将 reasoning 加入 assistant 消息或上下文；
- 为 reasoning 展示增加用户配置项；
- 为 Anthropic thinking block 增加支持；
- 在非 TTY 或管道输出中打印 reasoning。

## 3. 方案选择

采用独立的 reasoning 事件链：

```text
OpenAI delta.reasoning_content
  → ModelEvent.reasoning_delta
  → RuntimeEvent provider.reasoning_delta
  → TerminalRenderer 临时状态行
```

不复用 `provider.delta`，因为现有语义是可写入最终回复的正式文本；
混用会增加 reasoning 泄漏到 stdout、会话历史或重试缓冲区的风险。
Provider 也不直接操作终端，以保持 provider、runtime 与 observability 的边界。

## 4. 数据模型与处理流程

### 4.1 Provider 层

`ModelEvent` 增加：

```ts
{ type: "reasoning_delta"; text: string }
```

`OpenAICompatibleProvider` 读取流式 chunk 的
`delta.reasoning_content`。由于 OpenAI SDK 的标准类型可能未声明
OpenAI-compatible 扩展字段，读取处使用最小局部类型扩展，
不扩大公共 provider 类型，也不使用 `any`。

非空 reasoning 增量转换为 `reasoning_delta`。现有 `content`、tool call、usage 和 done 行为不变。

### 4.2 Runtime 层

`accumulateStream` 接受独立的 reasoning 回调。收到 `reasoning_delta` 时只调用该回调，不追加到返回值中的 `text`。

`requestWithRetry` 将 reasoning 回调转发为：

```text
provider.reasoning_delta { text }
```

因此 reasoning 不会进入最终 assistant message、会话存储、上下文压缩输入或正式文本的非 TTY 重试缓冲区。

### 4.3 TerminalRenderer 层

每次 `provider.started` 建立独立 attempt 状态：

- 记录开始时间；
- 标记尚未收到正式 content；
- 清空临时 reasoning 文本；
- 启动现有 spinner。

收到 `provider.reasoning_delta` 时，仅在 TTY 且尚未收到正式 content 的情况下更新临时行：

- reasoning 增量按流式顺序累计；
- 换行和连续空白压缩为单个空格；
- 终端当前行先清除再重绘；
- 使用 dim/灰色样式；
- 文本按可用终端列宽截断，确保只占一行；
- spinner 继续提供活动反馈，临时行展示最新可见 reasoning 尾部。

收到本 attempt 的首个非空 `provider.delta` 时：

1. 停止并清除 spinner/reasoning 临时行；
2. 若曾收到 reasoning，向 stderr 写入一行 dim 样式的 `thought for <duration>s`；
3. 标记正式 content 已开始；
4. 将正式文本按现有逻辑写入 stdout；
5. 忽略该 attempt 后续的 reasoning UI 更新。

耗时从 `provider.started` 计算到首个正式 content，显示一位小数秒，例如 `thought for 3.2s`。

`provider.retry`、`provider.completed`、`turn.failed`、`tool.started`
和 `dispose()` 都清除活动临时行及 attempt 状态。若 attempt 没有正式
content（例如直接产生工具调用），不输出折叠耗时提示。

## 5. TTY 与非 TTY 行为

### 5.1 TTY

Reasoning 只作为 stderr 上的临时状态，正式 content 仍写 stdout。折叠后的 `thought for …` 也写 stderr，因此不会混入回答正文。

### 5.2 非 TTY

忽略 `provider.reasoning_delta`，不写 stdout 或 stderr。现有 verbose 状态、正式文本成功后刷新、失败重试丢弃部分文本等行为保持不变。

## 6. 错误与边界情况

- 空 reasoning 增量不改变界面；
- reasoning 中的换行、制表符和重复空格统一压缩，防止破坏终端布局；
- reasoning 晚于正式 content 到达时忽略；
- 重试开始前清除失败 attempt 的 reasoning，不为失败 attempt 输出 `thought for …`；
- provider 在 reasoning 后直接完成或请求工具时，只清除临时状态，不留下错误耗时提示；
- 无法取得可靠终端宽度时使用保守默认宽度；
- ANSI 样式不参与可见宽度计算。

## 7. 测试

新增或扩展测试覆盖：

1. OpenAI-compatible chunk 的 `reasoning_content` 被映射为 `reasoning_delta`；
2. `accumulateStream` 分别回调 reasoning 和正式文本，最终 `text` 只包含正式 content；
3. TTY 收到 reasoning 后替换 spinner 为灰色单行状态；
4. 首个正式 content 清除临时行并输出 `thought for <duration>s`；
5. 正式 content 开始后的 reasoning 不再改变终端输出；
6. retry、failure、completion、tool start 和 dispose 清理临时状态；
7. 非 TTY stdout/stderr 不包含 reasoning，现有稳定输出与重试缓冲行为不变。

使用 fake timers 或可控时间推进验证耗时格式，避免依赖真实等待造成测试不稳定。

## 8. 验收标准

- 支持 `reasoning_content` 的 OpenAI-compatible 模型在 TTY thinking 阶段显示灰色临时 reasoning；
- 正式 content 开始时只留下灰色 `thought for x.xs`，之后 reasoning 不再更新；
- 最终 assistant 文本、会话记录和管道 stdout 中均不包含 reasoning；
- 不支持 reasoning 的模型表现与当前一致；
- lint、typecheck 和离线测试全部通过。
