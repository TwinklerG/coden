# npm 插件安装设计

**日期：** 2026-08-28

**状态：** 已批准

## 1. 背景

CodeN 当前支持加载以下本地 TypeScript 工具插件：

- `~/.config/coden/plugins/*.ts`
- `<workspace>/.coden/plugins/*.ts`
- `--plugin` 指定的 `.ts` 文件或目录

现有 `PluginLoader` 为保证 Bun 下的 `/reload` 确定性，会读取单文件源码并通过
`data:text/typescript` URL 导入。这适合自包含的本地插件，但不能可靠支持相对模块、
完整 npm 包目录和包内第三方依赖。

本设计增加 `coden plugin` 子命令，以 npmjs.com 作为首版托管平台，安装包含
`package.json` 和 `dist/` 构建产物的插件包，同时保留现有本地 TypeScript 插件能力。

## 2. 目标

首版实现：

- `coden plugin install npm:<package>`，默认安装到当前项目；
- 使用 `--global` 安装为当前用户的全局插件；
- 支持 npm 插件的相对模块和第三方运行时依赖；
- 支持一个包导出一个或多个工具；
- 使用项目清单与 Bun lockfile 实现可复现同步；
- 默认禁用 npm 生命周期脚本；
- 强制校验 npm 包的 CodeN 元数据、API 版本、入口和工具定义；
- 安装、删除和同步失败时不破坏原有插件环境；
- 保持现有 Agent CLI、本地 `.ts` 插件和 `/reload` 行为兼容。

## 3. 非目标

首版不实现：

- npm 搜索、插件市场和 `coden plugin publish`；
- 私有 npm 包、认证和自定义 Registry；
- Git、URL 或本地目录安装源；
- 插件配置 Schema、密钥管理和生命周期 Hook；
- 插件进程隔离或权限沙箱；
- npm 插件热重载和后台自动升级；
- 依赖漏洞扫描；
- 对 Windows 原子目录替换的完整保证。

## 4. 方案选择

### 4.1 选定方案：每个作用域一个共享 npm Runtime

项目级插件共享一个 `package.json`、`bun.lock` 和 `node_modules`，全局插件使用
另一套独立 Runtime。依赖解析、嵌套版本和 lockfile 交给 Bun 处理。

相比每个插件一个独立 Runtime，该方案减少重复依赖和锁文件数量，更适合项目提交
清单后统一同步。相比直接调用 Registry API 并自行解压依赖，该方案避免重新实现
包管理器。

### 4.2 两条加载路径

- 本地 `.ts` 插件继续由现有 `PluginLoader` 通过内容哈希和 `data:` URL 加载；
- npm 插件由新增的 `InstalledPluginLoader` 从真实 `file:` URL 导入。

npm 插件保留真实目录后，相对导入和 `node_modules` 依赖可以按标准模块规则解析。
代价是模块会进入 Bun 缓存，安装或升级后必须重启 CodeN。

## 5. 文件布局

### 5.1 项目级

```text
<workspace>/.coden/
├── plugins/                         # 现有手写 TypeScript 插件
├── plugins.json                    # 提交到 Git
└── plugin-runtime/
    ├── .gitignore                  # 提交到 Git
    ├── bun.lock                    # 提交到 Git
    ├── package.json                # 从 plugins.json 确定性生成
    └── node_modules/               # 不提交
```

`.coden/plugin-runtime/.gitignore` 内容为：

```gitignore
*
!.gitignore
!bun.lock
```

### 5.2 用户全局

```text
<userDataDir>/plugins/
├── plugins.json
└── runtime/
    ├── package.json
    ├── bun.lock
    └── node_modules/
```

`userDataDir` 沿用当前 `XDG_DATA_HOME` 规则，默认是
`~/.local/share/coden`。现有 `~/.config/coden/plugins/*.ts` 仍用于用户手写插件，
不用于存放 npm 依赖。

### 5.3 清单格式

```json
{
  "schemaVersion": 1,
  "plugins": {
    "@scope/coden-plugin-github": {
      "source": "npm",
      "requested": "^1.2.0"
    }
  }
}
```

未指定版本时，`requested` 记为 `latest`。`plugins.json` 是 CodeN 的声明源；
Runtime 中的 `package.json` 由它按包名排序后确定性生成，不要求提交。

