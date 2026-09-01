# Web 对话记录多步骤排序修复设计

## 背景

Web UI 偶尔把最终 assistant 消息显示在 tool call 或 thinking 卡片上方。浏览器端没有排序逻辑：`src/webui/src/state.ts` 按 patch 顺序追加或原位更新 block，`src/webui/src/components/transcript.tsx` 直接按数组顺序渲染。问题来自 `src/web/store.ts` 对同一 turn 内多个 provider step 的 block 生命周期建模错误。

Agent 的一个 turn 可以包含多个 provider step。例如模型先输出文字并调用工具，工具完成后再发起下一次 provider 请求输出最终答案。每次请求都会发出 `provider.started`。

当前 WebStore 在整个 turn 内复用 `#activeAssistantId`，使第二个 provider step 的最终文字更新工具之前的 assistant block，而不是在工具之后追加新 block。thinking block 还固定使用 `thinking-${turnId}`，多个 step 会产生重复 ID，导致服务端索引、浏览器 reducer 与 React key 对同一 block 的识别不一致。

## 目标

- 按真实运行顺序展示同一 turn 内各 provider step 的 thinking、assistant 和 tool block。
- 保证 transcript 中每个动态 thinking/assistant block 的 ID 唯一。
- provider retry 只移除当前失败 attempt 的临时 assistant/thinking block，不影响之前已经完成的 step。
- 不修改 Web 协议结构，不在浏览器端增加排序或补偿逻辑。

## 设计

### Provider step 边界

`provider.started` 是新的 provider attempt/step 边界。WebStore 收到该事件时：

1. 结束异常遗留的 active thinking block；
2. 清空 active assistant 与 active thinking 指针；
3. 保持之前 step 已追加的 block 原位不变；
4. 将状态切换为 thinking/running。

后续第一个 `provider.delta` 必须追加新的 assistant block，之后同一 step 的 delta 才更新该 block。

### 唯一 block ID

新 thinking/assistant block 的展示 ID 除 turn ID 外还必须包含一个单调递增的本地序号。序号只用于展示身份，不改变 runtime 的 turn ID 或 provider tool call ID。

WebStore 通过内部 ID 生成器为每次新 block 分配唯一 ID。这样同一 turn 的第二段 thinking 不会覆盖第一段的索引，也不会向 React 提供重复 key。

### Retry 行为

`provider.retry` 沿用现有语义：移除当前 active assistant 和 thinking block。由于 `provider.started` 已建立 step/attempt 边界，active 指针只指向当前 attempt，不会误删之前成功完成的 assistant block。

### 明确不做

- 不改变 `WebBlock`、SSE patch 或 protocol version。
- 不在 Web UI 中按时间戳重新排序。
- 不处理与本缺陷无直接证据关联的 SSE recovery 并发问题。
- 不扩大为 tool call ID 全局唯一性重构；本修复只解决已确认的 provider step 生命周期与 thinking/assistant ID 问题。

## 数据流示例

事件：

```text
turn.started
provider.started
provider.reasoning_delta
provider.delta
provider.tool_call_start
tool.started
tool.completed
tool.result
provider.started
provider.reasoning_delta
provider.delta
turn.completed
```

预期 block 顺序：

```text
user → thinking₁ → assistant₁ → tool → thinking₂ → assistant₂
```

第二个 provider step 的 delta 只更新 `assistant₂`。

## 测试

在 `test/web-store.test.ts` 增加回归覆盖：

1. 模拟“首段文字 → 工具 → 次段 thinking → 最终答案”的完整多 step 事件序列，断言 block 顺序与内容。
2. 断言所有 block ID 唯一。
3. 连续发送第二段 thinking delta，确认更新第二个 thinking block而非第一个。
4. 模拟后续 provider attempt retry，确认只删除当前 attempt 的临时 block，保留之前完成的 assistant/tool block。

完成后运行 WebStore 定向测试、Web UI check、根目录相关测试与格式检查。