# 阶段一：工程基础

- 完成日期：2026-09-29
- 相关决策：ADR 0003（TypeScript 7 与工具链）、ADR 0005（依赖维护与持续集成）、ADR 0006（lint 规则与依赖方向检查）
- 背景决策（阶段零）：ADR 0001（TSX 而不是 SFC）、ADR 0002（地图库）、ADR 0004（模块边界）

阶段一的目标：在写任何业务代码之前，把"代码怎么组织、怎么检查、怎么保证质量"的基础搭好，并用实测确认每个工具真的按预期工作。

本文分两部分：第一部分记录做了什么、每项改动的目的；第二部分按主题整理可以学到的知识，以及每个设计的替代方案。各配置文件的逐项说明在 [config/](../config/) 目录，命令用法在 [commands.md](../commands.md)。

---

# 第一部分：做了什么

## 提交记录

| 提交 | 内容 |
|---|---|
| `e6a6774 chore: 添加 apps/web 应用骨架` | Vite + Vue + TSX 最小应用、三份 tsconfig、pnpm 安装脚本策略 |
| `bfe2521 docs: AGENTS.md 同步 ADR 0003 结论` | TS 7 相关约定写入 AGENTS.md |
| `fc57699 chore: 接入 oxlint 与依赖方向检查` | `.oxlintrc.json`、lint 依赖与脚本、`@yzt/*` 路径映射 |
| `a4ff138 docs: AGENTS.md 同步 ADR 0006 结论` | lint 约定写入 AGENTS.md |
| `320fe51 ci: 添加 CI 工作流并落地 ADR 0005 阶段 1 事项` | CI、冷却期、Node 版本声明、依赖脚本 |
| `fb6a85d docs: AGENTS.md 同步 ADR 0005 阶段 1 结论` | 依赖维护约定写入 AGENTS.md |
| `4306b55 chore: 移除 .oxlintrc.json 中的注释` | JSON 配置不写注释，说明移到 `docs/config/` |
| `4c9f6c5 docs: AGENTS.md 补充 JSON 注释与文档维护约定` | 文档维护规则写入 AGENTS.md |
| `0278a9d docs: 修正 AGENTS.md 中的 CODE_STYLE.md 文件名大小写` | 代码风格文档改名为 `code-style.md` |
| `chore: docs/ 与 .claude/launch.json 纳入 git` | 文档随代码版本化；也就是标签 `stage-1` 所在的提交 |

查看某一项的完整改动：`git show <提交号>`。查看整个阶段：`git log --oneline 875438b..stage-1`（`875438b` 是阶段零的最后一个提交）。

## 阶段一结束时的仓库结构

```
repo0527/
├─ .claude/launch.json          Claude 桌面端预览开发服务器用的启动配置
├─ .github/workflows/ci.yml     CI 工作流
├─ apps/web/                    应用包 @yzt/web
│  ├─ index.html                页面入口
│  ├─ package.json              应用依赖与脚本
│  ├─ tsconfig.json             只列出引用（solution 风格）
│  ├─ tsconfig.app.json         检查 src/
│  ├─ tsconfig.node.json        检查 vite.config.ts
│  ├─ vite.config.ts            Vite 配置
│  └─ src/app/                  应用装配层（目前只有入口和根组件）
│     ├─ main.ts
│     ├─ App.tsx
│     └─ App.module.scss
├─ scripts/pnpm-major.mjs       升级 pnpm 时规范版本范围（阶段零已有）
├─ docs/                        决策记录、配置说明、命令说明、阶段总结
├─ .editorconfig                格式规则（阶段零已有）
├─ .gitignore
├─ .oxlintrc.json               lint 配置
├─ AGENTS.md                    必须遵守的规则（给人和 AI 工具看）
├─ CLAUDE.md                    引用 AGENTS.md
├─ package.json                 workspace 根：共用工具、跨包脚本、环境声明
├─ pnpm-workspace.yaml          workspace 范围与 pnpm 设置
└─ pnpm-lock.yaml
```