## 6. npm 插件协议

### 6.1 `package.json` 元数据

npm 包必须包含：

```json
{
  "name": "@scope/coden-plugin-github",
  "version": "1.2.0",
  "type": "module",
  "files": ["dist"],
  "coden": {
    "apiVersion": 1,
    "plugin": "./dist/index.js"
  }
}
```

规则：

- 首版只接受 `apiVersion: 1`；
- `coden.plugin` 必须是包目录内的相对 `.js` 或 `.mjs` 文件；
- 解析真实路径后仍必须位于包目录内；
- 缺少 `coden` 字段时拒绝安装，不回退到 `main` 或默认 `exports`；
- npm 插件必须发布构建后的 JavaScript，不直接加载 TypeScript 源码。

### 6.2 单工具导出

包入口可以默认导出一个结构兼容的 `ToolDefinition`：

```ts
import type { ToolDefinition } from "coden/plugin";

const tool: ToolDefinition = {
  name: "github_issue_get",
  description: "Get a GitHub issue",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["number"],
    properties: { number: { type: "integer" } },
  },
  async execute(input, context) {
    return { content: "..." };
  },
};

export default tool;
```

### 6.3 多工具导出

```ts
import type { CodeNPlugin } from "coden/plugin";

const plugin: CodeNPlugin = {
  apiVersion: 1,
  name: "@scope/coden-plugin-github",
  tools: [issueGetTool, issueCreateTool],
};

export default plugin;
```

```ts
export interface CodeNPlugin {
  apiVersion: 1;
  name: string;
  tools: ToolDefinition[];
}
```

加载时要求：

- 导出对象的 `name` 等于 npm 包名；
- 导出对象与 `package.json.coden` 的 API 版本一致；
- `tools` 至少有一个元素；
- 同一插件内不能包含同名工具；
- 每个工具都通过现有名称、风险级别和 JSON Schema 校验。

CodeN 从 `coden/plugin` 公开插件作者所需的纯类型。插件可把 CodeN 放入
`devDependencies`，构建产物中的类型导入必须被移除，运行时不依赖或加载另一份
CodeN。

## 7. 模块设计

```text
src/plugins/
├── api.ts                 # 对插件作者公开的 CodeNPlugin 和工具类型
├── specifier.ts           # 解析 npm:<package>@<version>
├── paths.ts               # 项目级和全局目录计算
├── manifest.ts            # plugins.json 读写、校验和确定性序列化
├── package-manager.ts     # 可测试的 PackageManager 接口
├── bun-package-manager.ts # 通过 spawn 调用 Bun CLI
├── package-metadata.ts    # 校验 package.json#coden 和入口边界
├── transaction.ts         # 文件锁、暂存、提交和崩溃恢复
├── installer.ts           # install/remove/sync 业务编排
└── installed-loader.ts    # 从真实包入口加载 npm 插件
```

CLI 拆分为：

```text
src/cli/
├── index.ts
├── agent-command.ts
└── plugin-command.ts
```

`src/tools/plugin-loader.ts` 保留本地单文件插件职责。
`src/tools/registry.ts` 增加来源信息，但保持现有 `get()`、`list()` 和 `validate()`
返回行为兼容。

包管理器子进程需要超时、取消、进程组终止和有界输出。应把
`src/tools/builtin/bash.ts` 中相应的通用能力提取到标准 Node.js API 实现的
`src/process/runner.ts`，供 Bash 工具和 `BunPackageManager` 复用；不得使用 `Bun.*`
专有 API。

## 8. 工具来源与冲突

Registry 内部保存：

```ts
interface ToolSource {
  kind: "builtin" | "local" | "npm";
  pluginName?: string;
  pluginVersion?: string;
  path?: string;
}

interface RegisteredTool {
  definition: ToolDefinition;
  source: ToolSource;
}
```

保留：

```ts
get(name): ToolDefinition | undefined;
list(): ToolDefinition[];
validate(name, input): ValidationResult;
```

新增：

```ts
source(name): ToolSource | undefined;
entries(): RegisteredTool[];
```

加载优先级为：

1. 内置工具；
2. 用户全局 npm 插件；
3. 项目 npm 插件；
4. 用户手写 `.ts` 插件；
5. 项目手写 `.ts` 插件；
6. `--plugin` 指定的临时插件。

