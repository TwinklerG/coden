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
    description: "理解并塑造一个以可插拔工具插件为特色的 Coding Agent。",
  },
  en: {
    title: "CodeN Documentation",
    description: "Understand and shape a coding agent built around pluggable tool plugins.",
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
    "start",
    100,
    "开始",
    "从产品边界到第一个可验证任务。",
    "Start",
    "From product boundaries to a first verified task.",
    [
      createPage(
        "overview",
        110,
        "认识 CodeN",
        "了解 CodeN 的定位、设计取向与明确边界。",
        "Meet CodeN",
        "Understand CodeN's position, design choices, and explicit boundaries.",
      ),
      createPage(
        "install",
        120,
        "安装与运行时",
        "安装、升级并区分 Node 与 Bun 的能力。",
        "Installation and Runtimes",
        "Install, upgrade, and distinguish Node and Bun capabilities.",
      ),
      createPage(
        "provider-and-model",
        130,
        "Provider 与模型",
        "配置 OpenAI、Anthropic、模型与凭据。",
        "Provider and Model",
        "Configure OpenAI, Anthropic, models, and credentials.",
      ),
      createPage(
        "first-task",
        140,
        "完成第一个任务",
        "使用默认 CLI、显式 TUI 或 print 模式完成并验证任务。",
        "Complete a First Task",
        "Complete and verify work with the default CLI, explicit TUI, or print mode.",
      ),
    ],
  ),
  createGroup(
    "agent",
    200,
    "理解 Agent",
    "深入 Agent 循环、上下文、状态与失败传播。",
    "Understand the Agent",
    "Explore the agent loop, context, state, and failure propagation.",
    [
      createPage(
        "loop",
        210,
        "Agent 循环",
        "理解 turn、model step、工具调用与结果如何组成循环。",
        "Agent Loop",
        "Understand how turns, model steps, tool calls, and results form the loop.",
      ),
      createPage(
        "tools-and-context",
        220,
        "工具与上下文",
        "理解工具定义、消息历史与上下文预算。",
        "Tools and Context",
        "Understand tool definitions, message history, and context budgets.",
      ),
      createPage(
        "compaction-and-thinking",
        230,
        "压缩与思考状态",
        "理解有损压缩、thinking level 与 Provider 状态。",
        "Compaction and Thinking",
        "Understand lossy compaction, thinking levels, and provider state.",
      ),
      createPage(
        "sessions",
        240,
        "会话与恢复",
        "理解 JSONL 持久化、恢复与中断修复。",
        "Sessions and Resume",
        "Understand JSONL persistence, recovery, and interrupted-call repair.",
      ),
      createPage(
        "failures-and-control-flow",
        250,
        "失败与控制流",
        "区分重试、取消、step limit 与 Stop Hook。",
        "Failures and Control Flow",
        "Distinguish retries, cancellation, step limits, and the Stop Hook.",
      ),
    ],
  ),
  createGroup(
    "extend",
    300,
    "塑造 Agent",
    "用 Plugins、Skills、Hooks 与项目指令改变能力和工作流。",
    "Shape the Agent",
    "Change capabilities and workflows with Plugins, Skills, Hooks, and project instructions.",
    [
      createPage(
        "choose-an-extension",
        310,
        "选择扩展机制",
        "在 Plugin、Skill、Hook 与 AGENTS.md 之间作出准确选择。",
        "Choose an Extension",
        "Choose precisely among Plugins, Skills, Hooks, and AGENTS.md.",
      ),
      createPage(
        "tool-plugins",
        320,
        "工具插件执行模型",
        "从 Registry 到 tool result 深入理解工具插件。",
        "Tool Plugin Execution Model",
        "Follow tool plugins from the registry to the tool result.",
      ),
      createPage(
        "local-plugins",
        330,
        "本地 TypeScript 插件",
        "开发、加载并重载 Bun 运行时下的单文件插件。",
        "Local TypeScript Plugins",
        "Develop, load, and reload single-file plugins under the Bun runtime.",
      ),
      createPage(
        "npm-plugins",
        340,
        "npm 插件",
        "管理 npm 插件的作用域、事务、信任与缓存。",
        "npm Plugins",
        "Manage npm plugin scopes, transactions, trust, and caching.",
      ),
      createPage(
        "plugin-authoring",
        350,
        "插件作者指南",
        "使用公开类型、导出协议与 JSON Schema 发布插件。",
        "Plugin Authoring",
        "Publish plugins with public types, export contracts, and JSON Schema.",
      ),
      createPage(
        "skills",
        360,
        "Skills",
        "创建、安装并调试按需加载的方法知识。",
        "Skills",
        "Create, install, and debug method knowledge loaded on demand.",
      ),
      createPage(
        "hooks",
        370,
        "Hooks",
        "使用生命周期命令实现确定性的流程控制。",
        "Hooks",
        "Use lifecycle commands for deterministic flow control.",
      ),
    ],
  ),
  createGroup(
    "safety",
    400,
    "控制与安全",
    "理解信任、审批、工作区外访问和非沙箱边界。",
    "Control and Safety",
    "Understand trust, approvals, outside access, and non-sandbox boundaries.",
    [
      createPage(
        "workspace-and-trust",
        410,
        "工作区与信任",
        "理解真实路径分类与项目代码执行同意。",
        "Workspace and Trust",
        "Understand real-path classification and consent to execute project code.",
      ),
      createPage(
        "approval-modes",
        420,
        "审批模式",
        "准确使用 manual、smart 与 auto 策略。",
        "Approval Modes",
        "Use manual, smart, and auto policies accurately.",
      ),
      createPage(
        "outside-workspace",
        430,
        "工作区外访问",
        "区分结构化文件工具与 bash、插件的访问边界。",
        "Outside-Workspace Access",
        "Distinguish structured file-tool boundaries from bash and plugin access.",
      ),
      createPage(
        "security-boundaries",
        440,
        "安全边界",
        "理解凭据、进程权限、取消协作与无通用沙箱。",
        "Security Boundaries",
        "Understand credentials, process privileges, cooperative cancellation, and the lack of a general sandbox.",
      ),
    ],
  ),
  createGroup(
    "operate",
    500,
    "配置与运行",
    "配置 Provider、自动化、存储并诊断故障。",
    "Configure and Operate",
    "Configure providers, automation, storage, and diagnostics.",
    [
      createPage(
        "configuration",
        510,
        "配置模型",
        "理解配置作用域、优先级、合并与校验。",
        "Configuration Model",
        "Understand configuration scopes, precedence, merging, and validation.",
      ),
      createPage(
        "providers",
        520,
        "Providers 与 Thinking",
        "理解 OpenAI、Anthropic、自定义端点和思考映射。",
        "Providers and Thinking",
        "Understand OpenAI, Anthropic, custom endpoints, and thinking mappings.",
      ),
      createPage(
        "automation-and-recovery",
        530,
        "自动化与恢复",
        "在脚本和 CI 中运行，并诊断会话、trace 与常见错误。",
        "Automation and Recovery",
        "Run in scripts and CI, and diagnose sessions, traces, and common failures.",
      ),
    ],
  ),
  createGroup(
    "reference",
    600,
    "协议参考",
    "精确检索 CLI、配置、插件、Hook 与存储协议。",
    "Protocol Reference",
    "Look up exact CLI, configuration, plugin, Hook, and storage contracts.",
    [
      createPage(
        "cli",
        610,
        "CLI 参考",
        "命令、参数、斜杠命令与退出码。",
        "CLI Reference",
        "Commands, flags, slash commands, and exit codes.",
      ),
      createPage(
        "configuration",
        620,
        "配置参考",
        "完整字段、环境变量、默认值与例外。",
        "Configuration Reference",
        "Complete fields, environment variables, defaults, and exceptions.",
      ),
      createPage(
        "plugins",
        630,
        "插件协议参考",
        "manifest、导出、类型、运行时矩阵与错误码。",
        "Plugin Protocol Reference",
        "Manifests, exports, types, runtime matrix, and error codes.",
      ),
      createPage(
        "hooks-and-storage",
        640,
        "Hook 与存储参考",
        "Hook 事件、I/O、合并规则与会话记录。",
        "Hooks and Storage Reference",
        "Hook events, I/O, merge rules, and session records.",
      ),
    ],
  ),
];

export function allDocEntries(): DocPage[] {
  return [
    DOC_INDEX,
    ...DOC_GROUPS.flatMap((group) =>
      group.pages.map((page) => ({ ...page, slug: `${group.slug}/${page.slug}` })),
    ),
  ].sort((left, right) => left.order - right.order);
}