`src/` 下目前只有 `app/`。`pages/`、`features/`、`shared/`、`libs/` 按 AGENTS.md 的规划，等到第一次需要时再创建。git 不跟踪空目录，提前建空目录也没有意义；而分层规则已经写进 lint 配置，目录一出现就受约束。

## 改动与目的

### 1. 创建 apps/web 应用骨架

| 改动 | 目的 |
|---|---|
| Vite 8 + Vue 3.5 + `@vitejs/plugin-vue-jsx` | 按 ADR 0001 用 TSX 写组件，由 Babel 处理 Vue 专有的 JSX 语义 |
| 只放 `main.ts`、`App.tsx`、`App.module.scss` | 先用最小应用把工具链跑通；router、pinia、element-plus 留到后续小步引入 |
| 包名 `@yzt/web` | 和 libs 将来的包名 `@yzt/<name>` 使用同一个作用域 |
| `sass-embedded` | 支持 `*.module.scss`（AGENTS.md 规定的样式写法） |
| `index.html` 标题沿用旧项目 | 保持和 yzt 一致 |
| `pnpm-workspace.yaml` 中 `@parcel/watcher: false` | pnpm 12 要求对有安装脚本的依赖明确表态 |
| `.gitignore` 加入 `dist/` | 构建产物不入库 |

验证：类型检查、生产构建通过；开发服务器实际渲染页面，CSS Modules 类名和样式生效，控制台无错误。

### 2. 实测 TS 7 工具链，定稿 ADR 0003

TS 7 用 Go 重写，不再提供传统的 JS API。阶段一要回答的问题是：哪些工具还能用？

| 实测 | 结果 |
|---|---|
| `tsc -b` 检查 Vue TSX：写 11 个"应该报错"的探针 | 全部报出，和 TS 6 的诊断逐条一致 |
| Element Plus 组件 props 的检查 | 能查出 |
| 插槽参数推断 | 推断不出来，TS 6 也一样，原因在 Vue 的 JSX 类型定义 |
| typescript-eslint 8.71 | 在 TS 7 下加载就报错退出 |
| 官方的 TS 6 并存方案 + typescript-eslint | 可用，示例约 9 秒 |
| oxlint + oxlint-tsgolint | 可用，示例不到 1 秒，不需要 TS 6 |

结论（ADR 0003 方案 1）：只用 TS 7；lint 用 oxlint；不引入依赖 TS JS API 的工具。

同时确定了 tsconfig 的写法：solution 风格、显式写出 `types` 等选项、`incremental` 配合 `tsc -b`（阶段二因 TS 7 增量检查的问题关闭，见 ADR 0009）、Vite 用 `resolve.tsconfigPaths` 读取路径别名。详见 [config/tsconfig.md](../config/tsconfig.md)。

### 3. 接入 lint，定稿 ADR 0006

| 改动 | 目的 |
|---|---|
| correctness、suspicious、perf 三类整类开启 | 旧代码统计显示这三类噪音小、价值高 |
| 按 AGENTS.md 约定逐条开启规则 | 让 `===`、`const`、避免 `any`、lodash 按需导入等约定由工具检查，而不是靠人记 |
| 类型感知规则 | 查出 `any` 扩散、未处理的 Promise 等类型检查查不到的问题 |
| eslint-plugin-boundaries（通过 `jsPlugins`） | 把 ADR 0004 的分层规则变成可执行的检查，连相对路径越界也能查出 |
| `@yzt/*` 只映射到 `index.ts` | 深层导入在类型检查阶段就失败 |
| 规则只用 `error` / `off`，关闭规则必须写原因 | 避免警告堆积、豁免失控 |

验证：在模拟分层的夹具里放了 18 处违规，各层工具合计全部拦截；又在真实仓库放了 13 类违规，全部报出、没有误报。详见 [config/oxlintrc.md](../config/oxlintrc.md)。

### 4. 最小 CI 与依赖维护（ADR 0005 阶段一事项）

