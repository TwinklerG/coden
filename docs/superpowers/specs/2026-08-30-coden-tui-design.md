# CodeN 全屏 TUI 设计

日期：2026-08-30

## 1. 背景与结论

CodeN 已具备事件驱动的 `AgentRuntime`、流式文本与工具调用事件、Markdown 终端渲染、多行编辑状态、会话恢复、权限审批、i18n、插件、Skills 和斜杠命令。此时增加 TUI 不需要重写 Agent 核心，主要价值是改善持续交互、内容回看和状态可见性。

本设计采用 **Ink 7 的全屏 alternate-screen 模式**。TUI 是现有应用能力之上的薄展示层，不引入新的 Agent 执行语义。内容区保持与当前 CLI 高度相似，底部增加活动状态、固定输入区和状态栏。

该需求值得实现，整体属于中等规模 UI 工程。主要风险在终端生命周期、输入焦点、长内容滚动、Markdown 重排和发布产物兼容性，而不在 Agent Runtime。

## 2. 目标

1. 在支持的交互式终端中默认提供全屏 TUI；
2. 保留现有 CLI 作为显式入口和兼容性降级路径；
3. 高度复用 Runtime、事件、命令、编辑状态、Markdown、i18n、权限和会话能力；
4. 保持单任务串行模型，不引入后台任务或消息排队；
5. 使用成熟框架承担整屏 diff、布局、光标和 resize，不手写通用 UI 框架；
6. 保持 `--print`、非 TTY 和 trace 等自动化接口稳定。

## 3. 非目标

首期不实现：

- 会话树或侧栏；
- 文件树、diff viewer 或工具详情页；
- 主题系统和布局配置；
- 命令补全或模型选择器；
- 后台任务、并行 Agent 或运行中消息排队；
- 会话全文搜索；
- 自定义插件 UI；
- 通用 Button、Panel、Theme 等 TUI 组件库；
- 对 `AgentRuntime` 状态机或 Tool Calling 语义的修改。

## 4. 参考案例与框架选择

### 4.1 参考案例

