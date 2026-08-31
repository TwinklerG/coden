# CodeN 专业文档与产品定位重构设计

## 背景

CodeN 当前拥有一套中英双语官网文档，覆盖 50 个主题（共 100 个 MDX 页面），以及中英文 README、官网首页、插件市场和 npm 元数据。现有内容已记录大量命令和实现细节，但整体仍偏参考手册：读者能查到配置，却不容易形成对 Coding Agent 运行机制、扩展边界和安全模型的完整认识。

现有定位也主要使用“极简编程智能体”或 “minimal event-driven coding agent”。该表述没有突出 CodeN 最具辨识度的能力：用户可以通过工具插件改变 Agent 的行动空间，并通过 Skills 与 Hooks 塑造工作方式和运行策略。部分中英文内容还存在事实漂移，例如英文 README 将 TUI 描述为默认界面，而当前 `resolveInterfaceMode` 的默认行为仍是 CLI。

本次工作将全量重构文档信息架构与正文，并同步更新 README、官网入口和包元数据。外部 Coding Agent 文档只用于学习信息组织与渐进披露方式；CodeN 的行为事实只来自当前仓库源码、测试和构建产物。

## 目标

1. 将 CodeN 定位为“一个有意思的 Coding Agent，以可插拔工具插件为特色”。
2. 面向极客和专业用户解释 Agent 循环、上下文、工具、权限、会话和 Provider 状态，而不只罗列操作步骤。
3. 把工具插件作为首要产品特色，准确解释 Plugins、Skills、Hooks 和 `AGENTS.md` 改变 Agent 的不同层面。
4. 采用“心智模型 → 当前实现 → 使用方式 → 边界与失败模式 → 实现注记”的分层内容结构。
5. 允许重组、合并、新增和删除文档页面，只要求最终站点路由、导航和链接完整有效。
6. 保持中英文文档在页面库存、代码、协议、链接和事实上的完整对等。
7. 用源码、测试和构建产物验证所有公开声明，删除无法证明或超出当前实现的描述。
8. 将 README 收敛为简洁的产品入口，把详细手册内容迁移到官网文档。

## 非目标

- 不新增或修改 Agent、插件、Skills、Hooks、权限或界面功能。
- 不宣称与 Claude Code、pi coding agent 或其他产品兼容，也不做横向优劣比较。
- 不把未实现的子 Agent、MCP、计划模式、通用沙箱或任意插件源写成现有能力。
- 不为被删除的旧文档 URL 提供重定向承诺；只保证仓库内和最终发布站点的链接正确。
- 不把所有内部实现细节都提升为永久公共 API；正文区分稳定行为与实现注记。

## 产品定位

统一的核心定位是：

> CodeN 是一个有意思的 Coding Agent：核心小而透明，直接运行模型原生 Tool Calling，并允许专业用户通过可插拔工具、Skills 与 Hooks 塑造 Agent 的能力和工作流。

“有意思”必须落到可验证的产品属性，而不是人格化营销：

- **可探索**：读者能够理解 Agent 循环、上下文、工具、权限与会话如何协作。
- **可塑造**：工具插件扩展“能做什么”，Skills 扩展“如何做”，Hooks 在生命周期边界加入确定性控制。
- **可验证**：文档明确实现事实、限制、失败模式与非沙箱边界。

各入口可根据语境使用不同长度的表达：

- 中文短句：`一个有意思的 Coding Agent，以可插拔工具插件为特色。`
- 英文短句：`A hackable coding agent built around pluggable tool plugins.`
- 长说明补充“小而透明、可探索、可塑造、直接使用模型原生 Tool Calling”。

不再把“极简”作为首要卖点；它只在解释核心实现规模与设计取向时出现。

## 信息架构

`website/src/data/docs.ts` 将成为新文档库存与导航顺序的唯一清单。允许改变现有 50 个主题的数量和 URL。新的顶层结构为：

### 1. 开始

回答 CodeN 是什么，以及怎样安全完成第一个真实任务：