| 改动 | 目的 |
|---|---|
| GitHub Actions：冻结安装 → 类型检查 → lint → 构建 | 在干净环境里保证每次提交都能通过全部检查 |
| Actions 用 commit SHA 固定 | 防止 tag 被改指向恶意代码 |
| `permissions: contents: read`、`persist-credentials: false` | 最小权限 |
| `minimumReleaseAge: 4320` | 新版本发布满 3 天才安装，降低装到恶意版本的风险 |
| `devEngines.runtime`（Node ^24） | Node 版本只在一处声明，本地 pnpm 校验、CI 读取 |
| 根目录 `typescript` 改为精确版本 | TS 不遵守语义化版本 |
| 新增根 `typecheck` 脚本 | CI 和本地使用同一条命令 |
| 依赖脚本加 `--include-github-actions`，大版本升级改为交互式 | 每月检查时一并覆盖 Actions；大版本逐个确认 |

验证：先把 git 会提交的文件复制到干净目录，从零执行 CI 的四个步骤，退出码全部为 0；推送后 GitHub 上的首次运行（提交 `fb6a85d`）全部步骤通过，耗时约 30 秒。详见 [config/ci-workflow.md](../config/ci-workflow.md)、[config/pnpm-workspace.md](../config/pnpm-workspace.md)、[config/package-json.md](../config/package-json.md)。

### 5. 文档与约定

| 改动 | 目的 |
|---|---|
| ADR 0003、0006 定稿，ADR 索引更新 | 记录决策当时的背景、候选方案和理由 |
| AGENTS.md 同步各项结论 | AI 工具会自动读取 AGENTS.md，必须遵守的规则要写在这里 |
| 本文、`config/`、`commands.md` | 作为学习资料和维护手册 |
| JSON 配置不写注释 | 说明集中在文档，配置文件只保留配置本身 |
| `docs/`、`.claude/launch.json` 纳入 git | 此前它们被排除在 git 之外（`docs/` 在阶段零，`launch.json` 在阶段一开头）；阶段一结束时改为提交，让决策记录和学习资料有版本历史，新 clone、worktree 和其他 AI 工具也能看到 |

## 遗留事项

| 事项 | 说明 |
|---|---|
| 开启 Dependabot 安全告警 | 需要在 GitHub 仓库设置中手动操作，只开告警 |
| `tsconfig.libs.json` | 创建第一个 libs 模块时添加（ADR 0006） |
| router、pinia、element-plus | 技术栈已确定，尚未引入 |
| 测试框架 | 待定，接入后加入 CI |
| CI 不检查格式 | 格式由 WebStorm 负责，没经过格式化的代码要在提交前手动格式化 |

---

# 第二部分：可以学到什么

每个主题按"是什么 → 本项目怎么做 → 为什么 → 替代方案"组织。

## 一、TypeScript

### 1. TS 7：用 Go 重写的编译器

**是什么**：TypeScript 7 用 Go 重写了编译器，官方称类型检查速度提升约 10 倍。代价是 7.0 没有提供传统的 JS API（`require('typescript')` 只能拿到版本号），官方计划在 7.1 提供一套新的 API。

**影响**：很多工具靠这套 JS API 工作：

- vue-tsc：检查 `.vue` 文件
- typescript-eslint：解析 TS 代码、提供类型信息
- 部分依赖分析、文档生成工具

**本项目怎么做**：只用 TS 7；选择不依赖 JS API 的工具。组件用 TSX（ADR 0001），所以不需要 vue-tsc；lint 用 oxlint，它的类型感知部分 tsgolint 本身就是基于 Go 版 TS 写的。

**替代方案**：

- 官方的并存方案：`typescript` 包名指向 `@typescript/typescript6`（命令 `tsc6`），TS 7 以别名 `@typescript/native` 安装。需要 JS API 的工具用 TS 6，类型检查用 TS 7
- 整体停留在 TS 6

**可以带走的经验**：一个核心依赖发生大版本变化时，先列出"谁依赖它的哪部分能力"，再逐个实测，而不是看文档下结论。

### 2. tsconfig 的几组关键概念

