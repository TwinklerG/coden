# CodeN 工具插件开发 Skill 设计

## 1. 背景与目标

CodeN 当前支持两种可执行的第三方工具插件：本地单文件 TypeScript 插件，以及通过公开 npmjs 分发的 ESM npm 插件。两者共享 `@twinklerg/coden/plugin` 公共契约，但在加载方式、模块结构、重载行为和分发验证方面存在不同约束。

本设计新增一个项目级 Agent Skill，帮助开发者从需求澄清开始，完成插件选型、实现、测试和交付验证。Skill 应优先使用 CodeN 的公开契约和仓库当前实现，避免生成依赖内部源码路径或尚未支持的扩展点。

## 2. 范围

Skill 覆盖：

- 本地 TypeScript 单工具插件；
- npm 单工具插件；
- npm 多工具 `CodeNPlugin`；
- 工具名称、JSON Schema、风险等级和执行结果设计；
- `ToolContext.workspace` 与 `ToolContext.signal` 的正确使用；
- 单元测试、类型检查和构建检查；
- 本地插件加载与 `/reload` 指导；
- npm 包元数据、构建产物、安装和发布前检查；
- 插件进程权限和生命周期脚本风险提示。

Skill 不覆盖：

- Provider、MCP Server、Slash Command、事件钩子或终端 UI 插件；
- 自动发布 npm 包；
- 自动执行破坏性安装或发布操作；
- Skill 有无启用时的对照评测或基准测试；
- 通用 npm/TypeScript 项目教学。

## 3. 仓库位置与跟踪策略

Skill 位于：

```text
.agents/skills/coden-tool-plugin-development/
```

当前 `.gitignore` 忽略整个 `.agents/skills/`。实施时应改为默认忽略其中内容，但明确放行：

```text
.agents/skills/coden-tool-plugin-development/
.agents/skills/coden-tool-plugin-development/**
```

这样仓库只跟踪官方插件开发 Skill，不会意外提交本地安装的 `skill-creator` 或其他第三方 Skill。由于 CodeN 会扫描项目的 `.agents/skills/`，开发者克隆仓库后可直接发现该 Skill。

## 4. 文件结构

采用渐进式披露结构：

```text
.agents/skills/coden-tool-plugin-development/
├── SKILL.md
├── references/
│   ├── api-contract.md
│   ├── local-plugin.md
│   └── npm-plugin.md
└── assets/
    ├── local-tool.ts
    ├── npm-single-tool.ts
    ├── npm-multi-tool.ts
    ├── npm-package.json
    └── npm-tsconfig.json
```

### 4.1 `SKILL.md`

`SKILL.md` 保持在 500 行以内，只包含触发描述、插件选型、端到端工作流、参考资料选择规则、验证要求和最终报告格式。

Skill 名称为 `coden-tool-plugin-development`。描述应主动覆盖以下意图：创建、修改、调试或发布 CodeN 工具插件，以及用户提到本地 TypeScript 插件、npm 插件、`ToolDefinition` 或 `CodeNPlugin` 的场景。

### 4.2 `references/`

- `api-contract.md`：记录公共 API v1、字段语义、名称规则、输入 Schema、返回值、风险等级、取消信号及安全边界。
- `local-plugin.md`：记录扫描位置、项目信任、自包含单文件限制、禁止相对导入、加载和 `/reload` 流程。
- `npm-plugin.md`：记录 ESM 包结构、`coden` 元数据、单工具与多工具导出、构建、测试、`npm pack --dry-run`、安装和重启要求。

`SKILL.md` 要求智能体只读取当前任务所需的参考文件；公共契约文件在两类插件任务中均需读取。

### 4.3 `assets/`

模板提供可复制的最小起点，不作为不可修改的固定输出：

- 本地单工具入口；
- npm 单工具入口；
- npm 多工具入口；
- npm `package.json`；
- npm TypeScript 配置。

模板使用标准 Web/Node.js API 和 TypeScript，使用 Bun 作为推荐工具链，但不使用 Bun 专有运行时 API。所有类型均从 `@twinklerg/coden/plugin` 导入，不引用 `src/` 或未公开的包主入口。

## 5. Skill 工作流

### 5.1 判断插件形式

智能体首先确认目标：

- 仅供个人或当前项目使用、需要快速调试和 `/reload`：选择本地插件；
- 需要多个源码文件、语义化版本、团队复用或公开分发：选择 npm 插件；
- 需求只是操作指南而非新增可调用能力：提醒用户考虑 Agent Skill，而不是工具插件。

若用户已明确形式，不重复询问。

### 5.2 澄清工具契约

实现前明确：

