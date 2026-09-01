# CodeN 实验性 Web 前端设计

日期：2026-09-01

## 1. 背景与结论

CodeN 已通过 `AgentApplication` 将 Provider、Runtime、工具、权限、会话、插件、Skills、Hooks 和 trace 组合为界面无关的应用层；CLI 与 TUI 都是该应用层的适配器。新增 Web 前端不应重写 Agent 循环，而应增加第三个表现层。

首版采用 **本地单进程 Web 服务 + 独立 React 前端 + REST/SSE 协议**：

- `coden --web` 在当前工作区启动服务；
- 默认只监听 `127.0.0.1`，自动打开浏览器；
- Agent、工具与 Hook 仍以启动 CodeN 的当前用户权限在本机运行；
- 服务端持有唯一活动 `AgentApplication`，浏览器只是控制与展示客户端；
- Runtime 继续运行，不因页面刷新或控制端断开而取消；
- 同一时刻只有一个浏览器客户端拥有控制权，其他客户端只读并可主动接管；
- Provider、模型、thinking 和审批模式继承启动参数、环境变量与配置，Web 首版只显示、不修改；
- Web 功能标记为 experimental，不改变默认 CLI/TUI 行为。

该方案比 WebSocket 更适合首版：服务端到浏览器的高频流式状态通过 SSE 推送，低频命令通过 JSON POST 提交，协议容易测试、重连和审计。现有静态产品网站 `website/` 与高权限本地 Agent UI 的生命周期和安全边界不同，二者保持完全独立。

## 2. 目标

1. 提供完成真实编码任务所需的 Web Agent 闭环：输入、流式回复、工具执行、人工审批、取消和错误展示；
2. 支持安全渲染 Markdown 与代码，并以可折叠卡片展示工具输入和截断后的输出；
3. 支持当前工作区的会话列表、新建会话和恢复会话；
4. 页面刷新或网络短暂断开后恢复服务端权威状态，不重复执行任务；
5. 保持一个活动 Agent 和一个活动 turn，不引入并行 Agent、后台会话或消息队列；
6. 复用现有 `AgentApplication`、`AgentRuntime`、`EventBus`、权限策略和 `SessionStore`；
7. 默认提供低摩擦的 loopback 使用方式；非 loopback 监听时强制临时 token；
8. 保持发布产物可由 Node.js 22+ 运行，运行时代码不依赖 Bun 专有 API。

## 3. 非目标

首版不实现：

- 远程托管、多用户账号、持久登录、团队协作或云同步；
- 多工作区切换、多个并行 Agent 或后台运行多个会话；
- Provider、模型、thinking、语言、审批模式或 API Key 的 Web 配置；
- 文件树、编辑器、diff viewer、终端模拟器、Git 面板或上传附件；
- `/compact`、`/reload`、Skills/工具列表等 REPL 命令入口；
- 消息排队、运行中切换会话或运行中追加指令；
- 插件自定义 Web UI；
- TLS 终止、通用沙箱或对恶意本地代码的隔离；
- 将 Agent UI 合并进 `website/` 产品网站；
- 移动端同等优化。窄屏只保证核心对话与审批基本可用。

## 4. 启动与命令行契约

### 4.1 参数

新增：

```text
--web                   启动实验性 Web 前端
--web-host <host>       监听地址，默认 127.0.0.1
--web-port <port>       监听端口，默认 0（由系统分配可用端口）
--no-open               不自动打开默认浏览器
```

选择端口 `0` 可避免固定端口冲突；服务开始监听后在终端打印实际 URL。自动打开失败是非致命警告，服务继续运行。

`--web` 与 `--tui`、`--cli`、`--print` 冲突。`--web-host`、`--web-port` 和 `--no-open` 未配合 `--web` 时返回配置错误。现有 Provider、模型、thinking、插件、审批和工作区外访问参数继续传给 `createAgentApplication()`。

`coden --web "任务"` 在应用启动后自动提交一次初始任务。`--resume <session-id>` 恢复指定会话；裸 `--resume` 保持现有“列出会话后退出”语义，Web 页面本身提供会话选择。

### 4.2 生命周期

启动顺序：