逐项说明见 [config/tsconfig.md](../config/tsconfig.md)，这里只列最值得理解的概念。

| 概念 | 要点 |
|---|---|
| `target` 和 `lib` | `target` 管语法，`lib` 管可用的 API。打包工具只转语法、不补 API，所以 `lib` 实际上约束了能用哪些浏览器 API |
| `types` | 控制自动加载哪些全局类型包；TS 6 起默认是空数组，要显式写出 |
| `moduleResolution: bundler` | 按打包工具的规则解析导入，认 `exports`，相对导入不用写扩展名 |
| `verbatimModuleSyntax` | 类型导入必须写 `import type`，让单文件转译器能安全地删除类型 |
| `jsx: preserve` + `jsxImportSource` | TS 只检查不转换 JSX；类型从 `vue/jsx-runtime` 读取 |
| project references + `tsc -b` | 按运行环境拆分配置，一条命令检查全部 |
| `incremental` | 配合 `tsc -b` 跳过没变化的项目（阶段二已关闭，见 ADR 0009） |
| `paths` | 路径别名；TS 7 移除了 `baseUrl`，路径相对于 tsconfig 所在目录 |

### 3. 类型检查只负责"类型"，编译交给别人

本项目的 TS 代码经过两条互相独立的路径：

```
类型：tsc（noEmit）             → 只报错，不产出文件
运行：Vite → Babel / Rolldown  → 转成 JS，不看类型
```

直接后果：

- 开发服务器和 `pnpm build` 都**不做类型检查**，类型错误的代码照样能运行、能构建
- 所以 `pnpm typecheck` 必须单独运行，CI 里也是单独一步

这是现代前端工具链的普遍做法：转译器每次只看一个文件，所以很快；类型检查需要看整个项目，交给专门的工具。`verbatimModuleSyntax` 就是为了让这两条路径不互相干扰。

### 4. Vue 组件在 TSX 中的类型

`jsxImportSource: 'vue'` 让 TS 使用 Vue 定义的 `JSX` 命名空间。TS 靠这个命名空间里的几个接口来检查 JSX：

| 接口 | 作用 | Vue 的定义 |
|---|---|---|
| `IntrinsicElements` | `<div>` 等原生元素有哪些属性 | 来自 `@vue/runtime-dom`；另有 `[name: string]: any`，所以拼错的标签名不报错 |
| `ElementAttributesProperty` | 组件的 props 从实例的哪个属性读取 | `$props` |
| `ElementChildrenAttribute` | 子元素（children）对应哪个属性 | **没有定义** |

最后一行解释了阶段一发现的现象：写在组件标签之间的插槽对象，TS 不会拿它和组件的 `SlotsType` 对照，所以插槽参数推断不出类型，插槽名写错也不报错。这是 Vue 类型定义的限制，和 TS 版本无关（TS 6、TS 7 结果一致）。应对办法是手动标注插槽参数的类型（AGENTS.md 规则）。

其余部分都能检查：

```tsx
defineComponent({
  props: {
    size: { type: String as PropType<'small' | 'large'>, default: 'small' }
  },
  emits: {
    select: (id: number) => id > 0
  },
  slots: Object as SlotsType<{ default: { row: Row } }>
});
```

- `PropType` 把运行时的 `String` 收窄成具体的字面量联合，`size="huge"` 会报错
- `emits` 写成对象时，校验函数的参数类型就是事件参数的类型，`onSelect={(id: string) => ...}` 会报错
- `SlotsType` 给组件内部的 `slots` 提供类型

### 5. 类型检查和类型感知 lint 的区别

两者都用到类型信息，但回答的问题不同：

| | 回答的问题 | 例子 |
|---|---|---|
| 类型检查（tsc） | 代码在类型上是否成立 | 把 `number` 传给要求 `string` 的参数 |
| 类型感知 lint | 代码类型上成立，但是否有风险 | `any` 被赋给有类型的变量；Promise 没有处理；`switch` 漏了联合类型的分支 |