- 工具名称和用途；
- 输入字段、必填项及约束；
- 成功输出和失败输出；
- 是否读取或修改外部状态；
- `risk` 应为 `read`、`modify` 还是 `dangerous`；
- 是否需要超时或取消协作；
- npm 插件是单工具还是多工具。

### 5.3 检查目标项目

智能体先检查目标目录现有的 `package.json`、TypeScript 配置、测试框架和命令运行约定，复用现有工具链。只有在缺失时才创建最小配置，不覆盖无关设置。

若在 CodeN 仓库内开发，应以 `src/plugin/index.ts` 为契约来源；若在外部项目开发，应以已安装版本的 `@twinklerg/coden/plugin` 类型声明为准。

### 5.4 实现

实现遵循以下原则：

- 使用严格且封闭的 JSON Schema，通常设置 `additionalProperties: false`；
- 不信任 `unknown` 输入，在 Schema 验证之外仍进行必要的类型收窄；
- 将预期失败返回为 `{ content, isError: true }`，让异常保留给非预期故障；
- 对长耗时工作检查 `context.signal`，并把信号传给支持 `AbortSignal` 的 API；
- 避免模块顶层副作用；
- 不在日志或错误信息中泄露密钥；
- 不用 `risk: "read"` 掩盖写文件、网络修改或子进程副作用。

### 5.5 测试

每个工具至少覆盖：

- 一个成功路径；
- 一个无效输入或预期失败路径；
- 存在异步或长耗时工作时的取消路径；
- 有副作用时验证 `risk` 与行为一致。

测试直接导入工具定义并调用 `execute()`，使用临时目录作为 `workspace`，使用 `AbortController` 构造 `signal`。不得依赖真实密钥或默认访问外部网络。

### 5.6 验证本地插件

本地插件验证包括：

- 入口是单个 `.ts` 文件；
- 默认导出一个 `ToolDefinition`；
- 不存在相对运行时导入；
- 工具名称和 JSON Schema 有效；
- 类型检查及测试通过；
- 给出放置目录、启动和 `/reload` 指令；
- 提醒项目插件首次加载需要信任确认。

### 5.7 验证 npm 插件

npm 插件验证包括：

- `package.json` 包含 `type: "module"`；
- `coden.apiVersion` 为 `1`；
- `coden.plugin` 指向包内构建后的 `.js` 或 `.mjs`；
- `files` 包含运行所需构建产物；
- 单工具默认导出 `ToolDefinition`，或多工具默认导出 `CodeNPlugin`；
- 多工具插件的 `name` 与 npm 包名完全一致；
- `@twinklerg/coden` 仅作为开发期类型依赖；
- 类型检查、测试和构建通过；
- 使用 `npm pack --dry-run` 或等价的无发布检查确认包内容；
- 给出 `coden plugin install npm:<package>`、`list`、`sync` 和重启说明。

Skill 不自动执行 `npm publish`。发布必须由用户明确发起。

## 6. 错误处理与安全边界

当用户要求当前 API 不支持的扩展点时，Skill 应明确说明限制，不伪造接口。发现契约与参考文件不一致时，以目标 CodeN 版本公开导出的类型和实际包元数据为准，并报告差异。

本地和 npm 插件都运行在 CodeN 主进程中，拥有当前用户权限。最终指导必须说明：

- `risk` 影响授权确认，不提供沙箱；
- npm 安装默认应禁用生命周期脚本；
- 即使禁用生命周期脚本，导入入口时的顶层代码仍会执行；
- `--allow-scripts`、安装、删除和发布均不得在没有用户确认时执行。

## 7. 最终交付报告

Skill 要求智能体在任务结束时简要报告：

1. 选择的插件形式及原因；
2. 创建或修改的文件；
3. 注册的工具名称和风险等级；
4. 已运行的检查及结果；
5. 本地加载或 npm 安装命令；
6. 尚未验证的事项和安全注意点。

## 8. 验收标准

实施完成后应满足：

- CodeN 能发现并激活该项目级 Skill；
- Skill frontmatter 名称与目录名一致，描述能覆盖两类插件开发意图；
- `SKILL.md` 使用渐进式披露，并明确何时读取各参考文件和模板；
- 本地插件指导与当前单文件加载器约束一致；
- npm 插件指导与 API v1、包元数据和安装命令一致；
- 模板不使用内部导入或 Bun 专有 API；
- Skill 包含实现、测试、构建和交付验证，而不仅是脚手架；
- `.gitignore` 只放行该 Skill；
- Biome、TypeScript、测试和构建检查保持通过；
- 不创建或运行 Skill 对照评测。