- CodeN 的定位、设计取向和明确边界
- 运行时要求与 Node/Bun 能力差异
- 安装与升级
- Provider 和模型配置
- CLI、TUI 与 print 模式选择
- 第一个专业任务及验证方式

### 2. 理解 Agent

建立 Coding Agent 的完整心智模型：

- 从用户输入到最终回答的 Agent 循环
- turn、model step、assistant tool call 和 tool result 的关系
- 工具定义如何进入 Provider 请求
- 消息、上下文预算、自动压缩和紧急压缩
- thinking level 与 Provider 状态映射
- 会话持久化、恢复和中断工具调用补齐
- 重试、取消、step limit、Stop Hook 与失败传播

### 3. 塑造 Agent

作为文档核心章节，解释扩展边界并以工具插件为主线：

- 扩展机制选择：Plugins、Skills、Hooks、`AGENTS.md`
- 工具插件执行模型
- 本地 TypeScript 插件
- npm 插件安装、同步与作用域
- 插件作者协议和公共类型
- 插件发现、冲突、重载、超时与取消
- Skill 的发现、渐进披露、创建与调试
- Hook 生命周期、匹配、I/O、决策和失败语义

### 4. 控制与安全

把审批策略与安全边界放在同一心智模型中：

- 工作区与真实路径分类
- 工作区信任及项目代码边界
- manual、smart、auto 审批策略
- 工具风险等级和危险命令启发式识别
- 工作区外访问
- 插件、Hook、bash 和凭据的数据/进程权限
- 为什么审批模式不是沙箱等级

### 5. 配置与运行

覆盖日常使用、部署和运维：

- 用户级、项目级、环境变量与 CLI 优先级
- OpenAI、Anthropic 和自定义 OpenAI Base URL
- 语言与 thinking level
- 会话和 trace 存储
- CI、脚本和非交互运行
- 故障诊断与恢复路径

### 6. 协议参考

为需要精确契约的用户提供可检索参考：

- CLI 与退出码
- 完整配置字段和环境变量
- 插件 manifest、导出形态、JSON Schema 与错误码
- Hook 事件顺序、stdin/stdout、退出码和决策合并
- 会话存储格式中稳定且适合公开的部分
- Node/Bun 运行时能力矩阵
- 安全模型与已知限制

旧页面被删除或改名时，必须先迁移 `website/src/content/`、官网产品页面、README 和测试中的所有站内引用。最终构建不得包含指向旧 URL 的链接。

## 页面内容模型

专业主题页按以下顺序组织；并非每页必须机械包含全部标题，但必须覆盖适用的层次：

1. **心智模型**：该机制解决什么 Agent 问题，以及它与其他机制的关系。
2. **CodeN 的实现**：当前版本真实的执行顺序、状态变化和组件边界。
3. **使用方式**：可运行的命令、配置、代码和观察方法。
4. **边界与失败模式**：不支持项、降级、错误、安全风险和恢复行为。
5. **实现注记**：默认值、限制、错误码、存储格式等较底层但已验证的细节。
6. **相关参考**：指向站内概念页或协议页；必要时标出源码模块名称。

“实现注记”不是稳定性承诺。页面需要把公共行为、协议要求和内部实现观察明确区分，避免读者误把所有内部常量当作长期 API。

## 扩展机制叙事

扩展机制首先通过决策表说明：

| 用户目标 | 使用机制 | 改变的层面 |
| --- | --- | --- |
| 给模型新增可调用能力 | Tool Plugin | Agent 的行动空间 |
| 教模型执行专业流程 | Skill | Agent 的方法与上下文 |
| 在生命周期中执行确定性逻辑 | Hook | 运行时控制与策略 |
| 提供项目长期约束 | `AGENTS.md` | 启动上下文与行为约定 |

工具插件章节必须覆盖完整执行路径：

1. Registry 汇集内置、本地和 npm 工具。
2. 工具名称、描述和 input schema 随模型请求发送给 Provider。
3. 模型返回结构化 tool call。
4. CodeN 执行 Hook、schema、路径、风险和权限相关检查。
5. 工具收到 `ToolContext` 和 `AbortSignal` 后执行。
6. 结果或错误作为 tool message 回到上下文，触发下一次模型请求。