`const data = await response.json()` 在类型上完全合法（`any` 可以赋给任何东西），tsc 不会报错；`no-unsafe-assignment` 会指出 `any` 正在扩散。这正好落实 AGENTS.md 的"外部数据先用 `unknown` 接收，再收窄类型"。

### 6. `any` 与 `unknown`

- `any`：关闭类型检查，可以对它做任何操作，错误会被带到后面的代码里
- `unknown`：表示"类型未知"，必须先用 `typeof`、`Array.isArray`、类型守卫等收窄，才能使用

外部数据（接口返回、`JSON.parse`、`localStorage`）的类型本来就无法保证，用 `unknown` 接收，等于强迫自己在边界处做校验。

## 二、工程化

### 1. monorepo 与 pnpm workspace

**是什么**：一个仓库里有多个包，共用一份 lockfile，统一安装依赖。

**本项目怎么做**：`apps/*` 放应用，`packages/*` 预留给以后拆出的库。现在只有 `apps/web` 一个包，libs 先放在应用内部（ADR 0004）。

**为什么用 pnpm**：

- 严格的 `node_modules`：每个包只能访问自己声明过的依赖，杜绝"没声明也能 import"的幽灵依赖
- 全局内容寻址存储：同一版本的包在磁盘上只存一份，各项目通过链接使用
- 供应链安全设置比较完善（冷却期、安装脚本控制）

**关键操作**：

| 操作 | 写法 |
|---|---|
| 在所有包里执行脚本 | `pnpm -r <脚本>`（默认不含根目录） |
| 在指定包里执行 | `pnpm --filter @yzt/web <脚本>` |
| 往根目录装依赖 | `pnpm add -Dw <包>` |

**替代方案**：npm / yarn workspaces；bun；Nx、Turborepo 这类在 workspace 之上提供任务编排和缓存的工具（项目规模小，目前用不到）。

### 2. lockfile

`pnpm-lock.yaml` 记录每个依赖（含间接依赖）解析出的精确版本和校验和，保证所有人、所有机器装到完全相同的依赖。

阶段一观察到的细节：

- lockfile 只记录校验和，不记录下载地址。本机用 npmmirror 镜像、CI 用 npm 官方源，可以共用一份 lockfile，下载后都按校验和验证
- `packageManagerDependencies` 连 pnpm 自己的版本也锁住了
- CI 用 `--frozen-lockfile`：lockfile 需要改动就直接失败，防止"CI 装到的和本地不一样"

### 3. 版本号与升级策略

| 写法 | 含义 | 本项目用于 |
|---|---|---|
| `^1.2.3` | 允许 `<2.0.0` 的更新 | 遵守语义化版本的一般依赖 |
| `1.2.3` | 只用这个版本 | TypeScript、Cesium、oxlint、oxlint-tsgolint |
| `^0.2.3` | 0.x 阶段小版本就可能有破坏性变化 | 按大版本对待 |

为什么 TypeScript 要精确锁定：TS 的小版本（例如 5.4 → 5.5）经常加强类型推断，原来能通过的代码可能出现新的类型错误，它不遵守"小版本不破坏兼容"的约定。

为什么 oxlint 要精确锁定：它本身遵守语义化版本，但本项目依赖的 `jsPlugins` 是 alpha 功能，明确不受语义化版本约束。

### 4. 供应链安全

这是阶段一投入最多的方向之一。依赖的依赖的依赖，任何一个被攻破，代码都会在你的机器和 CI 上执行。

| 措施 | 防的是什么 | 位置 |
|---|---|---|
| `minimumReleaseAge: 4320` | 刚发布的恶意版本 | `pnpm-workspace.yaml` |
| 显式配置冷却期（严格模式） | 找不到合格版本时悄悄用新版本 | 同上 |
| `allowBuilds` 逐个表态 | 依赖的安装脚本执行任意代码 | 同上 |
| lockfile 校验和 | 下载内容被篡改 | `pnpm-lock.yaml` |
| Actions 用 SHA 固定 | tag 被改指向恶意 commit | `ci.yml` |
| `permissions: contents: read` | Action 被攻破后拿到写权限 | 同上 |
| `persist-credentials: false` | 令牌残留在磁盘上 | 同上 |
| Dependabot 安全告警 | 已知漏洞 | GitHub 设置（待手动开启） |

