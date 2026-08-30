# Agent Skills 运行时支持设计

日期：2026-08-30

## 1. 背景

CodeN 当前只会把工作区根目录的 `AGENTS.md` 注入系统提示，不会发现或激活可复用的任务说明包。本设计为 CodeN 增加 [Agent Skills](https://agentskills.io/specification) 开放格式的运行时兼容能力，并扩展结构化文件工具的工作区外访问策略。

本功能遵循渐进式披露：启动时只向模型提供 Skill 名称和描述，模型判断适用后再通过工具加载完整 `SKILL.md`，其他资源继续按需读取。

## 2. 目标

1. 发现用户级和项目级标准 `SKILL.md`；
2. 校验元数据并处理同名覆盖；
3. 启动时只注入精简 Skill 目录；
4. 提供 `activate_skill` 内置工具加载完整说明；
5. 提供 `/skills` 查看当前有效 Skill；
6. 允许用户在交互授权后通过 `read`、`write`、`edit` 访问工作区外路径；
7. 默认保持 `--auto` 的工作区边界，只有显式组合 `--allow-outside-workspace` 才自动允许外部文件操作；
8. 保持 CodeN 现有微内核、权限确认和测试模式。

## 3. 非目标

首版不实现：

- Skill 安装、更新、删除或搜索；
- `skills-lock.json` 管理；
- `.coden/skills/` 或可配置 Skill 搜索路径；
- Skill 热重载或 `/reload-skills`；
- 基于关键词的宿主端自动激活；
- 对 `allowed-tools` 绕过或重写 CodeN 权限策略；
- 对 `bash` 命令实施工作区路径沙箱；
- 二进制或多模态 Asset 的专用读取工具。

## 4. 目录约定与覆盖顺序

CodeN 启动时扫描：

```text
~/.agents/skills/<skill-name>/SKILL.md
<workspace>/.agents/skills/<skill-name>/SKILL.md
```

仅扫描两个根目录的直接子目录，并要求入口文件名严格为 `SKILL.md`。同名时项目级 Skill 覆盖用户级 Skill。最终 Registry 中每个名称只有一个有效条目。

Skill 根目录及入口文件必须在其扫描根目录的真实路径范围内。通过目录或文件符号链接逃逸扫描根目录的条目不参与自动发现，避免 `activate_skill` 的免确认读取能力被用于读取任意文件。

## 5. Skill 元数据与校验

`SkillParser` 使用成熟的 YAML 解析库解析 frontmatter，不自行实现 YAML 子集。必填字段：

- `name`：1–64 个字符，只允许小写字母、数字和连字符，并与父目录名一致；
- `description`：非空字符串，最长 1024 个字符。

标准可选字段包括 `license`、`compatibility`、`metadata` 和实验性的 `allowed-tools`。解析器接受这些字段；未知字段为保持前向兼容而忽略。`allowed-tools` 只作为 Skill 元数据保留，不能降低或绕过 CodeN 的工具权限。

单个 `SKILL.md` 最大为 1 MiB。无效、不可读或超限的 Skill 被跳过，不阻止其他 Skill 或 CodeN 启动。普通模式保持输出简洁，`--verbose` 显示具体路径和失败原因。

## 6. 架构

新增 `src/skills/` 子系统，职责分离如下：

### 6.1 SkillDiscovery

- 解析用户级和项目级扫描根目录；
- 枚举直接子目录；
- 执行真实路径边界检查；
- 将候选入口交给 Parser；
- 隔离单条目失败。

### 6.2 SkillParser

- 有界读取 `SKILL.md`；
- 解析 YAML frontmatter；
- 校验标准字段、名称和目录关系；
- 返回规范化 Skill 描述对象。

### 6.3 SkillRegistry

- 合并两个 Scope；
- 实现项目级覆盖；
- 按名称查询有效 Skill；
- 为系统提示和 `/skills` 提供稳定排序的只读视图；
- 激活时重新检查路径安全，避免发现后文件被替换。

### 6.4 activate_skill

新增一个内置只读工具：

```json
{
  "name": "activate_skill"
}
```

输入：

```json
{
  "name": "pdf-processing"
}
```

该工具只接受 Skill 名称，不接受任意路径。它从当前 Registry 查找条目，重新验证真实路径后返回完整 `SKILL.md` 和 Skill 的绝对根目录。已发现的用户级 `SKILL.md` 可由该工具自动读取，不触发工作区外授权。

不存在的名称返回 `skill.not_found`；发现后被删除、替换或变得不安全时返回 `skill.activation_failed`。工具错误不终止 Agent Runtime。

## 7. 渐进式披露与系统提示

启动时系统提示只追加有效 Skill 的名称、描述以及激活方式，例如：

```text
Available skills:
- pdf-processing: Use when reading or modifying PDF documents.
- testing-workflows: Use when implementing changes under TDD.

When a task matches a skill, call activate_skill before proceeding.
```

完整 `SKILL.md` 不在启动时注入。模型判断某项 Skill 与当前任务匹配后调用 `activate_skill`，完整说明以普通工具结果进入会话上下文。Skill 引用的 `references/`、`scripts/` 或其他资源不随激活一起加载；模型按需使用现有工具访问。

恢复历史会话时，CodeN 使用本次启动重新发现的目录刷新内存中的系统提示，历史用户、助手和工具消息保持不变。这样恢复会话不会继续使用过期的 Skill 目录。

## 8. `/skills` 命令

REPL 新增 `/skills`，并在 `/help` 中列出。该命令：

- 直接读取当前 `SkillRegistry`，不调用模型；
- 不写入对话历史，不消耗模型 Token；
- 按名称稳定排序；
- 显示 `name`、`description` 和 `project`/`user` 来源；
- 同名覆盖后只显示最终生效条目；
- 没有有效 Skill 时显示明确提示。

首版 Skill 仅在进程启动时发现，因此文件变化需要重启 CodeN 才会反映在 `/skills` 中。

## 9. 工作区外文件权限

### 9.1 统一路径判定

提取供 `read`、`write`、`edit` 共用的路径分类逻辑。已存在目标按最终真实路径判断；新文件按最近存在的真实父目录判断。工作区内的符号链接不能用于绕过外部访问策略。

路径分类发生在权限决策之前，实际执行时再次采用相同的安全解析结果或等价复核，避免检查与使用不一致。

### 9.2 模式矩阵

| 模式 | 工作区内 `read/write/edit` | 工作区外 `read/write/edit` |
|---|---|---|
| 默认交互模式 | 保持现有风险策略 | 动态按 `modify` 风险请求授权 |
| `--auto` | 自动允许 | 拒绝并显示红色工具错误 |
| `--auto --allow-outside-workspace` | 自动允许 | 自动允许 |

`--allow-outside-workspace` 必须与 `--auto` 一起使用，单独传入属于 CLI 参数错误。

### 9.3 会话授权

工作区外访问沿用现有 `allow_once`、`allow_session` 和 `deny` 决策。会话授权按工具名记录：

- 会话内允许 `read` 后，后续任意外部 `read` 自动通过；
- `write` 和 `edit` 分别拥有独立授权状态；
- 已有的工作区内工具授权也属于同一个工具级会话授权。

`activate_skill` 对 Registry 中已验证入口的自动读取是唯一 Skill 特例。通过普通 `read` 读取用户级 Skill 的附属资源仍按工作区外规则授权；通过 `write` 或 `edit` 修改用户级 Skill 也必须授权。

### 9.4 自动模式拒绝

在未提供 `--allow-outside-workspace` 的 `--auto` 模式下，外部文件调用不进入交互确认，而是返回类似以下工具错误：

```text
permission.outside_workspace_denied: rerun with --auto --allow-outside-workspace
```

结果标记为 `isError`，由终端错误样式显示为红色，同时保留在工具结果和 Trace 中供模型理解与修正。

### 9.5 Bash 边界

`bash` 保持当前行为，不纳入结构化路径判定。它仍以工作区为当前目录，但可通过命令访问外部路径。README 必须继续明确：权限分类是启发式防误操作机制，不是通用安全沙箱；`--allow-outside-workspace` 只控制 `read`、`write`、`edit`。

## 10. 数据流

启动与执行流程：

1. CLI 解析配置和 `--allow-outside-workspace`；
2. SkillDiscovery 扫描两个标准根目录；
3. SkillParser 校验候选条目；
4. SkillRegistry 合并 Scope；
5. CLI 用 Registry 目录构造当前系统提示；
6. 内置工具 Registry 注册 `activate_skill`；
7. Agent Runtime 开始会话；
8. 模型按任务需要激活 Skill；
9. 模型通过普通文件工具按需访问资源；
10. ToolExecutor 根据真实路径、交互模式和 CLI 开关完成授权或拒绝。

`/skills` 直接读取第 4 步生成的 Registry，不进入模型调用链。

## 11. 错误处理与可观测性

- 单个 Skill 发现失败不影响其他 Skill；
- 无 Skill 目录属于正常状态；
- 非法 YAML、字段错误、名称不匹配、文件超限和路径逃逸均产生可诊断失败；
- 普通模式不因无效 Skill 输出大量噪声；
- `--verbose` 展示失败条目、来源和原因；
- `activate_skill` 的未知名称和激活失败作为工具错误返回；
- 外部文件拒绝使用稳定错误码；
- 外部文件的授权结果继续发出既有权限与工具事件；
- Skill 错误不得覆盖内置工具或阻止 Agent Runtime 启动。

## 12. 测试策略

### 12.1 Skill 单元测试

- 发现用户级和项目级 Skill；
- 解析必填及可选 frontmatter；
- 拒绝非法名称、目录名不匹配、空描述、超长描述和超大文件；
- 项目级同名 Skill 覆盖用户级；
- 非法条目不影响其他条目；
- 拒绝符号链接逃逸；
- `activate_skill` 只能激活 Registry 条目；
- 用户级入口可免确认激活；
- 系统提示只包含目录元数据，不包含完整正文。

### 12.2 文件权限测试

针对 `read`、`write`、`edit` 覆盖：

- 工作区内行为保持不变；
- 交互模式外部路径触发 `modify` 授权；
- `allow_once`、`allow_session` 和拒绝行为；
- 会话授权按工具名生效；
- `--auto` 拒绝外部路径；
- `--auto --allow-outside-workspace` 自动允许；
- 单独使用新选项产生 CLI 参数错误；
- 已存在目标、新文件父目录和符号链接按真实位置分类；
- `bash` 行为不受影响。

### 12.3 CLI 与集成测试

- `/skills` 输出名称、描述、来源和稳定顺序；
- `/help` 包含 `/skills`；
- 无有效 Skill 时输出明确提示；
- 恢复会话采用当前 Skill 目录；
- ScriptedProvider 完成“查看目录、激活 Skill、按 Skill 执行”的工具循环；
- 外部操作拒绝以工具错误和终端错误样式呈现；
- 插件加载、会话恢复和上下文压缩的现有测试保持通过。

## 13. 文档

README 增加：

- Agent Skills 兼容范围；
- 两个 `.agents/skills/` 搜索路径和覆盖顺序；
- 最小 `SKILL.md` 示例；
- 渐进式披露与 `activate_skill`；
- `/skills` 用法；
- 工作区外文件权限矩阵；
- `--allow-outside-workspace` 的风险警告；
- `bash` 不受该结构化文件路径开关约束。

## 14. 验收标准

1. CodeN 能发现并列出标准用户级和项目级 Skill；
2. 项目级同名 Skill 确定性覆盖用户级；
3. 启动上下文只包含名称和描述；
4. 模型能通过 `activate_skill` 加载完整说明；
5. `/skills` 不调用模型且准确展示当前有效 Registry；
6. 交互模式可逐次或按会话授权外部 `read/write/edit`；
7. 普通 `--auto` 稳定拒绝外部结构化文件操作并显示错误；
8. `--auto --allow-outside-workspace` 可执行外部结构化文件操作；
9. 路径真实化和符号链接检查不能被用于绕过策略；
10. `bash` 的既有行为和风险说明保持一致；
11. README 完整记录兼容范围和安全边界；
12. `just check` 和发布构建通过，npm 发布文件集合不发生意外扩大。