项目安装与全局安装存在同名 npm 包时，先在包级选择项目版本，并跳过全局版本。
除此以外，两个来源导出同名工具时拒绝后加载者并报告双方来源。任何第三方工具都
不能覆盖内置工具。

## 9. CLI 设计

### 9.1 安装

```bash
coden plugin install npm:@scope/name
coden plugin install npm:@scope/name@^1.2.0
coden plugin install npm:@scope/name --global
coden plugin install npm:@scope/name --allow-scripts
```

默认项目级。`npm:` 是 CodeN 的来源协议标识，首版拒绝 `git:`、`file:`、URL 和
没有 `npm:` 前缀的安装请求。`--yes` 可跳过普通安装确认，但不能隐式开启生命周期
脚本。

同一请求已满足时不修改文件。更改版本范围时重新解析依赖并更新 lockfile。成功后输出实际版本、作用域、工具列表、脚本策略和重启提示。

### 9.2 删除

```bash
coden plugin remove @scope/name
coden plugin remove @scope/name --global
```

删除在临时 Runtime 中重建依赖树，校验成功后再提交。

### 9.3 列表

```bash
coden plugin list
coden plugin list --project
coden plugin list --global
```

默认同时列出项目和全局插件，显示包名、实际版本、请求范围和工具数量，并标记被项目同名包遮蔽的全局安装。

### 9.4 同步

```bash
coden plugin sync
coden plugin sync --global
coden plugin sync --allow-scripts
```

项目同步从 `plugins.json` 生成 `package.json`，使用已提交的 lockfile 执行冻结安装。
缺少 lockfile 或清单与 lockfile 不一致时失败，不静默更新 lockfile。全局同步用于
修复全局 Runtime，不要求其 lockfile 进入版本控制。

首版不提供单独的 `update` 子命令；改变 `install` 的版本请求即可更新目标包。

### 9.5 兼容性

现有命令继续工作：

```bash
coden "修复测试"
coden --resume <session-id>
```

CLI 测试必须覆盖子命令与原位置参数的解析，避免 `plugin` 子命令破坏 Agent 启动路径。

## 10. 安装事务

安装流程：

1. 解析并校验 `npm:` specifier；
2. 解析目标作用域并获取作用域独占文件锁；
3. 展示完整权限提示并获得确认，明确安装校验会导入插件入口并执行其顶层代码；项目级安装确认后把工作区真实路径写入现有 `TrustStore`；
4. 读取原清单，在同级临时目录生成候选清单和 Runtime；
5. 调用 Bun 安装依赖，默认禁用生命周期脚本；
6. 读取目标包的 `package.json`；
7. 校验 CodeN 元数据、API 版本和入口真实路径；
8. 导入入口并校验单工具或多工具导出；
9. 校验整个候选 Registry 的工具冲突；
10. 写入事务标记并备份原清单和 Runtime；
11. 以重命名方式提交候选 Runtime 和清单；
12. 删除备份、事务标记和临时目录，释放文件锁。

捕获到普通失败时立即回滚。若进程在提交中崩溃，下次插件命令或 CodeN 启动根据
事务标记恢复上一套完整状态或完成提交，不能直接加载混合状态。并发插件命令在获取
锁失败时报告作用域正忙，不并行修改依赖环境。

删除和同步使用相同事务机制。同步使用冻结 lockfile，不能改变已提交的解析结果。

## 11. 安全模型

### 11.1 生命周期脚本

Bun 安装默认使用忽略脚本模式。只有显式传入 `--allow-scripts` 才允许运行
`preinstall`、`install` 或 `postinstall`；此时必须显示二次警告。`--yes` 不等价于
`--allow-scripts`。

生命周期脚本在插件协议可被验证前就可能执行，因此警告必须明确说明包及其传递依赖
将获得当前用户权限。即使脚本被禁用，安装器仍会在确认后导入插件入口来验证导出
协议，这会执行插件及其静态依赖的顶层代码；安装提示也必须明确这一点。

### 11.2 Registry

首版顶层安装源固定为公开 `https://registry.npmjs.org`，不主动传递用户凭据。
传递依赖仍由 Bun 根据上游包元数据解析；上游若声明 Git 等非 Registry 依赖，可能
访问 npmjs 以外的地址。完全限制传递依赖来源需要额外审查 lockfile，不属于首版。