- [Gemini CLI](https://github.com/google-gemini/gemini-cli)：使用 React/Ink，适合参考 TypeScript 项目中的界面与核心分层；
- [OpenCode](https://github.com/anomalyco/opencode)：内容区、底部输入区和状态展示可作为视觉参考，但不照搬其复杂路由、侧栏和弹窗体系；
- [Codex CLI](https://github.com/openai/codex)：强调终端兼容、滚动和复制体验，提醒 CodeN 保留 `--cli` 与 `--print`；
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)：主体接近连续 CLI、状态展示克制，符合 CodeN 内容区的定位；
- [Crush](https://github.com/charmbracelet/crush)：可参考完整全屏工作台，但其 Go/Bubble Tea 技术路线和功能密度不适合作为 CodeN 首期范围。

### 4.2 选择 Ink 7

采用 Ink 7 与 React，并使用其全屏 alternate-screen 能力。Ink 提供声明式布局、输入处理、终端尺寸响应和整屏更新，CodeN 只实现少量业务组件。

未选择 OpenTUI：其 TypeScript 版本依赖原生渲染器与 FFI，Node 支持和打包约束与 CodeN 的 Node 发布产物存在较高集成风险。

未选择 Terminal Kit：它具备广泛的 Node 兼容性，但 API 更偏命令式，需要自行维护更多布局、状态同步和组件行为，难以保持薄层。

Ink 7 要求 Node.js 22+。项目相应将最低 Node 运行时提高到 22，并调整 README、`package.json` 和 CI 构建产物冒烟矩阵。

## 5. 启动模式

### 5.1 路由矩阵

| 调用方式 | 行为 |
| --- | --- |
| `coden` | 支持的 TTY 中启动 TUI |
| `coden "任务"` | 启动 TUI、自动提交任务，完成后继续交互 |
| `coden --tui` | 显式启动 TUI |
| `coden --cli` | 使用原 CLI |
| `coden --cli "任务"` | 原 CLI 单轮执行后退出 |
| `coden -p "任务"` | 纯文本执行后退出 |
| 默认模式遇到非 TTY 或 `TERM=dumb` | 自动使用 CLI |
| 显式 `--tui` 但终端不支持 | 给出警告后降级 CLI |

`--tui` 与 `--cli` 冲突；`--tui` 与 `--print` 冲突；`--cli --print` 合法。`NO_COLOR` 只禁用颜色，不关闭 TUI。CI、非 TTY、`TERM=dumb` 或无法可靠进入 raw mode/alternate screen 时才降级 CLI。

### 5.2 兼容性

- `package.json` 声明 Node.js 22+；
- README 明确发布产物的最低 Node 版本；
- 构建产物在 Node 22 及后续稳定版本上执行冒烟测试；
- `--cli` 始终作为无障碍、日志记录和终端兼容回退入口；
- `--print` 保持纯文本、可管道化、单轮执行后退出。

## 6. 总体架构

```text
CLI 参数与模式选择
        │
        ├── CliApp（保留现有实现）
        │
        └── TuiApp（Ink 7，全屏）
                 │
                 ├── TuiController
                 │     ├── 调用 AgentRuntime
                 │     ├── 执行斜杠命令
                 │     └── 管理取消与授权响应
                 │
                 └── TuiStore
                       └── 订阅现有 EventBus
```

`AgentRuntime`、Provider、工具、权限、SessionStore、插件、Skills、ContextManager 和 trace 均不得依赖 Ink 或 React。

TUI 只负责：

1. 将现有运行事件转换为展示状态；
2. 收集输入并调用共享命令或 Runtime；
3. 全屏布局、滚动和底栏展示；
4. 在 TUI 内承接人工授权与项目插件信任。

建议目录：

```text
src/tui/
├── app.tsx
├── controller.ts
├── store.ts
├── transcript.ts
└── components/
    ├── transcript-view.tsx
    ├── input-bar.tsx
    ├── activity-line.tsx
    ├── status-bar.tsx
    └── permission-dialog.tsx
```

上述五个组件是首期全部业务组件，不建立新的通用组件体系。

## 7. 共享应用层

当前 `runAgentCommand()` 同时负责依赖装配、CLI 输入和终端输出。实施时提取与界面无关的应用会话，但不改变原有运行行为：

```ts
interface AgentApplication {
  runtime: AgentRuntime;
  events: EventBus;
  session: SessionStore;
  registry: ToolRegistry;
  skills: SkillRegistry;
  metadata: {
    provider: string;
    model: string;
    workspace: string;
    approvalMode: PermissionMode;
  };

  reload(): Promise<ReloadResult>;
  switchLanguage(language: Language): Promise<void>;
  dispose(): Promise<void>;
}
```

```text
createAgentApplication()
        │
        ├── runCliApp()  → readline / MultilineEditor / TerminalRenderer
        └── runTuiApp()  → Ink / TuiController / TuiStore
```

Provider、插件、Skills、权限、Session、trace、ContextManager 和 Runtime 仍由同一个应用工厂装配。应用工厂接收一个界面无关的 `InteractionPort`：CLI 适配器使用 readline 回答授权与信任问题，TUI 适配器通过 store 打开弹层并等待结果。CLI 与 TUI 不维护两套权限或信任逻辑。

## 8. 共享斜杠命令

将现有 `repl()` 中的斜杠命令分支提取为共享 `ReplCommandService`。它接收分类后的命令，返回文本结果或退出等控制结果，并按需调用 runtime、reload 或语言切换能力。

CLI 将命令结果写入 stdout；TUI 将结果追加为 transcript 信息块。`/help`、`/skills`、`/sessions`、`/session`、`/compact`、`/reload`、`/new`、`/lang` 和 `/quit` 不维护两套业务逻辑。`classifyReplInput` 原样复用。

## 9. 展示状态与数据流

新增纯状态 reducer，将 `RuntimeEvent` 转换为 TUI 展示状态：

```text
RuntimeEvent
    └── PresentationReducer
          ├── transcript blocks
          ├── activity state
          ├── current phase
          ├── usage/context state
          └── permission state
```

TUI store 订阅 reducer。现有 `TerminalRenderer` 首期不强制重写，以降低 CLI 回归风险；两种界面共享事件语义、格式化函数和底层文本能力，而不是共享直接终端写入逻辑。

### 9.1 Transcript block

Transcript 至少包含以下 block：

- user；
- assistant；
- tool-start；
- tool-result；
- info；
- error。

每个 block 使用稳定 ID。Assistant block 保存原始 Markdown，并在流式 delta 到达时增量更新。终端宽度变化时按新宽度重新渲染，不能把首次生成的 ANSI 文本视为永久布局。

### 9.2 现有能力复用

| 现有能力 | TUI 复用方式 |
| --- | --- |
| `AgentRuntime`、`EventBus` | 原样使用 |
| `EditorState`、输入解码 | 复用编辑状态和按键语义 |
| `MarkdownStreamRenderer` | 复用 Markdown 解析和样式，将输出收集到 transcript block |
| `terminal-text.ts` | 复用 Unicode 宽度、截断和清理 |
| 工具摘要格式化 | 原样复用 |
| `classifyReplInput` | 原样复用 |
| i18n | 原样复用并补充少量 TUI 文案 |
| Session 恢复 | 将恢复消息转换成 transcript blocks |
| 权限策略 | 只替换异步人工询问适配器 |
| JSONL trace | 完全不变 |

`context.prepared` 已提供 estimated tokens 与预算，可用于计算底栏上下文占用比例。TUI 不轮询 Runtime，也不读取 Runtime 私有状态。

## 10. 界面设计

### 10.1 布局

```text
┌──────────────────────────────────────────────────────────────┐
│ 对话内容区                                                   │
│                                                              │
│ > 修复当前测试                                               │
│                                                              │
│ 我先检查项目结构……                                           │
│ ◇ read  package.json                                         │
│ ✓ read  12ms                                                 │
│                                                              │
│ 已定位到问题……                                               │
│                                              可滚动内容区域   │
├──────────────────────────────────────────────────────────────┤
│ ⠹ preparing edit  {"path":"src/..."}            活动行     │
├──────────────────────────────────────────────────────────────┤
│ 任务 > _                                         固定输入区   │
├──────────────────────────────────────────────────────────────┤
│ openai/gpt-5 · CodeN · smart · thinking · context 42%        │
└──────────────────────────────────────────────────────────────┘
```

不设置首期侧栏或顶部导航。

### 10.2 内容区

- 用户消息保持 `> ` 前缀；
- Assistant 内容复用现有 Markdown 样式；
- 工具调用保持 `◇ tool summary` 和 `✓/✗ tool duration`；
- 斜杠命令结果作为普通信息块；
- 恢复会话时将历史消息转换成相同 block；
- 内容默认自动跟随底部；
- 用户滚动后暂停自动跟随，按 `End` 返回最新内容；
- 支持 `PageUp`、`PageDown`、鼠标滚轮和终端 resize；鼠标事件使用与 Ink 7 兼容的现成 hook，不自行实现终端鼠标协议。

### 10.3 输入区

- 空闲时开放输入，运行中只读；
- 复用现有 `EditorState` 的多行、历史和编辑语义；
- Enter 提交；Shift+Enter 或行尾 `\` 换行；
- 运行中 `Ctrl+C` 取消当前任务；
- 空输入时 `Ctrl+D` 退出；
- 空闲时 `Ctrl+C` 在确认后退出；
- 首期不支持运行中排队或追加消息。

### 10.4 活动行

活动行复用现有状态：

- thinking；
- reasoning preview；
- rendering；
- preparing tool；
- smart approval review。

活动行只展示瞬时状态，不写入会话。正式工具开始和完成仍作为 transcript block 保留。

### 10.5 状态栏

底栏优先显示：

1. provider/model；
2. workspace 名称；
3. manual/smart/auto 授权模式；
4. idle/thinking/tool/reviewing 等当前阶段；
5. 上下文占用比例。

Session ID、耗时和本轮 token 在终端足够宽时显示为次级信息。窄终端按优先级隐藏，不允许横向溢出。过窄终端进入紧凑布局，优先保留内容和输入。

### 10.6 权限与信任弹层

人工授权使用居中或底部弹层，并复用现有工具输入摘要和风险分类：

```text
edit · modify
path: src/index.ts

[y] 允许一次  [s] 本会话允许  [n] 拒绝
```

弹层出现时拦截普通输入。危险操作不显示会话级允许选项。项目插件首次信任使用同一交互机制。LLM smart review 的运行状态显示在活动行，不改变其失败关闭和人工升级语义。

## 11. 控制状态机

`TuiController` 同一时刻只允许一个活动操作：

```text
starting → idle → submitting → running → idle
                               ├── permission dialog
                               ├── cancelled
                               └── failed
```

人工授权通过 Promise 等待弹层结果，继续满足现有 `PermissionPrompt` 接口。退出或取消时必须解决或拒绝所有待处理交互 Promise，不能让 Runtime 永久等待。

TUI 首先以 `starting` 状态挂载，再异步创建 `AgentApplication`。因此配置错误、Provider 错误和项目插件信任均可在界面中显示或处理，无需在全屏模式前临时创建 readline。

## 12. 生命周期与错误处理

TUI 模式不得创建 `TerminalRenderer` 或 `MultilineEditor`，避免多个对象争抢 raw mode、光标和输出流。

正常退出路径包括 `/quit`、空输入 `Ctrl+D`、确认后的空闲 `Ctrl+C`、`SIGTERM`、`SIGHUP`，以及 fatal error 后退出。退出顺序为：

1. 取消活动任务；
2. 解决或拒绝待处理授权；
3. flush trace；
4. 卸载 Ink；
5. 恢复 alternate screen、raw mode、光标和信号监听器。

Fatal error 先在 TUI 中显示；离开 alternate screen 后，再向普通终端输出一行错误摘要，避免错误随全屏界面消失。

只有终端能力检测失败，或 Ink renderer 在应用工厂启动前无法初始化时，才自动降级 CLI。配置、Provider 或插件等应用启动错误应留在 TUI 中展示，因为切换 CLI 不会修复这些错误。任务已开始后也不能使用 CLI 重跑，否则可能重复执行工具或文件修改。

## 13. 性能策略

Transcript model 保留全部 block，但 Ink 只挂载当前可见行和少量 overscan，避免长会话使整个 React 树持续重排。

原始 Markdown 按终端宽度缓存；resize 时只使对应宽度缓存失效。流式过程中只更新当前 Assistant block、活动行和底栏，不重建无关历史内容。

性能优化不得改变会话持久化内容，也不得静默丢弃用户可滚动查看的历史。

## 14. Ink 7 可行性门槛

实施第一步必须先验证：

1. 最小 Ink 7 alternate-screen 程序可由当前 Bun 构建流程打包；
2. npm 发布产物可由 Node 22 在 Linux 和 macOS 启动；
3. 不依赖 `src/` 或 Bun 专有运行时 API；
4. Yoga 等依赖在安装与运行时无需未发布资源；
5. 正常退出和异常退出都能恢复终端。

当前目标仍是保持构建后的单文件 CLI。若 Ink 7 无法满足单文件产物，必须先报告验证结果，再由维护者决定允许 `dist/` 附带框架运行资源还是更换框架，不能隐式改变发布契约。

## 15. 测试策略

### 15.1 单元测试

- 模式路由与冲突参数；
- `RuntimeEvent` 到 TUI state 的 reducer；
- transcript block、滚动、自动跟随和底栏裁剪；
- 共享斜杠命令服务；
- 权限 Promise 的允许、拒绝、取消和退出；
- 会话消息到 transcript block 的转换。

### 15.2 Ink 组件测试

- 不同终端尺寸下的内容区、输入区、活动行和底栏；
- 运行中禁用输入；
- 权限弹层的焦点与按键；
- `NO_COLOR` 和紧凑布局；
- initial prompt 自动提交后回到可交互状态。

优先使用 Ink 官方能力或兼容的测试工具，不为组件测试编写另一套 TUI 渲染器。

### 15.3 虚拟终端或 PTY 集成测试

- 启动、输入、流式更新、滚动、resize、取消和退出；
- alternate screen、raw mode 与光标恢复；
- 不出现重复行或残留活动状态；
- 非 TTY 和不支持终端的降级；
- Runtime 开始前初始化失败可降级、开始后失败不会重跑。

### 15.4 回归验证

- 完整 `just check`；
- `just build`；
- Node 22 及后续稳定版本运行构建产物；
- 默认 TUI、`--tui`、`--cli`、`--print` 冒烟测试；
- 现有 CLI、非 TTY、权限、会话、插件、Skills、i18n 和 trace 测试继续通过。

## 16. 验收标准

1. `coden` 在支持的 TTY 中默认进入 Ink 全屏界面；
2. 模式路由、参数冲突和自动降级符合本设计；
3. 内容区在视觉和信息密度上与现有 CLI 高度一致；
4. 流式回复、reasoning、工具调用和 smart review 状态持续更新；
5. 输入支持现有多行编辑、历史和提交语义；
6. 运行中 `Ctrl+C` 能可靠取消，不产生第二次执行；
7. 人工授权、项目插件信任和危险操作均可在 TUI 中完成；
8. 现有斜杠命令行为一致；
9. 会话恢复、语言热切换、插件 reload 和 trace 行为不变；
10. resize、窄终端、CJK、emoji 和 `NO_COLOR` 正常显示；
11. 任意退出路径都恢复 alternate screen、raw mode 和光标；
12. `--cli` 与 `--print` 的输出和测试保持兼容；
13. 发布产物满足 Node 22+ 运行要求，并通过 Ink 7 打包门槛。
