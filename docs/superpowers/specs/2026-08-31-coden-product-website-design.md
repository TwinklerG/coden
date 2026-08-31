# CodeN 产品网站设计

## 目标

为 CodeN 建立部署在 GitHub Pages 的正式产品网站。首版包含：

- 中英文产品首页；
- 中英文使用文档；
- 可扩展的插件市场；
- GitHub Actions 自动检查与部署。

网站公开地址为 `https://twinklerg.github.io/CodeN/`。网站采用静态输出，不引入后端、账号系统、Analytics 或 Cookie。除 GitHub Actions 和根 `justfile` 的必要接入外，所有网站源码、内容、配置、依赖锁文件和静态资源均位于 `website/`。

## 技术选型

采用 Astro + Starlight：

- Astro 承载产品首页、插件市场、共享布局和静态构建；
- Starlight 提供文档布局、侧边栏、页面目录、主题切换和 Pagefind 静态搜索；
- React Island 只用于确实需要客户端状态的局部交互，例如 CLI/TUI 标签、复制按钮和 npm 数据加载；
- 使用 Bun 管理网站依赖和运行脚本，但不使用 Bun 专有 API；
- 网站拥有独立的 `website/package.json` 和锁文件，避免网站依赖进入 CLI 发布包。

不采用纯 Astro 自建文档系统，以免重复实现搜索、目录和文档导航；也不拆成两个独立站点，以避免双构建、路由和主题同步成本。

## 目录边界

建议目录如下：

```text
website/
├── astro.config.ts
├── package.json
├── bun.lock
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/docs/
│   │   ├── zh/
│   │   └── en/
│   ├── data/plugins.ts
│   ├── i18n/
│   ├── pages/
│   │   ├── index.astro
│   │   ├── zh/
│   │   └── en/
│   └── styles/
└── tsconfig.json
```

组件按职责拆分：共享站点外壳、首页 Hero、终端演示、功能区、插件数据客户端和插件卡片相互独立。npm 响应解析和 URL 规范化保持为无 UI 依赖的纯函数，便于独立测试。

## 路由与 i18n

两种语言均使用显式前缀：

- `/CodeN/zh/`、`/CodeN/en/`：产品首页；
- `/CodeN/zh/docs/`、`/CodeN/en/docs/`：使用文档；
- `/CodeN/zh/plugins/`、`/CodeN/en/plugins/`：插件市场。

`/CodeN/` 根据浏览器首选语言跳转到中文或英文入口。未启用 JavaScript时，根页面仍显示可访问的中英文链接作为兜底。未知路径显示双语 404 页面。

语言切换应尽量保留当前页面：中文文档页面切换到对应英文文档页面，反之亦然；若目标语言没有对应页面，则回退到该语言的文档首页。中文和英文文档必须维持相同的页面标识与导航结构。

Astro 固定使用：

- `site: https://twinklerg.github.io`；
- `base: /CodeN`；
- `output: static`。

所有内部链接、静态资源、canonical URL、sitemap 和语言链接都必须正确包含 base path。

## 视觉系统与产品首页

### 视觉方向

网站定位为正式、克制的开发者工具。默认跟随系统明暗主题，并提供手动切换。深浅主题共用语义化设计变量，保持足够对比度。避免大面积霓虹、虚构指标和通用 SaaS 模板感。

首版使用可替换的品牌占位资源：

- `logo-placeholder.svg`；
- favicon；
- Open Graph 分享图；
- CSS 品牌色变量。

占位强调色采用偏冷的蓝绿色。后续替换 Logo、分享图或品牌色时不应修改页面结构。

### 首页结构

1. 顶部导航
   - 品牌占位图标与 `CodeN` 文字标识；
   - 首页、文档、插件市场和 GitHub；
   - 中英文切换与明暗主题切换；
   - 移动端折叠菜单。

2. Hero
   - 突出 CodeN 是极简、本地优先、使用模型原生 Tool Calling 的 Coding Agent；
   - 醒目展示 `bun add -g @twinklerg/coden`；
   - 提供复制按钮和次级 npm 安装方式；
   - 提供“快速开始”和“查看 GitHub”行动按钮；
   - 右侧展示 CLI/TUI 双标签模拟终端。