具体文字必须以当前执行器和 Hook 引擎的真实顺序为准，实施阶段不得仅根据上述概念摘要推断。

插件文档还必须明确：

- `risk` 影响 CodeN 的审批策略，不提供操作系统隔离。
- 本地 `.ts` 插件适合快速实验，但受自包含单文件和 Bun 运行时约束。
- npm 插件适合构建后分发，加载可在 Node 下工作，但安装/同步内部需要 Bun。
- 插件入口导入会执行顶层代码；关闭 npm 生命周期脚本不等于插件安全。
- 项目插件和项目 Hook 受工作区信任控制；`--auto` 不隐式建立信任。
- `AbortSignal` 只能要求插件协作取消，无法强制终止忽略信号的主进程插件。
- `/reload` 对本地源码插件与 npm 模块缓存具有不同保证。

## Agent 深度主题

“理解 Agent”章节必须准确解释以下区别和相互作用：

- 一个用户 turn 可以包含多个 model step；每个 step 可能产生文本、推理状态和工具调用。
- 工具调用结果成为下一次请求的上下文，而不是由 CodeN 自行解释为最终答案。
- 多工具调用按当前实现顺序执行，不能暗示并行。
- Provider 重试与工具循环是不同层级。
- 上下文压缩有损；确定性摘要、模型精炼和紧急压缩有不同触发路径。
- thinking level 是 CodeN 对 Provider 参数的统一映射，不是模型能力检测或保证。
- Provider-specific thinking/signature 状态与普通可见文本不同，并随匹配 Provider 的会话恢复。
- session 保存对话和运行状态，但不等同于进程快照。
- manual、smart、auto 是审批策略，不是逐级增强的安全沙箱。

所有默认值、阈值、重试次数、错误码和存储细节在实施时重新对照源码和测试，不沿用现有文档中的未复核表述。

## README 与其他定位入口

### README

`README.md` 和 `README.en.md` 改为简洁产品入口，结构保持一致：

1. 一句话定位
2. CodeN 为什么有意思
3. 30 秒安装与首个任务
4. 最小工具插件示例
5. Plugins、Skills、Hooks 的选择说明
6. 核心能力与明确限制
7. 安全警告
8. 官网文档、插件市场、开发和贡献链接

当前 README 中的完整配置、TUI 键位、thinking 映射、插件 ABI、Hook 协议等内容迁移到官网文档，避免两套长篇参考同时漂移。README 保留的每个命令和行为仍需验证。

### 其他入口

同步审计并更新：

- 根 `package.json` description
- 官网中英文首页标题、副标题、能力卡片和 CTA
- 文档首页与 FAQ
- 插件市场介绍和导航描述
- SEO description 及其他用户可见元数据
- 仓库中仍以“极简 / minimal event-driven agent”为主定位的公开文本

实现阶段通过全文搜索发现定位入口，不假定上述列表穷尽所有位置。

## 事实来源与审计方法

CodeN 行为只接受以下本地证据：

| 事实类别 | 首要证据 | 交叉验证 |
| --- | --- | --- |
| CLI、模式和退出行为 | CLI 命令定义、模式解析 | `--help`、CLI/界面测试、构建产物冒烟 |
| Agent 循环 | runtime、context、events | runtime/context 集成测试 |
| 配置 | 配置解析、默认值与校验 | config 测试 |
| Providers/thinking | Provider adapter、thinking 映射 | provider/thinking 测试 |
| 工具与权限 | registry、executor、policy | tools/permissions/tool-hooks 测试 |
| 插件 | loader、installer、manifest、公共类型 | plugins 测试、Node/Bun 构建产物实验 |
| Skills | discovery、parser、prompt | skills 测试 |
| Hooks | config、engine、command runner | hooks 测试 |
| 会话 | session store、context manager | context-session/runtime 测试 |
| TUI/CLI 交互 | interface mode、controller、editor | TUI、REPL、PTY 测试 |

