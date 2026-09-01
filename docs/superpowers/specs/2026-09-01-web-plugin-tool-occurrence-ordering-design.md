# Web 第三方插件工具调用排序修复设计

## 背景

此前的 Web transcript 修复以 `provider.started` 建立 assistant/thinking 的 provider step 边界，但没有修复 tool block 将 provider `callId` 当作全局展示身份的问题。

第三方插件工具加载后与内置工具共用 `ToolExecutor` 和 runtime 事件流。差异通常来自上游 provider：部分 OpenAI 兼容服务不返回稳定工具调用 ID，`src/providers/openai.ts` 会按调用索引回退为 `call_0`、`call_1`。该索引会在后续 provider step 或 turn 中重新开始，因此 `callId` 不保证在 transcript 或 session 范围内唯一。

`WebStore` 当前使用 `tool-${callId}` 作为 block ID，并长期通过 `#toolBlocks` 将 `callId` 映射到该 block。重复 `call_0` 会更新历史位置的工具卡片，而不是在当前事件位置追加新卡片。恢复消息时同样会产生重复 block ID 和 React key。

## 目标

- 将每次工具调用显示为独立、按事件顺序追加的 transcript block。
- 允许 provider 在同一 turn 的不同 step 或不同 turn 中重复使用 `callId`。
- 后续 `tool.started`、`tool.completed`、`tool.result` 仍更新正确的当前调用实例。
- 恢复会话时保持重复 `callId` 工具调用的原始顺序并保证 block ID 唯一。
- 不修改 Web 协议版本，不在浏览器端重新排序。

## 设计

### 展示身份与协议身份分离

`WebBlock.callId` 继续保留 provider/runtime 的调用身份，用于诊断和事件关联；`WebBlock.id` 改为 WebStore 分配的调用实例身份。动态 tool block 与 assistant/thinking 一样使用内部单调序号，例如：

```text
tool-call_0-3
tool-call_0-7
```

两次调用可拥有相同 `callId`，但必须拥有不同 `id`。

### 实时事件关联

收到 `provider.tool_call_start` 时总是创建新的 tool block，不再因 `#toolBlocks` 已包含 `callId` 而跳过。随后将该 `callId` 映射到最新创建的 block，以便本次调用的 `tool.started/completed/result` 更新它。

如果 WebStore 收到没有对应 preview block 的工具执行事件，`upsertTool` 创建新的唯一 tool block，并建立映射。这样仍兼容直接执行测试、失败路径或缺少 provider preview 的事件源。

当前 runtime 在 provider stream 完成后顺序执行工具；不同 provider step 的新 `provider.tool_call_start` 出现在前一 step 工具结果之后，因此“同 callId 映射到最新实例”可正确覆盖实际重复 ID 场景。

### 会话恢复

`setRecoveredMessages` 为每个 assistant tool call 创建唯一展示 ID，并用 `callId` 暂存最近尚待结果补全的调用实例。对应 tool result 修改该实例的状态和输出。之后再次出现相同 `callId` 时创建新实例，而不是复用先前 block ID。

孤立 tool result 同样分配唯一展示 ID。

## 不采用的方案

- **每个 turn 清空映射：** 无法处理同一 turn 多 provider step 中重复的 `call_0`。
- **使用 turn ID 拼接 callId：** 同一 turn 内仍可能冲突。
- **浏览器端排序或去重：** 无法判断两个相同 `callId` 是同一调用的更新还是两个独立实例，并会掩盖服务端权威状态错误。

## 测试

在 `test/web-store.test.ts` 增加：

1. 同一 turn 的两个 provider step 都调用第三方插件工具且都使用 `call_0`，断言生成两个独立 tool block并位于各自 assistant/thinking 之后。
2. 两个 tool block 的 ID 不同，第二次 `tool.result` 只更新第二个实例。
3. 跨 turn 重复 `call_0` 仍追加新工具卡片。
4. 恢复消息包含两次重复 `call_0` 时顺序、内容和 ID 唯一。

验证运行 WebStore 定向测试、Web 定向测试、Web UI check 和完整 `just check`。