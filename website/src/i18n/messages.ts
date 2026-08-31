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
    light: string;
    dark: string;
  };
  footer: {
    github: string;
    npm: string;
    docs: string;
    plugins: string;
    license: string;
    version: string;
  };
  home: {
    eyebrow: string;
    title: string;
    description: string;
    installCommand: string;
    primaryAction: string;
    secondaryAction: string;
    placeholder: string;
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
      toggleTheme: "切换明暗主题",
    },
    theme: {
      label: "主题",
      light: "浅色",
      dark: "深色",
    },
    footer: {
      github: "GitHub",
      npm: "npm",
      docs: "文档",
      plugins: "插件市场",
      license: "MIT License",
      version: "版本",
    },
    home: {
      eyebrow: "CodeN",
      title: "极简、本地优先的 Coding Agent",
      description: "在本地工作区中用模型原生 Tool Calling 完成真实编码任务。",
      installCommand: "bun add -g @twinklerg/coden",
      primaryAction: "快速开始",
      secondaryAction: "查看 GitHub",
      placeholder: "本阶段仅提供网站骨架与导航占位。",
    },
    shell: {
      docsTitle: "文档框架",
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
      toggleTheme: "Toggle light and dark theme",
    },
    theme: {
      label: "Theme",
      light: "Light",
      dark: "Dark",
    },
    footer: {
      github: "GitHub",
      npm: "npm",
      docs: "Docs",
      plugins: "Plugins",
      license: "MIT License",
      version: "Version",
    },
    home: {
      eyebrow: "CodeN",
      title: "A minimal, local-first coding agent",
      description: "Use model-native tool calling to complete real coding tasks in your workspace.",
      installCommand: "bun add -g @twinklerg/coden",
      primaryAction: "Get started",
      secondaryAction: "View GitHub",
      placeholder: "This stage ships only the site shell and navigation scaffolding.",
    },
    shell: {
      docsTitle: "Documentation scaffold",
      pluginsTitle: "Plugin marketplace",
      notFoundTitle: "Page not found",
      notFoundDescription: "The page you requested could not be found or has moved.",
      rootTitle: "Language entry",
      rootDescription: "Choose Chinese or English; you will be redirected to the matching home page.",
    },
  },
} satisfies Record<"zh" | "en", LocalizedMessages>;