外部 Claude Code 和 pi coding agent 文档只用于学习这些组织原则：快速入口、心智模型优先、扩展机制决策、进阶协议下沉和明确安全警告。正文不引用外部行为来证明 CodeN，也不频繁点名或比较外部产品。

无法由源码、测试或构建实验证明的说法必须删除或改成明确的限制。实验性、启发式、Provider-dependent 和非沙箱行为必须使用清晰措辞标注。

## 双语策略

- 中英文页面集合、导航层级和 sidebar order 完全一致。
- 代码块、命令、配置、路径、错误码和协议字段逐字符一致。
- 内部链接在去除语言前缀后完全对应，且全部使用当前 `BASE_PATH` 的绝对路径。
- 表格行和事实语义保持一致。
- 中文使用准确直接的专业技术表达；英文按自然技术英语独立撰写，不要求正文逐句同构。
- 页面标题和 description 同时更新 `website/src/data/docs.ts` 与 MDX frontmatter，避免导航和页面元数据漂移。

## 测试与发布验收

现有文档库存和内容测试需要适配新信息架构，并保留以下保障：

1. `website/src/data/docs.ts` 中每个页面都有 zh/en 两份 MDX，且不存在 unexpected 文件。
2. 双语代码块逐字符一致。
3. 双语内部链接经语言归一化后完全一致。
4. 所有文档链接使用 `BASE_PATH` 感知的绝对路径，并解析到实际文档或允许的产品路由。
5. 页面包含实质内容，不含 scaffold、TBD 或 TODO 标记。
6. 构建站点不存在内部 404。

新增关键事实防漂移测试或等价验证，至少覆盖：

- 默认界面为 CLI，只有显式 `--tui` 才请求 TUI。
- 当前内置 Provider 为 OpenAI 和 Anthropic。
- 当前内置工具集合及 `activate_skill` 的条件性行为。
- 发布版 Node 运行、本地 TypeScript 插件、npm 插件加载和 npm 安装/同步的能力矩阵。
- Plugins、Skills、Hooks 的边界没有被文案混淆。
- `bash`、插件和 Hook 不是安全沙箱。
- 中英文与官网入口使用新的核心定位。

实现完成后的验证顺序：

1. 文档库存、内容、双语和链接测试。
2. `just website-check`（或仓库中等价的完整 website 命令）。
3. 根项目 `just check`。
4. `just build`。
5. 使用 Node 对发布产物执行 `--help` 和 `--version` 冒烟测试。
6. 构建站点路由/链接检查与 `git diff --check`。

若事实审计发现当前文档与实现冲突，应修正文档而不是为了保留文案改变产品行为。若测试本身错误地固化旧文案或旧路由，则随新设计更新测试。

## 迁移与工作区安全

实施开始前重新记录 `git status --short`。当前设计阶段工作区在新增本设计文档前为干净状态。后续若出现用户已有修改，必须保留并区分，不得覆盖或回滚。

迁移按以下顺序进行：

1. 建立实现事实清单和新页面清单。
2. 更新文档索引/导航数据。
3. 创建新中英文页面并迁移仍有效内容。
4. 更新所有站内链接和产品入口。
5. 删除不再列入库存的旧页面。
6. 更新测试并执行完整验证。

任何阶段都不允许发布仅有导航条目而没有实质正文的 scaffold 页面。

## 成功标准

- 新读者能从首页理解 CodeN 的定位、扩展特色和非沙箱边界。
- 专业用户能从文档准确推导一个 turn 内模型请求、工具执行、权限判断、Hook 和上下文演进的关系。
- 插件作者能仅依赖公开文档和 `@twinklerg/coden/plugin` 契约构建、验证和分发当前受支持的插件。
- 用户能明确选择 Plugin、Skill、Hook 或 `AGENTS.md`，而不会混淆它们的职责。
- README 简洁、事实正确，不再复制整套参考手册。
- 所有中英文页面、导航、代码、链接、公开定位和构建产物验证通过。
- 文档不包含超出 CodeN 当前实现的能力承诺。
