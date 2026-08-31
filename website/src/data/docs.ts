export interface DocLocaleMeta {
  title: string;
  description: string;
}

export interface DocPage {
  slug: string;
  order: number;
  zh: DocLocaleMeta;
  en: DocLocaleMeta;
}

export interface DocGroup {
  slug: string;
  order: number;
  zh: DocLocaleMeta;
  en: DocLocaleMeta;
  pages: Array<{
    slug: string;
    order: number;
    zh: DocLocaleMeta;
    en: DocLocaleMeta;
  }>;
}

const DOC_INDEX: DocPage = {
  slug: "index",
  order: 0,
  zh: {
    title: "CodeN 文档",
    description: "CodeN 文档结构与导航入口。",
  },
  en: {
    title: "CodeN Docs",
    description: "CodeN documentation structure and navigation hub.",
  },
};

function createPage(
  slug: string,
  order: number,
  zhTitle: string,
  zhDescription: string,
  enTitle: string,
  enDescription: string,
): DocGroup["pages"][number] {
  return {
    slug,
    order,
    zh: { title: zhTitle, description: zhDescription },
    en: { title: enTitle, description: enDescription },
  };
}

function createGroup(
  slug: string,
  order: number,
  zhTitle: string,
  zhDescription: string,
  enTitle: string,
  enDescription: string,
  pages: DocGroup["pages"],
): DocGroup {
  return {
    slug,
    order,
    zh: { title: zhTitle, description: zhDescription },
    en: { title: enTitle, description: enDescription },
    pages,
  };
}