可以继续了解：pnpm 的 `trustPolicy: no-downgrade`（包的可信等级下降时拒绝安装）；npm 的发布来源证明（provenance）。

### 5. 构建工具链

| 环节 | 工具 |
|---|---|
| 开发服务器、构建编排 | Vite 8 |
| 打包 | Rolldown（Vite 8 内置，Rust 实现） |
| TSX 编译 | `@vitejs/plugin-vue-jsx`（Babel） |
| SCSS 编译 | sass-embedded |
| 路径别名 | `resolve.tsconfigPaths` 直接读 tsconfig |

`resolve.tsconfigPaths` 体现了一个反复出现的原则：**同一件事只在一处定义**。路径别名只写在 tsconfig 的 `paths` 里，Vite、boundaries 插件、tsgolint 都从这里读取。如果 Vite 再配一份 `resolve.alias`，两份迟早会不一致。

CSS Modules：`App.module.scss` 里的 `.root` 构建后会变成 `._root_aubst_1` 这类带哈希的类名，样式天然只作用于当前组件。这是 TSX 下替代 SFC `scoped` 样式的方案（ADR 0001）。

**替代方案**：webpack、Rsbuild；样式方面有 UnoCSS / Tailwind 这类原子化 CSS。

### 6. lint 的设计

| 设计 | 理由 |
|---|---|
| 规则按分类整体开启 + 逐条挑选 | 整体开启保证覆盖面，逐条挑选避免互相矛盾的偏好 |
| 只用 `error` / `off` | 警告不会让检查失败，终将被忽略 |
| 关闭规则必须写原因，多余的关闭注释报错 | 让每一个例外都可追溯、可清理 |
| lint 不管格式 | 格式由 WebStorm 负责，一类规则只交给一个工具 |
| 依赖方向由 lint 检查 | 架构规则只写在文档里，一定会被慢慢破坏 |

**替代方案**：

| 方案 | 特点 |
|---|---|
| ESLint + typescript-eslint | 生态最成熟，但在 TS 7 下需要并存 TS 6 |
| Biome | lint + 格式化一体，Rust 实现；类型感知能力有限 |
| oxlint（本项目） | Rust 实现，速度快；类型感知由 tsgolint 提供 |

### 7. CI 的价值

本地检查通过，只能说明"在我的机器上可以"。CI 在一台干净的机器上从零执行，能发现：

- 依赖了没提交的文件（例如被 `.gitignore` 忽略、只存在于本机的文件）
- 改了 `package.json` 但没提交 lockfile
- 本机特有的环境差异（系统、Node 版本、全局安装的工具）

阶段一还用了一个本地模拟 CI 的办法：用 `git ls-files -co --exclude-standard` 列出会被提交的文件，复制到临时目录，从零安装并运行检查。

### 8. 环境版本声明

pnpm 和 Node 的版本都写在根 `package.json` 的 `devEngines` 里：

- pnpm 用 `onFail: download`：版本不对时自动下载正确版本
- Node 用 `onFail: error`：版本不对时直接报错

替代方案：`packageManager` 字段（Corepack）、`engines`、`.nvmrc` / `.node-version`、Volta。选 `devEngines` 是因为它把"需要什么环境"集中在一个标准字段里，pnpm 和 CI 的 Action 都能直接读取。

## 三、架构设计

### 1. 分层与依赖方向

```
app → pages → features → shared → libs
```

- 箭头表示"可以依赖"，反过来不行
- 越往右越通用、越稳定；越往左越具体、越容易变化
- 依赖只能从易变的一方指向稳定的一方，这样修改业务页面不会波及底层工具（稳定依赖原则）

features 之间不互相导入：每个业务域独立演化，需要共享的东西上移到 shared 或 libs。旧项目出现过 8 处 components 反向依赖 views，就是缺少这类约束的结果。