3. 模拟终端
   - CLI 标签展示启动横幅、用户任务、工具调用和完成结果；
   - TUI 标签展示 transcript、输入区和状态栏组成的全屏布局缩略界面；
   - 动画应短且可控，不运行真实终端，也不发送模型请求；
   - `prefers-reduced-motion` 下停用非必要动画；
   - 标签支持鼠标、触摸和键盘操作。

4. 核心能力
   - 本地运行和直接文件操作；
   - OpenAI / Anthropic；
   - CLI、TUI 和 print 模式；
   - 权限控制与 Smart Approval；
   - Skills、npm 插件与本地插件；
   - 会话恢复、上下文压缩与思考等级。

5. 三步使用流程
   - 安装 CodeN；
   - 配置 Provider 密钥；
   - 在项目目录运行 `coden`。

6. 底部 CTA 与 Footer
   - 再次提供安装命令；
   - 链接 GitHub、npm、文档、插件市场和 MIT License；
   - 展示当前包版本；
   - 不展示虚假的企业客户、使用量或性能数据。

## 使用文档

文档内容在 `website/src/content/docs/{zh,en}/` 独立维护，不从根 README 自动生成。首版以当前实现、测试和 README 为事实来源，重新组织内容，而不是逐段复制。命令、字段名和安全警告在两种语言间必须一致。

### 信息架构

1. 快速入门
   - 安装要求；
   - 安装 CodeN；
   - 配置第一个 Provider；
   - 启动 CLI / TUI；
   - 完成第一个任务。

2. 核心概念
   - Agent 循环与原生 Tool Calling；
   - 工作区；
   - 工具与风险等级；
   - manual、smart、auto 审批模式；
   - 会话与恢复；
   - 上下文窗口、压缩和思考等级。

3. 界面与使用方式
   - CLI / REPL；
   - 全屏 TUI；
   - print 模式；
   - 斜杠命令；
   - 常用命令行参数。

4. 配置
   - 配置优先级；
   - 用户级与项目级配置；
   - 环境变量；
   - OpenAI 与 Anthropic；
   - 语言与思考等级；
   - 完整字段参考；
   - 凭据与会话数据安全。

5. Skills
   - 用途与发现规则；
   - 目录结构和覆盖规则；
   - 创建、安装和调试 Skill。

6. 插件
   - 本地 TypeScript 插件；
   - npm 插件安装和管理；
   - 插件作者协议；
   - 生命周期脚本、信任模型和安全边界；
   - 插件市场入口。

7. Agent Hooks
   - Hooks 概览与典型用途；
   - 用户级和项目级配置；
   - `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Notification`、`Stop`、`SessionEnd` 九种事件；
   - matcher 规则与执行顺序；
   - stdin JSON、环境变量和 stdout JSON 协议；
   - `PreToolUse` 输入修改与权限决策；
   - `PermissionRequest` 自动决策；
   - `Stop` 阻止结束并要求 Agent 继续；
   - 超时、退出码、并行合并和 fail-open 行为；
   - 项目 Hook 信任、安全风险、调试方式和完整示例。

8. 进阶指南
   - Smart Approval；
   - 工作区外访问；
   - 会话存储与恢复；
   - 自定义 Base URL；
   - CI、脚本和管道化使用。

9. 参考与排错
   - CLI 命令参考；
   - 配置参考，包括 `hooks` 字段；
   - 常见错误；
   - FAQ；
   - 安全模型与限制。

### 文档体验

- Pagefind 在构建期为两种语言生成静态搜索索引；
- 搜索结果限于当前语言；
- 每页提供目录、上一页/下一页、语言切换和 GitHub 编辑链接；
- 代码块提供复制按钮；
- 外部链接具有清晰标识；
- README 保持独立，不作为网站内容源，后续可增加官网链接。

## 插件市场

### 收录模型

首版采用“仓库显式收录 + 浏览器实时获取 npm 数据”。只展示 `website/src/data/plugins.ts` 中列出的包，避免自动搜索引入冒充、不兼容或低质量包。

初始清单：

- `coden-modern-unix`；
- `coden-msb`。

清单接口预留以下人工字段：npm 包名、精选状态、自定义图标、分类、排序权重和可选中英文简介。新增插件只需增加配置项。

### 运行时数据

浏览器为每个收录包请求：

```text
https://registry.npmjs.org/<package>/latest
https://api.npmjs.org/downloads/point/last-month/<package>
```

页面展示包名、最新版本、npm 描述、License、最近 30 天下载量、npm/Homepage/Repository 链接、`coden.apiVersion` 和安装命令：