export const DOC_GROUPS: DocGroup[] = [
  createGroup(
    "getting-started",
    100,
    "快速入门",
    "从安装到首次任务的上手路径。",
    "Getting Started",
    "The setup path from installation to a first task.",
    [
      createPage(
        "requirements",
        110,
        "安装要求",
        "列出运行 CodeN 所需的基础环境。",
        "Requirements",
        "Lists the basic environment required to run CodeN.",
      ),
      createPage(
        "installation",
        120,
        "安装 CodeN",
        "说明如何在本地安装 CodeN。",
        "Install CodeN",
        "Explains how to install CodeN locally.",
      ),
      createPage(
        "provider",
        130,
        "配置第一个 Provider",
        "介绍如何配置第一个模型提供方。",
        "Configure Your First Provider",
        "Introduces the first model provider setup.",
      ),
      createPage(
        "interfaces",
        140,
        "启动 CLI / TUI",
        "概览 CLI 与 TUI 的启动方式。",
        "Launch the CLI / TUI",
        "Covers the startup flow for the CLI and TUI.",
      ),
      createPage(
        "first-task",
        150,
        "完成第一个任务",
        "展示如何完成第一个真实任务。",
        "Complete Your First Task",
        "Shows how to finish a first real task.",
      ),
    ],
  ),
  createGroup(
    "concepts",
    200,
    "核心概念",
    "解释 Agent 循环、工作区和会话模型。",
    "Core Concepts",
    "Explains the agent loop, workspace, and session model.",
    [
      createPage(
        "agent-loop",
        210,
        "Agent 循环",
        "说明 Agent 如何在循环中调用工具。",
        "Agent Loop",
        "Explains how the agent calls tools in a loop.",
      ),
      createPage(
        "workspace",
        220,
        "工作区",
        "说明 CodeN 如何围绕当前工作区执行。",
        "Workspace",
        "Explains how CodeN operates around the current workspace.",
      ),
      createPage(
        "tools-and-risk",
        230,
        "工具与风险等级",
        "概述工具调用与风险控制。",
        "Tools and Risk Levels",
        "Covers tool calls and risk control.",
      ),
      createPage(
        "approval-modes",
        240,
        "审批模式",
        "解释 manual、smart 和 auto 审批模式。",
        "Approval Modes",
        "Explains the manual, smart, and auto approval modes.",
      ),
      createPage(
        "sessions",
        250,
        "会话",
        "介绍会话保存、恢复与状态演进。",
        "Sessions",
        "Introduces session persistence, restore, and state progression.",
      ),
      createPage(
        "context-and-thinking",
        260,
        "上下文与思考等级",
        "说明上下文窗口、压缩和思考等级。",
        "Context and Thinking Levels",
        "Covers context windows, compression, and thinking levels.",
      ),
    ],
  ),
  createGroup(
    "interfaces",
    300,
    "界面与使用方式",
    "涵盖 CLI、TUI 和斜杠命令。",
    "Interfaces",
    "Covers the CLI, TUI, and slash commands.",
    [
      createPage(
        "cli",
        310,
        "CLI / REPL",
        "介绍交互式命令行界面。",
        "CLI / REPL",
        "Introduces the interactive command-line interface.",
      ),
      createPage(
        "tui",
        320,
        "全屏 TUI",
        "介绍全屏终端界面。",
        "Full-screen TUI",
        "Introduces the full-screen terminal interface.",
      ),
      createPage(
        "print-mode",
        330,
        "print 模式",
        "说明只输出结果的运行方式。",
        "Print Mode",
        "Explains the output-only mode.",
      ),
      createPage(
        "slash-commands",
        340,
        "斜杠命令",
        "列出交互式会话中的斜杠命令。",
        "Slash Commands",
        "Lists the slash commands used in interactive sessions.",
      ),
      createPage(
        "cli-options",
        350,
        "常用命令行参数",
        "整理常见的 CLI 参数。",
        "CLI Options",
        "Collects the common CLI flags.",
      ),
    ],
  ),
  createGroup(
    "configuration",
    400,
    "配置",
    "梳理配置优先级、模型和安全字段。",
    "Configuration",
    "Covers precedence, models, and security-related settings.",
    [
      createPage(
        "precedence",
        410,
        "配置优先级",
        "说明配置覆盖顺序。",
        "Precedence",
        "Explains the configuration precedence order.",
      ),
      createPage(
        "scopes",
        420,
        "用户级与项目级配置",
        "说明不同配置作用域。",
        "User and Project Scopes",
        "Explains the different configuration scopes.",
      ),
      createPage(
        "environment",
        430,
        "环境变量",
        "列出常用环境变量入口。",
        "Environment Variables",
        "Lists the common environment variable entry points.",
      ),
      createPage(
        "openai",
        440,
        "OpenAI 配置",
        "说明 OpenAI provider 的配置。",
        "OpenAI Configuration",
        "Explains OpenAI provider configuration.",
      ),
      createPage(
        "anthropic",
        450,
        "Anthropic 配置",
        "说明 Anthropic provider 的配置。",
        "Anthropic Configuration",
        "Explains Anthropic provider configuration.",
      ),
      createPage(
        "language-and-thinking",
        460,
        "语言与思考等级",
        "说明语言和思考等级的设置。",
        "Language and Thinking Levels",
        "Covers language and thinking level settings.",
      ),
      createPage(
        "reference",
        470,
        "字段参考",
        "汇总完整配置字段。",
        "Reference",
        "Summarizes the complete configuration fields.",
      ),
      createPage(
        "data-security",
        480,
        "凭据与数据安全",
        "说明凭据和会话数据的安全边界。",
        "Data Security",
        "Explains the security boundaries for credentials and session data.",
      ),
    ],
  ),
  createGroup(
    "skills",
    500,
    "Skills",
    "覆盖 Skill 的发现、创建和安装。",
    "Skills",
    "Covers discovery, creation, and installation of skills.",
    [
      createPage(
        "discovery",
        510,
        "发现规则",
        "说明 Skill 的发现和覆盖规则。",
        "Discovery",
        "Explains skill discovery and override rules.",
      ),
      createPage(
        "create",
        520,
        "创建 Skill",
        "说明如何创建新的 Skill。",
        "Create a Skill",
        "Explains how to create a new skill.",
      ),
      createPage(
        "install-and-debug",
        530,
        "安装与调试",
        "说明 Skill 的安装和调试方法。",
        "Install and Debug",
        "Explains how to install and debug a skill.",
      ),
    ],
  ),
  createGroup(
    "plugins",
    600,
    "插件",
    "整理本地插件、npm 插件与市场入口。",
    "Plugins",
    "Covers local plugins, npm plugins, and the marketplace entry.",
    [
      createPage(
        "local-typescript",
        610,
        "本地 TypeScript 插件",
        "说明本地 TypeScript 插件的运行方式。",
        "Local TypeScript Plugins",
        "Explains how local TypeScript plugins run.",
      ),
      createPage(
        "npm-management",
        620,
        "npm 插件安装和管理",
        "说明 npm 插件的安装和管理流程。",
        "npm Plugin Management",
        "Explains npm plugin installation and management.",
      ),
      createPage(
        "author-protocol",
        630,
        "插件作者协议",
        "说明插件作者需要遵守的协议。",
        "Author Protocol",
        "Explains the protocol plugin authors must follow.",
      ),
      createPage(
        "trust-and-security",
        640,
        "信任与安全边界",
        "说明插件信任与安全边界。",
        "Trust and Security Boundaries",
        "Explains trust and security boundaries for plugins.",
      ),
      createPage(
        "marketplace",
        650,
        "插件市场",
        "介绍插件市场入口和浏览方式。",
        "Marketplace",
        "Introduces the plugin marketplace entry and browsing flow.",
      ),
    ],
  ),
  createGroup(
    "hooks",
    700,
    "Agent Hooks",
    "覆盖 Hook 事件、协议和安全模型。",
    "Agent Hooks",
    "Covers hook events, protocols, and the security model.",
    [
      createPage(
        "events",
        710,
        "Agent Hooks 事件",
        "概览 Agent Hooks 的事件类型。",
        "Agent Hooks Events",
        "Overview of the Agent Hooks event types.",
      ),
      createPage(
        "matchers",
        720,
        "匹配规则",
        "说明 Hook matcher 的匹配方式。",
        "Matchers",
        "Explains how hook matchers are resolved.",
      ),
      createPage(
        "protocol",
        730,
        "I/O 协议",
        "说明 stdin 和 stdout 的协议结构。",
        "Protocol",
        "Describes the stdin and stdout protocol structure.",
      ),
      createPage(
        "decisions",
        740,
        "决策与权限",
        "说明 Hook 如何参与决策和权限处理。",
        "Decisions",
        "Explains how hooks participate in decisions and permissions.",
      ),
      createPage(
        "execution",
        750,
        "执行与超时",
        "说明 Hook 执行、超时和并行行为。",
        "Execution",
        "Explains hook execution, timeouts, and parallel behavior.",
      ),
      createPage(
        "trust-and-security",
        760,
        "信任与安全",
        "说明 Project Hook 的信任与安全注意事项。",
        "Trust and Security",
        "Explains trust and security considerations for project hooks.",
      ),
      createPage(
        "examples",
        770,
        "示例",
        "提供 Hook 配置和使用示例。",
        "Examples",
        "Provides hook configuration and usage examples.",
      ),
    ],
  ),
  createGroup(
    "advanced",
    800,
    "进阶指南",
    "涵盖 Smart Approval、会话恢复和自动化。",
    "Advanced",
    "Covers Smart Approval, session restore, and automation.",
    [
      createPage(
        "smart-approval",
        810,
        "Smart Approval",
        "说明 Smart Approval 的工作方式。",
        "Smart Approval",
        "Explains how Smart Approval works.",
      ),
      createPage(
        "outside-workspace",
        820,
        "工作区外访问",
        "说明如何处理工作区外访问。",
        "Outside Workspace Access",
        "Explains how outside-workspace access is handled.",
      ),
      createPage(
        "session-storage",
        830,
        "会话存储",
        "说明会话保存与恢复。",
        "Session Storage",
        "Explains how sessions are stored and restored.",
      ),
      createPage(
        "custom-base-url",
        840,
        "自定义 Base URL",
        "说明如何配置自定义 Base URL。",
        "Custom Base URL",
        "Explains how to configure a custom base URL.",
      ),
      createPage(
        "automation",
        850,
        "自动化",
        "说明如何将 CodeN 接入 CI 和脚本。",
        "Automation",
        "Explains how to connect CodeN to CI and scripts.",
      ),
    ],
  ),
  createGroup(
    "reference",
    900,
    "参考与排错",
    "汇总命令、配置和排错参考。",
    "Reference",
    "Summarizes commands, configuration, and troubleshooting references.",
    [
      createPage(
        "cli",
        910,
        "CLI 命令参考",
        "汇总 CLI 命令。",
        "CLI Reference",
        "Summarizes the CLI commands.",
      ),
      createPage(
        "configuration",
        920,
        "配置参考",
        "汇总配置字段。",
        "Configuration Reference",
        "Summarizes the configuration fields.",
      ),
      createPage(
        "troubleshooting",
        930,
        "常见错误",
        "列出常见错误及处理方式。",
        "Troubleshooting",
        "Lists common errors and how to handle them.",
      ),
      createPage(
        "faq",
        940,
        "FAQ",
        "回答常见问题。",
        "FAQ",
        "Answers frequently asked questions.",
      ),
      createPage(
        "security-model",
        950,
        "安全模型",
        "说明 CodeN 的安全模型和限制。",
        "Security Model",
        "Explains CodeN's security model and limits.",
      ),
    ],
  ),
];

export function allDocEntries(): DocPage[] {
  const entries = [DOC_INDEX, ...DOC_GROUPS.flatMap((group) =>
    group.pages.map((page) => ({
      ...page,
      slug: `${group.slug}/${page.slug}`,
    })),
  )];

  return entries.sort((left, right) => left.order - right.order);
}