1. 校验参数和监听安全策略；
2. 创建 HTTP 服务并获得实际端口；
3. 打印 URL，按需打开浏览器；
4. 创建 Web store 和 controller；
5. 异步创建 `AgentApplication`，使项目信任确认可以直接出现在 Web 页面；
6. 若有 initial prompt，在应用 ready 后提交。

`SIGINT`、`SIGTERM` 或 `SIGHUP` 触发有序关闭：停止接收请求、取消活动 turn、解决待处理交互、结束并 dispose 应用、关闭 SSE 和 HTTP 服务。关闭浏览器不会停止服务。

## 5. 总体架构

```text
Browser React App
  ├── GET /api/state + GET /api/events (SSE)
  └── JSON POST actions
                    │
                    ▼
Native Node HTTP Server
  ├── WebSecurity
  ├── WebProtocol
  ├── WebStore (authoritative presentation state)
  └── WebController
         ├── control ownership
         ├── turn/session serialization
         ├── interaction promises
         └── AgentApplication
                ├── AgentRuntime / EventBus
                ├── PermissionPolicy / tools / hooks
                └── SessionStore / trace
```

推荐目录：

```text
src/web/
├── command.ts
├── server.ts
├── router.ts
├── security.ts
├── protocol.ts
├── store.ts
├── controller.ts
├── browser.ts
└── static-assets.ts
webui/
├── package.json
├── bun.lock
├── index.html
├── tsconfig.json
├── biome.json
├── src/
│   ├── main.tsx
│   ├── app.tsx
│   ├── api.ts
│   ├── state.ts
│   ├── markdown.tsx
│   ├── styles.css
│   └── components/
└── test/
```

`src/web/` 是 Node 服务端，不能导入浏览器 React 组件。`webui/` 是独立浏览器工程，不导入 Node-only 模块。双方只通过 `src/web/protocol.ts` 中的 JSON 类型和运行时校验契约通信；前端可通过 type-only import 复用协议类型。

## 6. 服务端状态模型

### 6.1 权威快照

`WebStore` 持有可序列化的 `WebSnapshot`：

```ts
interface WebSnapshot {
  revision: number;
  phase: "starting" | "idle" | "thinking" | "rendering" | "tool" | "reviewing" | "failed";
  running: boolean;
  metadata?: AgentApplicationMetadata;
  sessionId?: string;
  sessions: WebSessionSummary[];
  blocks: WebBlock[];
  pendingInteraction?: WebInteraction;
  control: { ownerClientId?: string };
  contextPercent?: number;
  turnUsage?: { inputTokens: number; outputTokens: number; durationMs: number };
  startupWarnings: string[];
  fatalError?: WebError;
}
```

Block 至少包括 user、assistant、tool、interaction、info 和 error。Tool block 使用 `callId` 稳定关联模型调用、执行状态、最终有效输入、风险、耗时和截断输出。Assistant block 保留原始 Markdown；浏览器负责安全渲染。

每次有效状态变化都递增 `revision`。Store 是唯一展示事实源，不让各浏览器自行推断 Agent 是否空闲、谁拥有控制权或审批是否仍有效。

### 6.2 Runtime 事件投影

Store 订阅现有 EventBus，投影：

- turn 开始、完成和失败；
- Provider reasoning、文本和工具调用增量；
- Provider retry；
- 工具开始、完成和失败；
- Smart Approval 状态；
- context 使用率与 turn usage；
- 插件告警和 thinking metadata。

为了可靠显示工具详情，Runtime/ToolExecutor 增加界面无关事件：

- `tool.started` 补充最终有效 `input` 和 `risk`；
- Runtime 在工具结果写入会话后发出 `tool.result`，包含 `callId`、工具名、截断后的 `content` 和 `isError`。

这些事件不改变工具执行、持久化或权限语义。Trace 本来就可能包含工具输入输出；文档继续明确其敏感性。

恢复会话时，由 recovered messages 一次性投影历史 block。System 和 Hook 上下文不直接显示；tool message 与前一 assistant tool call 按 `callId` 合并。Provider state、签名和 redacted thinking 不进入 Web 协议。

### 6.3 快照与增量

