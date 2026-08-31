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
      intro: "本地优先 · 模型原生 Tool Calling",
      title: "CodeN",
      description: "在本地工作区中安装、审查、编辑和验证代码，保留完整的审批和会话控制。",
    },
    features: [
      {
        tag: "Local-first",
        title: "直接操作工作区",
        description: "围绕当前仓库读写文件，而不是绕一层抽象任务面板。",
      },
      {
        tag: "Approval",
        title: "明确的风险控制",
        description: "使用 manual、smart 和 auto 审批模式把权限边界说清楚。",
      },
      {
        tag: "Interfaces",
        title: "CLI、TUI 和 print",
        description: "同一套 Agent 能切换命令行、全屏终端和纯输出模式。",
      },
      {
        tag: "Skills",
        title: "Skills 与插件",
        description: "通过本地 Skill 与 npm 插件扩展工作流，而不是引入后台服务。",
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
      intro: "Local-first · model-native tool calling",
      title: "CodeN",
      description:
        "Install, inspect, edit, and verify code inside the local workspace with clear approval and session control.",
    },
    features: [
      {
        tag: "Local-first",
        title: "Operate on the workspace directly",
        description:
          "Read and write files in the current repo without a separate task layer in the middle.",
      },
      {
        tag: "Approval",
        title: "Explicit risk control",
        description:
          "Use manual, smart, and auto approval modes to keep permission boundaries visible.",
      },
      {
        tag: "Interfaces",
        title: "CLI, TUI, and print",
        description:
          "Switch the same agent between command line, full-screen terminal, and output-only modes.",
      },
      {
        tag: "Skills",
        title: "Skills and plugins",
        description:
          "Extend workflows with local skills and npm plugins instead of backend services.",
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
