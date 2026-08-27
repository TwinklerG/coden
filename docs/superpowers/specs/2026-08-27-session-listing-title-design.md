# CodeN 会话列表与会话标题设计

日期：2026-08-27

## 1. 背景与目标

CodeN 目前支持会话持久化与 `--resume <session-id>` 恢复，但存在两个缺口：

1. **没有列出会话的能力**：`SessionStore` 没有 `list()` 方法，CLI 也无相关标志，用户无法知道当前工作区有哪些可恢复的会话。
2. **恢复后与新建无法区分**：`recover()` 只把历史消息注入 runtime，REPL 开场白恒为 `CodeN session <id>. Type /help for commands.`，不展示历史内容，用户看不出这是恢复的会话、也回忆不起上次聊到哪。

本设计补充这两点能力，并引入"会话标题"（首个 user prompt）以增强列表可读性。

## 2. 目标行为

- 每个会话自动获得一个**标题**（首个 user prompt 截断），并持久化。
- 用户可通过 `--resume`（无值）在命令行列出当前工作区的所有会话（id + 标题 + 消息数 + 最近活动）。
- 用户可在运行中的 REPL 输入 `/sessions` 打印同一份列表，并标注当前会话。
- 恢复会话时，开场白明确标识"已恢复"，展示消息数与最近几条对话预览，并提示仅显示最后几条。

## 3. 明确不做（YAGNI）

- 不加 `/history`（完整回放）。预览已告知"仅显示最后几条"，暂不提供完整对话查看命令。
- 不跨工作区列出：仅列出当前工作区的会话（会话按 `workspaceHash` 分目录存储）。
- 不添加会话删除/重命名。
- 不写持久化索引：`list()` 实时扫描并解析会话文件（本地会话体积小，够用）。

## 4. 架构与组件

涉及 `src/sessions/store.ts`、`src/core/runtime.ts`、`src/cli/index.ts`。

### 4.1 `src/sessions/store.ts`

#### `setTitle(title: string): Promise<void>`

写入一条 `session.title` 记录（`type: "session.title"`，`data: { title }`）。持久化方式与现有 `append()` 一致（JSONL 追加，目录 `0700` / 文件 `0600`）。

#### `list(): Promise<SessionMeta[]>`

扫描 `dataDir/sessions/<workspaceHash>/` 下的所有 `*.jsonl`，逐个解析并提取元信息：

```ts
interface SessionMeta {
  id: string;
  title?: string;        // 优先 session.title；缺失则回退首个 user 消息
  messageCount: number;  // type === "message" 的记录数
  lastActivity: string;  // 最后一个记录的 timestamp（ISO 字符串）
}
```

- 解析逻辑与 `recover()` 共用一套记录读取/容错处理；对空的或损坏的文件跳过并记 warning，不抛错。
- 按 `lastActivity` 倒序返回，最活跃的排前面。
- 目录不存在（尚无会话）时返回空数组。

### 4.2 `src/core/runtime.ts`

在 `run()` 的 user 消息追加处，判断是否为会话的**首个 `user` 消息**：追加前 `this.messages` 中不含任何 `role === "user"` 的消息时，调用 `session.setTitle(userText)` 记录标题。

- 新建会话：首个 `run()` 触发设标题。
- 恢复会话：`recover()` 已加载历史 user 消息，追加前已存在 `user` 消息，不会覆盖已有标题。

注：标题取首个 user prompt 的原文，列表展示时再截断，存储保留完整内容。

### 4.3 `src/cli/index.ts`

#### CLI 选项

将 `--resume <session-id>` 改为可选值：

```
.option("--resume [session-id]", "resume a previous session, or list sessions when no id is given")
```

- `--resume` 无值（值为 `true`/`undefined`/空）→ 调用 `session.list()`，打印列表后退出。
- `--resume <session-id>` → 现有 `recover()` 恢复逻辑不变。

#### REPL `/sessions` 命令

`repl()` 内新增分支：输入 `/sessions` 时打印与 `--resume` 无值相同的列表，并附带一行 `Current session: <id>`。

#### 列表渲染

对每个会话输出一行：

```
<id>  <title?>  (<messageCount> messages, <lastActivity>)
```

- `title` 缺失时显示 `(no title)`。
- `messageCount` 为 0（新会话尚无对话）显示 `(new session)`。
- `lastActivity` 用本地可读格式（如 `YYYY-MM-DD HH:mm`）。

#### 恢复开场白

复用并调整 `repl()` 的开场逻辑：

- 新建会话：`CodeN session <id>. Type /help for commands.`（不变）。
- 恢复会话：
  ```
  Resumed session <id> (N messages).
  Showing last 3 of N messages.
  ┌ user      <预览>
  ┌ assistant <预览>
  ┌ user      <预览>
  ```
  - 预览取最近几条 `user`/`assistant` 消息的 `content`（跳过 `system` 与 `tool` 记录）。
  - 每条内容做单行化 + 截断（如 120 字符），并用 `user`/`assistant` 前缀区分角色。
  - 恢复路径需要 `cli/index.ts` 拿到恢复后的消息（已有 `RecoveredSession.messages`）与摘要，据此渲染预览。

### 4.4 数据流

```
新建:  cli → session.create() → runtime.run(first prompt)
        └─ run() 检测首个 user → session.setTitle(prompt) → append "session.title"
恢复:  cli --resume <id> → session.recover() → runtime(initialMessages)
        └─ 开场白渲染 "Resumed session <id> (N messages)" + 预览
列出:  cli --resume(无值) 或 REPL /sessions → session.list() → 渲染列表
```

## 5. 错误处理

- `setTitle` 复用 `append()` 的队列与权限处理，失败不影响主流程（标题为增强信息）。
- `list()` 对单个文件解析失败：跳过该文件并记录 warning，不影响其他会话展示。
- `--resume` 无值但目录为空：打印 `No sessions found.`，退出码 0。

## 6. 测试

- `SessionStore`：
  - `setTitle` 写入 `session.title` 记录；
  - `list` 多会话解析与 `lastActivity` 倒序；
  - `list` 空目录返回 `[]`；
  - 旧会话（无 `session.title`）回退取首个 user 消息；
  - 损坏/空文件被跳过并记 warning。
- CLI：
  - `--resume` 无值列出（含标题/消息数/最近活动）并退出；
  - `--resume <id>` 恢复（现行为不变）。
- REPL：
  - `/sessions` 打印列表并标注当前会话；
  - 恢复开场白显示 `Resumed session <id>`、消息数与预览，且带"Showing last N"提示。

## 7. 兼容性

- 既有会话文件不受影响：`session.title` 为可选记录，`recover()` 不影响。
- `--resume` 从必填值改为可选值：`--resume <id>` 用法不变，新增无值列出模式。
- commander 可选值 `[session-id]`：`--resume <id> "prompt"` 与 `--resume <id>`（单值）行为不变；仅裸 `--resume` 触发列出。