首次连接先接收完整 snapshot，之后接收有序 patch：

```ts
interface WebEventEnvelope {
  revision: number;
  type: "snapshot" | "patch";
  data: unknown;
}
```

SSE `id` 等于 revision。`/api/state` 和 SSE 首帧还包含按连接生成的 `viewer`（当前 client ID 与 `isOwner`），它不写入全局 snapshot；owner 变化后，客户端用自己的 viewer ID 与 `control.ownerClientId` 比较控制权。client Cookie 保持 HttpOnly，前端无需读取 Cookie。客户端发现 revision 跳跃、patch 校验失败或重连后，丢弃本地推断并重新获取完整 snapshot。服务端无需保存无限事件日志；任意重连都可以从当前权威 snapshot 恢复。

Provider 文本 delta 合并为当前 assistant block 的 append patch，避免每个 token 重传完整 transcript。高频 patch 可在不改变文本顺序的前提下以约 16–32ms 窗口批量广播。

## 7. HTTP 与 SSE 协议

### 7.1 读取接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/health` | 进程健康与协议版本，不包含会话内容 |
| GET | `/api/state` | 当前完整权威快照 |
| GET | `/api/events` | SSE snapshot/patch 流和心跳 |
| GET | `/api/sessions` | 当前工作区的会话摘要 |

### 7.2 控制接口

| 方法 | 路径 | 请求 |
| --- | --- | --- |
| POST | `/api/control/takeover` | 无 body |
| POST | `/api/turn` | `{ "text": string }` |
| POST | `/api/cancel` | 无 body |
| POST | `/api/interactions/:id` | `{ "decision": "allow_once" | "allow_session" | "deny" | "confirm" | "reject" }` |
| POST | `/api/sessions/new` | 无 body |
| POST | `/api/sessions/resume` | `{ "sessionId": string }` |

所有 POST 仅允许控制端调用。提交 turn 时必须 ready、idle、无待处理交互且文本非空；新建/恢复会话还要求 idle。会话切换不自动取消任务。

统一错误响应：