**替代方案**：按技术类型分目录（`components/`、`views/`、`stores/`），这是旧项目的做法，业务一多就很难看出模块边界；Feature-Sliced Design 等社区方法论，思路相近但层次和术语更多。

### 2. 让架构规则可以被执行

写在文档里的规则会被慢慢破坏，除非有工具在每次提交时检查。这类检查有时被称为"架构适应度函数"（fitness function）。

本项目用多层防线，每层拦截自己最擅长的问题：

| 防线 | 拦截什么 |
|---|---|
| tsconfig `paths` 只映射到 `index.ts` | 深层导入 libs 内部文件 |
| `tsconfig.libs.json`（将来） | libs 读取 `import.meta.env`、使用 `@/` |
| boundaries 插件 | 分层方向、跨 feature 导入、单元内外的导入写法、libs 的外部依赖 |
| `import/no-cycle` | 循环依赖 |
| 代码评审 | 工具覆盖不到的设计问题 |

一个细节值得记住：只检查导入**字符串**的规则（例如 `no-restricted-imports`），拦不住 `../layer/store` 这种相对路径越界；必须把导入**解析成真实文件**再判断它属于哪一层。这就是选择 boundaries 插件的原因。

### 3. libs：按"已经是一个包"来写

ADR 0004 要求 libs 下的模块现在就遵守包的规则，以后拆成独立包时只需要机械地移动文件：

| 规则 | 对应的设计原则 |
|---|---|
| 只有一个入口 `index.ts` | 明确的公开 API；内部实现可以随意调整 |
| 外部只用 `@yzt/<name>` 导入 | 调用方不关心模块放在哪里 |
| 内部只用相对路径 | 整个目录可以原样搬走 |
| 不读 `import.meta.env`、store、全局单例，依赖通过参数传入 | 依赖注入：模块可以脱离应用单独测试和复用 |
| utils、map-core、map-cesium 不依赖 Vue | 核心逻辑和框架解耦；map-vue 负责衔接，相当于适配器 |
| map-vue 只能动态导入 map-cesium | 把性能边界（Cesium 体积大、要懒加载）写进架构规则 |

旧项目的地图内核直接 import 了 API 模块、`ElMessage` 和图层树快照，所以既无法单独测试，也无法抽成独立的包。这些规则就是针对这个问题的。

### 4. ADR：记录决策而不只是结果

ADR（架构决策记录）记录四件事：背景、候选方案、决定、后果。

- 决定会过时，但"当时为什么这样选"能帮助以后判断：条件变了，决策要不要跟着变
- ADR 接受后不再修改正文；决策变化时写一份新的，并注明取代了哪一份。这样决策的演变过程是完整的
- 阶段一的 ADR 0003、0006 都在实测之后才定稿，"实测结果"也写进了 ADR

### 5. AGENTS.md：给人和 AI 工具的规则入口

项目同时使用多个 AI 编程工具，它们都会读取仓库里的约定文件。AGENTS.md 集中存放必须遵守的规则，CLAUDE.md 只引用它。

AI 工具每次会话都会把 AGENTS.md 整个读进上下文，文件越长，占用越多、重点越容易被淹没。所以规则分两层存放：

- AGENTS.md：必须遵守的规则，简短、可执行，自动加载
- `docs/`：理由、背景、学习资料，需要时再查阅

`docs/` 最初不进 git，结果 AGENTS.md 引用的 ADR 在新 clone 和 worktree 里都不存在。阶段一结束时改为一起提交，两层内容都有了版本历史。

## 四、工作方法

阶段一反复用到的几个方法，比具体配置更值得带走。

### 1. "没报错"不等于"生效了"

每一项检查都用"故意写错"的探针验证过：

- tsc：写 11 个预期错误，确认全部报出
- lint：在夹具里放 18 处违规、在真实仓库放 13 类违规
- boundaries：发现策略没生效，才查到 `checkAllOrigins` 和 `checkInternals` 默认是关闭的

如果只看"运行后没有报错"，这些问题都会被漏掉。

### 2. 对照实验定位原因

