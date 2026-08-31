import type { Language } from "../lib/site";

export interface HomeFeature {
  title: string;
  description: string;
  tag: string;
}

export interface HomeStep {
  title: string;
  description: string;
}

export interface HomeTerminalPanel {
  title: string;
  lines: string[];
}

export interface HomeContent {
  hero: {
    intro: string;
    title: string;
    description: string;
  };
  features: HomeFeature[];
  steps: HomeStep[];
  terminal: {
    cli: HomeTerminalPanel;
    tui: HomeTerminalPanel;
  };
}

export const HOME_CONTENT: Record<Language, HomeContent> = {
  zh: {
    hero: {
      intro: "可插拔工具插件 · 模型原生 Tool Calling",
      title: "CodeN",
      description:
        "一个有意思的 Coding Agent：核心小而透明，可在本地工作区中观察并塑造完整工具循环。",
    },
    features: [
      {
        tag: "Plugins",
        title: "扩展 Agent 的行动空间",
        description: "用本地 TypeScript 或 npm 工具插件，把专业能力直接加入模型可调用的工具集。",
      },
      {
        tag: "Agent loop",
        title: "看清每一次工具循环",
        description: "理解模型请求、Schema 校验、审批、执行、结果回传与上下文演进。",
      },
      {
        tag: "Interfaces",
        title: "CLI、TUI 和 print",
        description: "同一套 Agent 能切换命令行、全屏终端和纯输出模式。",
      },
      {
        tag: "Composable",
        title: "Plugins、Skills 与 Hooks",
        description: "分别扩展行动、方法知识和确定性生命周期控制，不把不同信任层混在一起。",
      },
      {
        tag: "Sessions",
        title: "恢复会话和上下文",
        description: "保留对话状态、上下文压缩和思考等级，便于长任务接续。",
      },
      {
        tag: "Hooks",
        title: "可审计的 Hook 流程",
        description: "通过 Agent Hooks 统一接入提示、权限与工具调用事件。",
      },
    ],
    steps: [
      {
        title: "安装 CodeN",
        description: "先执行 bun add -g @twinklerg/coden。",
      },
      {
        title: "配置 Provider",
        description: "补齐 API key、模型和审批模式。",
      },
      {
        title: "进入项目目录运行",
        description: "在仓库里直接启动 coden 并开始协作。",
      },
    ],
    terminal: {
      cli: {
        title: "CLI 启动横幅",
        lines: [
          "Model: gpt-5-mini",
          "Approval mode: manual",
          "Thinking level: default",
          "Session ID: 01a056d9",
          "User: Refactor the hook loader and keep the docs scaffold intact.",
          "Tool: Read src/lib/routes.ts",
          "Tool: Edit website/src/components/home/TerminalDemo.tsx",
          "Tool: Test passes",
          "Done: changes validated locally.",
        ],
      },
      tui: {
        title: "TUI 全屏缩略",
        lines: [
          "Provider: OpenAI",
          "Model: gpt-5-mini",
          "Workspace: /Users/gl/Documents/CodeN",
          "Approval: manual",
          "Phase: waiting for user input",
          "Context: compact",
          "Input: _",
        ],
      },
    },
  },
  en: {
    hero: {
      intro: "Pluggable tool plugins · model-native tool calling",
      title: "CodeN",
      description:
        "A hackable coding agent with a small, inspectable core for observing and shaping complete tool loops in a local workspace.",
    },
    features: [
      {
        tag: "Plugins",
        title: "Extend the agent's action space",
        description:
          "Add specialized capabilities directly to the model's tool set with local TypeScript or npm tool plugins.",
      },
      {
        tag: "Agent loop",
        title: "Inspect every tool loop",
        description:
          "Understand model requests, schema validation, approval, execution, result replay, and context evolution.",
      },
      {
        tag: "Interfaces",
        title: "CLI, TUI, and print",
        description:
          "Switch the same agent between command line, full-screen terminal, and output-only modes.",
      },
      {
        tag: "Composable",
        title: "Plugins, Skills, and Hooks",
        description:
          "Extend actions, method knowledge, and deterministic lifecycle control without mixing trust layers.",
      },
      {
        tag: "Sessions",
        title: "Restore sessions and context",
        description:
          "Keep conversation state, context compression, and thinking levels for longer jobs.",
      },
      {
        tag: "Hooks",
        title: "Auditable hook flow",
        description: "Use Agent Hooks to unify prompt, permission, and tool-call events.",
      },
    ],
    steps: [
      {
        title: "Install CodeN",
        description: "Start with bun add -g @twinklerg/coden.",
      },
      {
        title: "Configure a provider",
        description: "Set the API key, model, and approval mode.",
      },
      {
        title: "Run it in a project",
        description: "Launch coden directly inside the repo and start collaborating.",
      },
    ],
    terminal: {
      cli: {
        title: "CLI startup banner",
        lines: [
          "Model: gpt-5-mini",
          "Approval mode: manual",
          "Thinking level: default",
          "Session ID: 01a056d9",
          "User: Refactor the hook loader and keep the docs scaffold intact.",
          "Tool: Read src/lib/routes.ts",
          "Tool: Edit website/src/components/home/TerminalDemo.tsx",
          "Tool: Test passes",
          "Done: changes validated locally.",
        ],
      },
      tui: {
        title: "TUI full-screen miniature",
        lines: [
          "Provider: OpenAI",
          "Model: gpt-5-mini",
          "Workspace: /Users/gl/Documents/CodeN",
          "Approval: manual",
          "Phase: waiting for user input",
          "Context: compact",
          "Input: _",
        ],
      },
    },
  },
};