### 11.3 项目信任

仓库中的 `.coden/plugins.json` 不代表自动信任：

- 项目级 `plugin install` 确认后记录工作区真实路径为可信；
- `plugin sync` 前要求信任当前工作区；
- Agent 启动加载项目 npm 插件前也检查工作区信任；
- 未信任时跳过项目 npm 插件并发出诊断；
- 全局插件由用户主动安装，不在每次启动时重复确认。

### 11.4 运行时权限

npm 插件在 CodeN 主进程中执行，可以访问文件、网络、环境变量和子进程。工具的
`risk` 只影响调用确认，不构成权限隔离。`AbortSignal` 只能协作取消。README、安装
提示和插件开发文档都必须说明 CodeN 插件不是安全沙箱。

## 12. 热重载妥协

本地 `.ts` 插件继续支持 `/reload`。npm 插件及其依赖由真实文件 URL 导入，会进入 Bun 模块缓存，无法在当前进程中可靠卸载。

因此：

- `/reload` 只保证重新读取本地 `.ts` 插件；
- npm 插件安装、删除或升级后提示重启 CodeN；
- `/reload` 重建 Registry 时可以重新注册当前进程已缓存的 npm 模块，但不承诺读取磁盘上的新版本。

## 13. 错误模型

新增稳定错误码：

```text
plugin.specifier_invalid
plugin.install_busy
plugin.install_failed
plugin.lock_missing
plugin.lock_outdated
plugin.metadata_missing
plugin.api_unsupported
plugin.entry_invalid
plugin.export_invalid
plugin.name_mismatch
plugin.tool_conflict
plugin.sync_failed
plugin.transaction_recovery_failed
```

错误应包含包名、作用域和可执行的修复建议，但不得输出环境变量、Registry 凭据或
完整用户配置。Bun stdout/stderr 使用有界收集；超时或取消时终止子进程组。

## 14. 测试策略

```text
test/plugins/
├── specifier.test.ts
├── manifest.test.ts
├── package-metadata.test.ts
├── installer.test.ts
├── transaction.test.ts
├── installed-loader.test.ts
└── plugin-command.test.ts

test/fixtures/npm-plugins/
├── single-tool/
├── multi-tool/
├── with-dependency/
├── missing-metadata/
├── unsupported-api/
├── escaped-entry/
└── conflicting-tools/
```

### 14.1 单元测试

覆盖：

- scoped/unscoped 包名和版本请求解析；
- 非 npm 来源拒绝；
- 清单校验和确定性序列化；
- Runtime `package.json` 确定性生成；
- CodeN 元数据和入口边界；
- 单工具、多工具归一化；
- 工具来源、同名包遮蔽和冲突报告；
- 项目级与全局路径。

### 14.2 Installer 和事务测试

通过可注入的 `PackageManager` 使用假实现，离线覆盖：

- 安装、删除和同步成功；
- 安装或协议校验失败后回滚；
- 默认禁止脚本，显式选项才允许脚本；
- lockfile 缺失或不匹配；
- 临时目录清理；
- 并发锁拒绝；
- 提交各阶段崩溃后的恢复；
- 原子替换失败时保留原环境。

### 14.3 加载测试

本地 fixture 模拟完整 npm 包，覆盖：

- 相对文件导入和第三方依赖；
- 单工具与多工具；
- API 不兼容、包名不匹配、入口逃逸；
- 内置工具冲突；
- 全局同名包被项目版本遮蔽；
- 不同包导出同名工具。

### 14.4 CLI 测试

通过注入安装服务避免访问网络，覆盖子命令解析、作用域选项、脚本选项、用户拒绝、非交互行为、退出码，以及现有 prompt 和 `--resume` 行为。

真实 npmjs 冒烟测试默认跳过，不纳入离线 `just check`。

## 15. 文档要求

README 和独立插件开发文档应说明：

- 安装、删除、列表和同步命令；
- npm 包元数据与单/多工具导出示例；
- 项目中哪些文件应提交；
- 生命周期脚本默认策略；
- npm 插件升级后需要重启；
- 插件拥有完整用户进程权限，不是安全沙箱。