插槽参数推断不出类型：是 TS 7 的问题还是 Vue 的问题？用 TS 6 跑同一组探针，结果完全一致，说明和 TS 版本无关。再去读 Vue 的类型定义，找到缺少 `ElementChildrenAttribute`。

### 3. 最小化排查

boundaries 的策略不生效时，把配置缩减到只剩一条策略、只检查一个目录，逐个改变量（策略顺序、匹配写法、开关），很快定位到"后匹配的策略生效"和 micromatch 规范化 `./` 这两个问题。

### 4. 小心管道吞掉退出码

`pnpm lint | tail -3` 的退出码是 `tail` 的，不是 `pnpm lint` 的。验证命令是否成功时要去掉管道，或者先执行 `set -o pipefail`。

### 5. 决策前先确认可行性

设置冷却期之前，先分别用 3 天、7 天试装当前的 lockfile：3 天通过，7 天有 50 个条目不达标。把这个事实摆出来，选择就很清楚了。

## 五、替代方案汇总

| 领域 | 本项目选择 | 常见替代 | 没选的主要原因 |
|---|---|---|---|
| 组件写法 | TSX + `defineComponent` | SFC | 类型检查依赖 vue-tsc，而它需要 TS JS API（ADR 0001） |
| TS 版本 | 只用 TS 7 | TS 7 + TS 6 并存；只用 TS 6 | 两个版本增加复杂度；TS 6 放弃了速度优势 |
| lint | oxlint + tsgolint | ESLint + typescript-eslint；Biome | 前者需要 TS 6；后者类型感知能力有限 |
| 依赖方向检查 | boundaries（jsPlugins） | `no-restricted-imports`；自己写规则；dependency-cruiser | `no-restricted-imports` 查不出相对路径越界；自己写是重复造轮子；dependency-cruiser 是额外的独立工具，也没有实测它在 TS 7 下能否工作 |
| 格式化 | WebStorm + `.editorconfig` | Prettier；Biome | 用户以 WebStorm 为准，避免多个工具争夺同一类规则 |
| 包管理 | pnpm | npm、yarn、bun | 严格的依赖隔离和完善的供应链设置 |
| 构建 | Vite 8 | webpack、Rsbuild | Vue 生态的默认选择，开发体验好 |
| 样式隔离 | CSS Modules | SFC scoped；原子化 CSS | TSX 下没有 scoped |
| Node 版本声明 | `devEngines.runtime` | `.nvmrc`、Volta、写死在 CI | 版本来源只有一个 |
| CI 安装方式 | action-setup + setup-node | `pnpm/setup` | 后者的 v3.0.0 当时太新 |
| Actions 引用 | commit SHA | tag | tag 可以被移动 |
| 冷却期 | 3 天 | 1 天、7 天 | 覆盖 npm 72 小时撤回窗口；7 天需要降级 |

## 六、自测问题

读完本文和 `config/` 下的文档后，可以试着回答：

1. 为什么 `pnpm build` 成功了，代码里仍然可能有类型错误？
2. `target` 和 `lib` 分别管什么？为什么本项目要让 `lib` 和 Vite 的浏览器目标对齐？
3. 为什么开启 `verbatimModuleSyntax`？它和 Vite 的转译方式有什么关系？
4. `tsc -b` 不开 `incremental` 会怎样？
5. `@yzt/map-core/internal` 为什么在类型检查阶段就失败了？
6. 为什么 `no-restricted-imports` 不足以检查 feature 之间的依赖？
7. boundaries 的策略顺序为什么重要？"禁止 utils 依赖 vue"必须放在哪里？
8. `minimumReleaseAge` 显式写出来之后，行为有什么变化？
9. 为什么 GitHub Actions 要用 commit SHA 而不是 `v7` 这样的 tag？
10. 插槽参数推断不出类型，是 TS 的问题还是 Vue 的问题？怎么判断的？
11. 为什么类型感知 lint 能发现 tsc 发现不了的问题？举一个例子
12. libs 为什么不能读取 `import.meta.env`？需要配置时应该怎么做？