```bash
coden plugin install npm:<package>
```

当前包的已验证基础信息为：

- `coden-modern-unix@1.0.1`，`coden.apiVersion: 1`；
- `coden-msb@0.1.0`，`coden.apiVersion: 1`。

版本与下载量仍以浏览器运行时响应为准，不固化为页面事实。

### 市场交互

- 首屏先显示由本地清单生成的骨架卡片；
- 请求完成后异步填充 npm 数据；
- 提供名称搜索和分类接口；
- 提供安装命令复制按钮；
- 首版通过卡片展开或弹层显示附加信息，不生成独立详情路由；
- 中英文页面共用 npm 原始数据，只翻译界面标签、状态和人工说明。

### 失败与安全边界

- 各包独立加载，使用 `Promise.allSettled`，单包失败不影响其他包；
- 请求设置有限超时；离线、超时或 Registry 错误时仍展示包名、安装命令和本地化失败状态；
- npm 内容只能作为纯文本渲染，不允许注入 HTML；
- 外链仅接受 `https:`，Repository 字段经过规范化；
- 返回包名不匹配、缺少 `coden` 元数据或 `apiVersion !== 1` 时显示兼容性警告；
- 页面明确声明插件拥有完整用户进程权限，不是安全沙箱。

## SEO、可访问性与响应式

- 中英文页面使用独立的 title、description 和 Open Graph 文案；
- 页面提供 canonical URL 和相互对应的 `hreflang`；
- 生成 sitemap 和 robots.txt；
- 使用语义化 HTML、可见焦点、正确标签和足够色彩对比；
- 导航、语言选择、主题切换、终端标签和复制按钮均支持键盘；
- 支持移动端、平板和桌面布局；
- 遵守 `prefers-reduced-motion`；
- 首版不加载 Analytics、Cookie 脚本或除 npmjs 之外的运行时数据源。

## 开发命令与测试

根 `justfile` 增加：

- `just website-dev`；
- `just website-check`；
- `just website-build`。

`website-check` 至少执行：

- Astro 类型检查；
- Biome lint/format 检查；
- 网站单元测试；
- 静态构建；
- 内部链接检查；
- 中英文文档页面映射检查。

测试覆盖：

- 语言路由和对应页面切换；
- `/CodeN/` base path 下的资源与链接；
- 安装命令复制值；
- CLI/TUI 标签的鼠标和键盘行为；
- npm 数据解析、Repository URL 规范化和协议过滤；
- 部分请求失败时的独立降级；
- 插件兼容性警告；
- 中英文导航和文档结构一致性；
- 深浅主题、响应式布局和 reduced-motion 行为。

CLI npm 包的 `files` 配置保持不变，网站源码和依赖不会进入发布产物。

## GitHub Actions 与部署

新增 `.github/workflows/pages.yml`：

- pull request 只检查和构建，不部署；
- `main` 分支在检查通过后构建网站；
- 使用 `actions/upload-pages-artifact` 上传 Astro 静态产物；
- 使用 `actions/deploy-pages` 部署；
- 配置 `contents: read`、`pages: write` 和 `id-token: write`；
- 使用 GitHub `pages` environment；
- 使用部署并发组，避免旧任务覆盖新部署。

现有 CI 接入 `just website-check`，npm Release 工作流不依赖网站部署。网站失败不会发布错误页面，部署失败也不改变 npm 发布流程。

## 验收标准

1. `https://twinklerg.github.io/CodeN/` 可进入明确的中英文入口，并可访问两种语言的首页、文档和插件市场。
2. 首页具有正式产品感，醒目展示 Bun 安装命令，CLI/TUI 演示支持标签切换。
3. 文档覆盖快速入门、核心概念、界面、配置、Skills、插件、Agent Hooks、进阶和排错。
4. 两种语言拥有对应页面、独立搜索和正确的语言切换。
5. 插件市场在浏览器中实时展示两个真实 npm 包，并在网络失败或元数据异常时安全降级。
6. 所有网站实现与内容位于 `website/`，仅 Actions 和根 `justfile` 做必要接入。
7. 网站在 GitHub Pages 的 `/CodeN/` base path 下无损构建，内部链接、静态资源、SEO URL 和搜索均正确。
8. 网站检查、单元测试、静态构建和链接检查全部通过。