```ts
interface WebApiError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

主要状态码：400 非法请求、401 缺少远程 token、403 非控制端或 Origin 不合法、404 未知资源、409 当前状态不允许、413 请求过大、500 内部错误。JSON body 限制为 1 MiB，prompt 另设明确字符上限；拒绝未知字段和错误 content type。

SSE 使用 `text/event-stream`、`Cache-Control: no-store`、禁用代理缓冲并定期发送注释心跳。慢客户端使用有界发送队列；超限时断开，让其通过 snapshot 重连，不阻塞 Runtime。

## 8. 单控制端模型

服务端为浏览器设置随机 `coden_client` Cookie，客户端 ID 只用于控制权，不等同于远程认证。

规则：

1. 第一个建立有效 SSE 连接的客户端成为 owner；
2. 其他客户端收到同一状态，但所有修改控件只读；
3. 只读客户端可调用 takeover；服务端原子替换 owner 并广播状态；
4. 原 owner 立即降为只读，其随后到达的请求按当前 owner 再校验；
5. 刷新页面保留 client Cookie，因此正常刷新后仍识别为同一 owner；
6. owner 断开不取消任务，也不自动转移控制权；其他客户端可显式接管；
7. 进程重启后 owner 重置，由首个连接重新获得。

所有控制 API 在执行动作前检查 owner，而不是只依赖前端禁用按钮。一个 controller 同时最多持有一个 turn Promise 和一个 pending interaction。

## 9. 会话管理

服务端始终只有一个活动 `AgentApplication`。会话列表限定当前启动工作区。

- **新建**：仅 idle 时 dispose 当前应用，使用相同启动配置创建无 resume ID 的新应用；未产生用户消息的空会话无需落盘。
- **恢复**：仅 idle 时验证 session ID，dispose 当前应用，再以该 ID 创建应用并投影 recovered messages。
- **失败回滚**：目标应用创建失败时进入可恢复错误状态，并允许用户重试新建/恢复；不能继续使用已经 dispose 的旧 Runtime，也不能伪装切换成功。
- **切换期间**：phase 为 starting，禁用提交、取消以外的无关控制和重复切换。

切换不会启动多个后台 Agent。会话列表在 turn 完成、标题生成和切换后刷新。

## 10. 人工交互

WebController 向 `createAgentApplication()` 提供 `AgentInteraction`：

- `permission()` 在 transcript 中创建持久 interaction block，并返回等待用户决定的 Promise；
- `confirm()` 用于项目信任等确认，使用相同机制；
- 只有 owner 可以回答；
- dangerous 风险不接受 `allow_session`；
- abort、会话切换或服务关闭会以 deny/reject 解决 Promise；
- 重复、过期或 ID 不匹配的回答返回 409；
- pending interaction 在页面刷新和控制权接管后仍保留。

审批卡片完整显示工具名、风险和待执行的最终输入。审批决定也保留为 resolved/cancelled block，避免对话历史失去上下文。

## 11. 安全模型

### 11.1 Loopback 默认模式

`127.0.0.1`、`::1` 和严格识别的 `localhost` 视为 loopback。默认不要求 token，但必须：

- 只接受与监听模式匹配的 `Host`；
- API 和 SSE 不返回 CORS 允许头；
- 所有状态修改请求要求 `Origin` 与当前 HTTP origin 精确一致；
- JSON POST 要求 `Content-Type: application/json`；
- Cookie 使用 `HttpOnly; SameSite=Strict; Path=/`；
- API 响应使用 `Cache-Control: no-store`；
- 静态页面设置 CSP、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 和 `X-Frame-Options: DENY`。

直接顶层导航允许没有 Origin；修改 API 不允许缺失 Origin。该策略降低恶意网页对本地端口执行请求和读取结果的风险，但不宣称 localhost 是安全沙箱。

### 11.2 非 loopback 模式

当 `--web-host` 不是 loopback（包括 `0.0.0.0`、`::` 和局域网地址）时：

- 启动时使用 `crypto.randomBytes(32)` 生成进程生命周期内的临时 token；
- 无法通过参数关闭 token；
- 打印并自动打开带 token 的本机入口 URL；远程访问者使用相同 token；
- 首次访问 `/?token=...` 后以常量时间比较验证，写入 HttpOnly SameSite Cookie，并 303 重定向到无 token URL；
- 静态应用、state、SSE 和全部 API 都要求认证 Cookie；
- 仍执行 Host、Origin、owner 和请求体校验；
- token 不写入配置、session、trace 或普通请求日志，服务重启即失效。

非 loopback 模式不提供 TLS。启动终端和页面都明确警告：token 只阻止未授权访问，不加密网络流量，也不隔离工具执行；不应直接暴露到公网。需要跨不可信网络时由用户自行使用 SSH tunnel 或可信反向代理，并承担其安全配置。

### 11.3 内容安全

模型、工具、文件和插件输出均视为不可信文本：

- Markdown 使用 `marked` 解析后经 DOMPurify 严格清理；
- 原始 HTML 默认不作为可信 UI 执行；
- 链接仅允许安全协议，外链使用 `rel="noreferrer noopener"`；
- 工具输出通过 React 文本节点或安全 code block 渲染；
- 不使用 `eval`、内联脚本、远程 CDN 或动态插件组件；
- CSP 至少限制为 `default-src 'self'`、`script-src 'self'`、`style-src 'self'`、`connect-src 'self'`、`img-src 'self' data:`、`frame-ancestors 'none'`。

## 12. Web 界面

### 12.1 桌面布局

```text
┌──────────────────┬────────────────────────────────────────────┐
│ CodeN · 实验性   │ provider / model · approval · thinking     │
│ + 新建会话       ├────────────────────────────────────────────┤
│                  │ 对话 transcript                            │
│ 会话 A           │ 用户 / Assistant / Tool / Approval         │
│ 会话 B           │                                            │
│ 会话 C           │                                            │
│                  ├────────────────────────────────────────────┤
│ 控制权状态       │ 多行输入                         停止/发送 │
└──────────────────┴────────────────────────────────────────────┘
```

左侧为当前工作区会话列表和新建操作；主区包含克制的状态头、transcript 和固定 composer。视觉上延续 CodeN 的极简开发者工具定位，不复制官网 Hero，也不使用通用 SaaS 仪表盘、渐变或大量卡片。

### 12.2 Transcript

- 用户消息和 Assistant Markdown 有清晰但不过度装饰的层级；
- 流式文本增量更新当前 Assistant block；
- reasoning 只作为短暂活动状态，不持久展示完整推理；
- Tool card 默认折叠，显示工具名、摘要、状态和耗时；展开后显示最终输入与截断输出；
- 审批卡片内联出现在调用位置，pending 时提供明确操作；
- 跟随最新输出；用户主动上滚后暂停自动跟随并显示“回到最新”；
- 长代码和工具输出在卡片内部滚动或换行，不撑破主布局；
- 错误以可复制的操作性消息展示，不只依赖 toast。

### 12.3 Composer 与状态

- 空闲且 owner 时允许多行输入；Enter 提交，Shift+Enter 换行；
- 运行中输入禁用，显示停止按钮；不排队；
- 只读客户端显示“只读”与“接管控制权”；
- 顶部只读显示 provider/model、审批模式、thinking、工作区和 context 百分比；
- Provider、模型和 thinking 不提供编辑控件；
- 新建/恢复按钮在运行中禁用；
- 页面 refresh/reconnect 时显示连接状态，但不把短暂断线误报为 Agent 失败。

### 12.4 窄屏

桌面为验收主目标。窄屏隐藏常驻侧栏，改为会话抽屉；主 transcript、审批、停止和输入仍可用。不要求对手机键盘、手势和所有尺寸做同等优化。

## 13. 浏览器构建与发布

`webui/` 使用 React 19、TypeScript、CSS、`marked` 和 DOMPurify。使用 Bun 作为构建工具链，但浏览器代码不使用 Bun API。为避免把浏览器开发依赖加入主 CLI 运行依赖，`webui/` 拥有独立 `package.json` 和 `bun.lock`。

根构建流程先构建浏览器静态资源到 `dist/web/`，再构建 `dist/index.js` 和插件出口。npm `files` 增加 `dist/web/**`。这是一项明确的发布契约变化：Web 功能需要随包发布静态资源，CLI 不再是严格的单文件包，但 Node 主入口和插件出口保持原路径。

源码开发命令：

```text
just web-dev       构建/监听前端并启动本地 Web Agent
just web-check     前端 lint、typecheck、test、build
just build         构建 CLI、插件和 dist/web 静态资源
```

服务端通过相对 `import.meta.url` 解析发布版 `dist/web/`，并提供测试/开发覆盖路径。若静态资源缺失，`--web` 以配置错误退出；CLI/TUI/print 不受影响。

静态文件只允许 manifest 中的已知资源，不能把任意文件路径映射到磁盘。HTML 禁止缓存；带内容哈希的 JS/CSS 可 immutable 缓存。

## 14. 错误处理与恢复

- 应用初始化失败：服务保持运行并展示 fatal setup error；用户可在修复环境后重启进程，不自动降级 CLI；
- turn 失败：写入 error block，回到可再次提交的非 running 状态；
- 用户取消：AbortController 只取消当前 turn，不关闭服务；
- SSE 断开：Agent 继续；客户端指数退避重连并重新获取 snapshot；
- 浏览器 patch 断档：重新同步 snapshot；
- owner 请求竞态：服务端以当前 owner 和当前 revision/state 校验，失败返回 403/409；
- session 切换失败：进入明确错误状态，不保留半初始化应用；
- 自动打开浏览器失败：终端打印 URL 和警告，服务继续；
- 静态资源或协议版本不匹配：页面提示刷新/重启，不尝试执行旧协议动作；
- 服务关闭：所有 pending interaction fail closed，活动 turn 被取消。

服务端不把内部堆栈发送给浏览器；详细诊断写到启动终端，浏览器只接收稳定错误 code 和清理后的 message。

## 15. 测试策略

### 15.1 纯单元测试

- Web 参数解析、冲突、默认 host/port/open；
- loopback 判定、token 生成与常量时间校验；
- Host/Origin/Cookie/JSON content type 策略；
- protocol 请求运行时校验和错误映射；
- RuntimeEvent/recovered messages 到 WebSnapshot/patch；
- tool call 与 result 按 callId 合并；
- revision、patch gap 和高频 delta 合并；
- owner 获取、接管、刷新保持和旧 owner 拒绝；
- interaction 的允许、拒绝、abort、过期和危险操作限制；
- 会话只能 idle 切换和应用 dispose 顺序。

### 15.2 HTTP 集成测试

使用真实 Node HTTP client 和临时端口测试：

- 静态资源、health、state 和 SSE 首帧；
- POST turn/cancel/interaction/session 动作；
- 非 owner 403、busy 409、非法 body 400/413；
- SSE 心跳、重连 snapshot、慢客户端断开；
- loopback 不要求 token；
- `0.0.0.0` 模式缺 token 401、query token 交换 Cookie、无 token URL 重定向；
- Origin/Host 拒绝和不发送 CORS 头；
- 服务关闭时取消 turn 并解决交互。

Agent 行为使用注入的 fake application/runtime，不发送真实模型请求。

### 15.3 前端测试

使用 Vitest、Testing Library 和 jsdom 覆盖：

- snapshot 初始渲染和 patch reducer；
- 流式 Assistant 文本；
- tool card 折叠、输入输出和失败状态；
- permission/confirm 操作；
- owner 与只读/接管界面；
- 运行中 composer、取消和 idle 提交；
- 会话列表、新建、恢复和运行中禁用；
- SSE 断线、重连和 revision gap；
- Markdown HTML/script/link 清理；
- 错误、窄屏会话抽屉和基本键盘可访问性。

### 15.4 CLI、构建与发布回归

- CLI help 和中英文文案包含 experimental Web 参数；
- Web 参数冲突和裸 `--resume` 语义；
- `just check`；
- `just web-check`；
- `just build`；
- Node 22 执行 `dist/index.js --help`；
- 构建产物以临时工作区启动 `--web --no-open`，health 和首页可访问；
- `npm pack --dry-run` 包含 `dist/web/`，安装后的 Node artifact 能提供资源；
- `git diff --check`。

## 16. 文档更新

实现时同步：

- README 中英文：实验性定位、启动示例、默认 loopback、安全边界和非 loopback token；
- CLI help 与 i18n：`--web`、host、port、open 和安全警告；
- 官网中英文界面/安全/CLI 参考文档：增加 Web experimental 说明；
- 当前能力边界：接口由 CLI/TUI/print 扩展为 CLI/TUI/print/experimental Web；
- 安全说明：浏览器不是沙箱，工具仍拥有当前用户权限；非 loopback token 不提供加密。

## 17. 验收标准

1. `coden --web` 默认监听 `127.0.0.1` 的可用端口，打印 URL 并自动打开浏览器；`--no-open` 可禁用自动打开；
2. 默认 loopback 不要求 token；任意非 loopback 监听强制随机临时 token，未认证请求不能读取 UI、会话或 API；
3. Web 可以提交一个任务，流式显示回答、工具状态和错误，并能取消当前 turn；
4. 修改和危险工具的人工审批可在内联卡片中完成，危险操作不能会话级允许；
5. Tool card 默认折叠，可查看最终有效输入和截断输出；
6. Markdown 与代码正确显示，恶意 HTML、脚本和不安全链接不能执行；
7. 页面刷新或 owner 断开不取消 Agent；重连恢复权威状态且不重复执行；
8. 第一个客户端获得控制权，其他客户端只读并可接管；旧 owner 的后续修改请求被拒绝；
9. 当前工作区会话可列出、新建和恢复；运行中不能切换，服务端始终只有一个活动 Agent；
10. Provider、模型、thinking 和审批模式可见但不可在 Web 修改；
11. 桌面布局完整，窄屏仍可对话、停止、审批和打开会话抽屉；
12. CLI、TUI、print、插件、Skills、Hooks、权限、会话、trace 和现有配置行为无回归；
13. `just check`、`just web-check`、`just build` 和 Node 22 发布产物 Web smoke 全部通过；
14. npm 包包含所需 `dist/web/` 静态资源，不依赖源码目录、远程 CDN 或 Bun 运行时 API。
