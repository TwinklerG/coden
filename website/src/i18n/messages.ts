export interface LocalizedMessages {
  brand: string;
  localeSwitch: string;
  nav: {
    label: string;
    home: string;
    docs: string;
    plugins: string;
    github: string;
  };
  a11y: {
    skipToContent: string;
    switchLanguage: string;
    toggleTheme: string;
  };
  theme: {
    label: string;
    auto: string;
    light: string;
    dark: string;
  };
  footer: {
    github: string;
    npm: string;
    docs: string;
    plugins: string;
    license: string;
  };
  home: {
    eyebrow: string;
    title: string;
    description: string;
    installCommand: string;
    primaryAction: string;
    secondaryAction: string;
    placeholder: string;
    install: {
      bunLabel: string;
      npmLabel: string;
      copy: string;
      copied: string;
      failed: string;
      helper: string;
    };
    terminal: {
      cliLabel: string;
      tuiLabel: string;
      modelLabel: string;
      approvalLabel: string;
      thinkingLabel: string;
      sessionLabel: string;
      providerLabel: string;
      workspaceLabel: string;
      phaseLabel: string;
      inputLabel: string;
    };
    cta: {
      docs: string;
      plugins: string;
    };
  };
  marketplace: {
    title: string;
    description: string;
    searchPlaceholder: string;
    loading: string;
    noResults: string;
    temporarilyUnavailable: string;
    compatible: string;
    incompatible: string;
    install: string;
    version: string;
    downloads: string;
    apiVersion: string;
    homepage: string;
    repository: string;
    copy: string;
    notice: string;
  };
  shell: {
    docsTitle: string;
    pluginsTitle: string;
    notFoundTitle: string;
    notFoundDescription: string;
    rootTitle: string;
    rootDescription: string;
  };
}

export const messages = {
  zh: {
    brand: "CodeN",
    localeSwitch: "English",
    nav: {
      label: "主导航",
      home: "首页",
      docs: "文档",
      plugins: "插件市场",
      github: "GitHub",
    },
    a11y: {
      skipToContent: "跳到主内容",
      switchLanguage: "切换语言",
      toggleTheme: "选择主题",
    },
    theme: {
      label: "主题",
      auto: "自动",
      light: "浅色",
      dark: "深色",
    },
    footer: {
      github: "GitHub",
      npm: "npm",
      docs: "文档",
      plugins: "插件市场",
      license: "MIT License",
    },
    home: {
      eyebrow: "CodeN",
      title: "一个有意思的 Coding Agent",
      description: "以可插拔工具插件为特色，在本地工作区中理解、运行并塑造 Agent。",
      installCommand: "bun add -g @twinklerg/coden",
      primaryAction: "快速开始",
      secondaryAction: "查看 GitHub",
      placeholder: "从透明的 Agent 循环开始，用 Plugins、Skills 与 Hooks 塑造自己的工作流。",
      install: {
        bunLabel: "Bun",
        npmLabel: "npm",
        copy: "复制命令",
        copied: "已复制",
        failed: "复制失败",
        helper: "可直接复制安装命令。",
      },
      terminal: {
        cliLabel: "CLI",
        tuiLabel: "TUI",
        modelLabel: "模型",
        approvalLabel: "审批模式",
        thinkingLabel: "思考等级",
        sessionLabel: "会话ID",
        providerLabel: "Provider",
        workspaceLabel: "工作区",
        phaseLabel: "阶段",
        inputLabel: "输入框",
      },
      cta: {
        docs: "查看文档",
        plugins: "浏览插件市场",
      },
    },
    marketplace: {
      title: "插件市场",
      description: "仅展示仓库显式收录的 npm 插件，并在浏览器中实时读取元数据。",
      searchPlaceholder: "搜索插件",
      loading: "加载中",
      noResults: "没有匹配的插件",
      temporarilyUnavailable: "暂时不可用",
      compatible: "已验证兼容",
      incompatible: "兼容性警告",
      install: "安装",
      version: "版本",
      downloads: "近 30 天下载量",
      apiVersion: "API 版本",
      homepage: "主页",
      repository: "仓库",
      copy: "复制安装命令",
      notice: "插件拥有完整用户进程权限，不是安全沙箱。",
    },
    shell: {
      docsTitle: "CodeN 文档",
      pluginsTitle: "插件市场",
      notFoundTitle: "页面未找到",
      notFoundDescription: "您请求的页面不存在或已移动。",
      rootTitle: "语言入口",
      rootDescription: "选择中文或英文入口，随后将自动跳转到对应首页。",
    },
  },
  en: {
    brand: "CodeN",
    localeSwitch: "简体中文",
    nav: {
      label: "Primary navigation",
      home: "Home",
      docs: "Docs",
      plugins: "Plugins",
      github: "GitHub",
    },
    a11y: {
      skipToContent: "Skip to main content",
      switchLanguage: "Switch language",
      toggleTheme: "Choose theme",
    },
    theme: {
      label: "Theme",
      auto: "Auto",
      light: "Light",
      dark: "Dark",
    },
    footer: {
      github: "GitHub",
      npm: "npm",
      docs: "Docs",
      plugins: "Plugins",
      license: "MIT License",
    },
    home: {
      eyebrow: "CodeN",
      title: "A hackable coding agent",
      description:
        "Built around pluggable tool plugins for understanding, running, and shaping agents in your local workspace.",
      installCommand: "bun add -g @twinklerg/coden",
      primaryAction: "Get started",
      secondaryAction: "View GitHub",
      placeholder:
        "Start with an inspectable agent loop, then shape the workflow with Plugins, Skills, and Hooks.",
      install: {
        bunLabel: "Bun",
        npmLabel: "npm",
        copy: "Copy command",
        copied: "Copied",
        failed: "Copy failed",
        helper: "Copy the install command directly.",
      },
      terminal: {
        cliLabel: "CLI",
        tuiLabel: "TUI",
        modelLabel: "Model",
        approvalLabel: "Approval mode",
        thinkingLabel: "Thinking level",
        sessionLabel: "Session ID",
        providerLabel: "Provider",
        workspaceLabel: "Workspace",
        phaseLabel: "Phase",
        inputLabel: "Input",
      },
      cta: {
        docs: "Read the docs",
        plugins: "Browse plugins",
      },
    },
    marketplace: {
      title: "Plugin marketplace",
      description:
        "Shows only repo-approved npm plugins and reads metadata from the browser at runtime.",
      searchPlaceholder: "Search plugins",
      loading: "Loading",
      noResults: "No matching plugins",
      temporarilyUnavailable: "Temporarily unavailable",
      compatible: "Verified compatible",
      incompatible: "Compatibility warning",
      install: "Install",
      version: "Version",
      downloads: "Last 30 days downloads",
      apiVersion: "API version",
      homepage: "Homepage",
      repository: "Repository",
      copy: "Copy install command",
      notice: "Plugins have full process access and are not a security sandbox.",
    },
    shell: {
      docsTitle: "CodeN documentation",
      pluginsTitle: "Plugin marketplace",
      notFoundTitle: "Page not found",
      notFoundDescription: "The page you requested could not be found or has moved.",
      rootTitle: "Language entry",
      rootDescription:
        "Choose Chinese or English; you will be redirected to the matching home page.",
    },
  },
} satisfies Record<"zh" | "en", LocalizedMessages>;
