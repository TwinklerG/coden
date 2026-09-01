# CodeN

[中文](README.md) | [English](README.en.md)

<!-- markdownlint-disable MD013 -->

**一个以可插拔工具插件为特色的 Coding Agent。**

CodeN 直接使用模型原生 Tool Calling，在本地读取、修改文件和执行命令。它保持 Agent 核心小而透明，让你既能完成真实编码任务，也能理解并塑造模型请求、工具调用、权限、上下文和会话如何协作。

## 应用特色

- **可插拔工具**：用本地 TypeScript 或 npm 插件扩展模型的行动空间。
- **机制透明**：Agent 循环、上下文压缩、审批和会话恢复都有明确边界。
- **组合式扩展**：Plugin 增加动作，Skill 提供方法知识，Hook 加入确定性生命周期控制。
- **本地优先**：代码和工具在当前机器运行，不依赖服务端代码执行。

## 快速开始

```bash
bun add -g @twinklerg/coden     # 或 npm install -g @twinklerg/coden
export CODEN_OPENAI_API_KEY=...
coden "检查当前项目，修复失败的测试并验证结果"
```

发布版 CLI 需要 **Node.js 22+**。`coden` 默认进入连续输出 CLI/REPL；使用 `coden --tui` 显式启动全屏 TUI，使用 `coden -p --auto "..."` 进行单轮、可管道化执行。实验性 Web 界面通过 `coden --web` 启动：默认监听 `127.0.0.1` 的随机端口并打开浏览器，Provider、模型、thinking 与语言继承启动配置且只读。

```bash
export CODEN_ANTHROPIC_API_KEY=...
coden --provider anthropic --model claude-sonnet-4-20250514

coden --smart-approve "重构这个模块并运行测试"
coden --resume                 # 列出当前工作区会话
coden --resume <session-id>    # 恢复指定会话

coden --web                    # 实验性本地 Web 界面
coden --web --no-open
coden --web --web-host 0.0.0.0 # 强制临时 token；不提供 TLS
```

完整安装、Provider、界面和运行时说明见[快速开始](https://twinklerg.github.io/coden/zh/docs/start/overview/)。

## 用工具插件塑造 Agent

工具插件把新的结构化动作加入模型可调用的工具集。npm 插件使用 `@twinklerg/coden/plugin` 公开契约：

```ts
import type { ToolDefinition } from "@twinklerg/coden/plugin";

const tool: ToolDefinition = {
  name: "line_count",
  description: "Count lines in supplied text",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async execute(input) {
    const { text } = input as { text: string };
    return { content: String(text.split("\n").length) };
  },
};

export default tool;
```

```bash
coden plugin install npm:@scope/coden-plugin-example
coden plugin list
coden plugin sync
```

- **本地 `.ts` 插件**适合快速实验，需要 Bun，并且当前必须是自包含单文件。
- **npm 插件**发布构建后的 ESM；加载可由 Node 或 Bun 完成，但安装与同步内部调用 `bun install`。
- 插件安装或更新后需要重启；`/reload` 只保证重载本地 TypeScript 插件。

详见[工具插件执行模型](https://twinklerg.github.io/coden/zh/docs/extend/tool-plugins/)、[插件作者指南](https://twinklerg.github.io/coden/zh/docs/extend/plugin-authoring/)和[插件市场](https://twinklerg.github.io/coden/zh/plugins/)。

## 选择扩展机制

| 目标 | 机制 | 改变的层面 |
| --- | --- | --- |
| 给模型新增可调用能力 | Tool Plugin | Agent 的行动空间 |
| 教模型执行专业流程 | Skill | Agent 的方法与上下文 |
| 在生命周期事件中执行确定性逻辑 | Hook | 运行时控制与策略 |
| 为项目提供长期约束 | `AGENTS.md` | 启动上下文与行为约定 |

参见[选择扩展机制](https://twinklerg.github.io/coden/zh/docs/extend/choose-an-extension/)。

## 当前能力边界

- Provider：OpenAI 与 Anthropic；模型 ID 由用户指定。
- 内置工具：`read`、`write`、`edit`、`bash`，存在有效 Skill 时还提供 `activate_skill`。
- 审批：manual、Smart Approval 和 auto；它们是审批策略，不是沙箱等级。
- 会话：按工作区保存 JSONL，可恢复对话、thinking level 和 Provider 状态。
- 接口：默认 CLI/REPL、显式 TUI、单轮 print 模式，以及实验性本地 Web 界面。
- CodeN 当前没有内置子 Agent、MCP、计划模式或通用安全沙箱。

## 安全

**`bash`、工具插件和 Hook 都以当前用户进程权限运行，不是安全沙箱。** 项目插件和项目 Hook 需要工作区信任，但信任确认、工具 `risk`、Smart Approval 和 `--auto` 都不能隔离恶意代码。只安装和执行你愿意以当前账户运行的代码；需要强隔离时，请在容器、虚拟机或受限账户中运行 CodeN。

Web 界面不是沙箱：工具、Hook 与插件仍以当前用户权限运行。非 loopback 监听会强制使用进程级临时 token，但 token 不加密网络流量；跨不可信网络请优先使用 SSH tunnel 或可信反向代理。

会话和 trace 可能包含提示词、源码、工具输入输出和模型推理。请保持本地私有权限，不要未经审查地分享。详见[安全边界](https://twinklerg.github.io/coden/zh/docs/safety/security-boundaries/)。

## 文档与开发

- [中文文档](https://twinklerg.github.io/coden/zh/docs/)
- [English documentation](https://twinklerg.github.io/coden/en/docs/)
- [插件市场](https://twinklerg.github.io/coden/zh/plugins/)
- [插件协议参考](https://twinklerg.github.io/coden/zh/docs/reference/plugins/)

```bash
git clone https://github.com/TwinklerG/CodeN.git
cd CodeN
bun install
just check
just website-check
just build
```

仓库使用 Just 作为命令入口、Bun 作为 JS/TS 工具链、Biome 作为 Linter 与 Formatter；源码避免依赖 Bun 专有 API。MIT License。
