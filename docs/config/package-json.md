# package.json 配置说明

对应文件：根目录 `package.json`、`apps/web/package.json`
相关决策：ADR 0003（TypeScript 7）、ADR 0005（依赖维护）、ADR 0006（lint）
脚本的详细用法见 [commands.md](../commands.md)

## 两个 package.json 的分工

pnpm workspace 里，每个目录都是一个独立的"包"，各自声明自己的依赖：

| 文件 | 身份 | 放什么 |
|---|---|---|
| 根 `package.json` | workspace 根 | 整个仓库共用的工具（lint、TS）、跨包脚本、pnpm 与 Node 的版本声明 |
| `apps/web/package.json` | 应用包 `@yzt/web` | 应用自己的运行时依赖和构建工具 |

判断一个依赖放哪里：只有应用用到的（Vue、Vite）放应用包；对整个仓库生效的（oxlint 扫描所有文件）放根目录。往根目录安装依赖要加 `-w`，例如 `pnpm add -Dw oxlint`。

## 根 package.json

### name 与 private

```json
"name": "repo0527",
"private": true
```

`private: true` 防止根目录被误发布到 npm。workspace 根只是容器，本身不是可发布的包。

### scripts

| 脚本 | 内容 | 说明 |
|---|---|---|
| `build` | `pnpm -r build` | 构建所有包 |
| `typecheck` | `pnpm -r typecheck` | 检查所有包的类型 |
| `lint` | `oxlint` | 从根目录检查整个仓库 |
| `lint:fix` | `oxlint --fix` | 自动修复可以安全修复的问题 |
| `test` | `pnpm -r test` | 运行所有包的测试（ADR 0010） |
| `deps:check` | `pnpm outdated -r --include-github-actions` | 检查过期的依赖和 GitHub Actions |
| `deps:update:within-range` | `pnpm -r update --include-github-actions` | 在版本范围内更新 |
| `deps:update:allow-major` | `pnpm update -r -i --latest --include-github-actions` | 交互式选择大版本升级 |
| `pnpm:update:project:latest` | 见 commands.md | 升级 pnpm 自身 |

`pnpm -r`（recursive）会在 workspace 的每个包里执行同名脚本，默认**不包括根目录自己**，所以根目录的 `build` 调用 `pnpm -r build` 不会无限递归。

`typecheck` 和 `build` 采用"根目录分发到各包"的写法，以后新增 `packages/*` 时，只要新包也有同名脚本，CI 不用改。`lint` 则直接在根目录运行一次，因为 oxlint 本来就是扫描整个仓库的。

### devEngines

```json
"devEngines": {
  "packageManager": { "name": "pnpm", "version": "^12", "onFail": "download" },
  "runtime": { "name": "node", "version": "^24", "onFail": "error" }
}
```

`devEngines` 声明"开发这个项目需要什么环境"。这是 npm 生态较新的标准字段，pnpm 会读取并校验。

`onFail` 决定版本不满足时怎么办：

| 值 | 行为 |
|---|---|
| `ignore` | 不检查 |
| `warn` | 打印警告，继续执行 |
| `error` | 直接失败 |
| `download` | 自动下载满足要求的版本来用 |

**packageManager 用 `download`**：本机的 pnpm 版本不对时，pnpm 会自动下载 12.x 来执行命令，并且在 lockfile 的 `packageManagerDependencies` 里锁定精确版本（当前是 12.6.0，含各平台二进制的校验和）。CI 里的 `pnpm/action-setup` 也读这个字段。

**runtime 用 `error`**：本机 Node 不是 24.x 时，所有 pnpm 命令都会直接报错。阶段一试过 `download`：pnpm 会把 Node 也精确锁进 lockfile（例如 `node@runtime:24.21.0`），并下载一份放进 `node_modules/.bin`。复现性最好，但下载要约 1 分钟，而且和 CI 的 `actions/setup-node` 重复装 Node，所以没有采用。CI 的 setup-node 通过 `node-version-file: package.json` 读取同一个声明。

常见替代方案：

| 方案 | 特点 |
|---|---|
| `packageManager: "pnpm@12.6.0"` | 传统写法，由 Corepack 读取；只能写精确版本 |
| `engines.node` | 主要用于约束"使用这个包的人"，默认只警告 |
| `.nvmrc` / `.node-version` | 给 nvm、fnm 等版本管理器读，pnpm 不校验 |
| Volta | 在 `package.json` 里用 `volta` 字段固定版本，需要安装 Volta |

### devDependencies

```json
"devDependencies": {
  "eslint-import-resolver-typescript": "^4.4.5",
  "eslint-plugin-boundaries": "^7.2.0",
  "oxlint": "1.85.0",
  "oxlint-tsgolint": "7.0.2003",
  "typescript": "7.0.2"
}
```

| 依赖 | 版本写法 | 用途 |
|---|---|---|
| `oxlint` | 精确 | lint 主程序；依赖的 `jsPlugins` 处于 alpha 阶段，不承诺语义化版本 |
| `oxlint-tsgolint` | 精确 | 类型感知规则，内置 Go 版 TS，要和 TS 一样精确锁定 |
| `eslint-plugin-boundaries` | `^` | 依赖方向检查，通过 oxlint 的 `jsPlugins` 运行 |
| `eslint-import-resolver-typescript` | `^` | 让 boundaries 按 tsconfig 的 `paths` 解析 `@/`、`@yzt/` |
| `typescript` | 精确 | TS 不遵守语义化版本，小版本也可能带来新的类型错误 |

版本写法的规则（ADR 0005）：

- `^1.2.3`：允许升级到 `<2.0.0` 的任意版本。适用于遵守语义化版本的包
- `1.2.3`：只用这个版本。适用于不遵守语义化版本的包
- `^0.x`：0.x 阶段小版本就可能有破坏性变化，按大版本对待

pnpm 会把 `eslint` 当作 `eslint-plugin-boundaries` 的 peer 依赖自动装上。项目实际不运行 ESLint，这是已知的代价（ADR 0006）。

## apps/web/package.json

```json
{
  "name": "@yzt/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@element-plus/icons-vue": "^2.3.2",
    "@vue/devtools-api": "^8.2.1",
    "axios": "^1.20.0",
    "element-plus": "^2.14.6",
    "pinia": "^4.0.3",
    "vue": "^3.5.43",
    "vue-router": "^5.3.1",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^24.19.0",
    "@vitejs/plugin-vue-jsx": "^5.1.6",
    "@vue/test-utils": "^2.5.1",
    "jsdom": "^30.1.1",
    "msw": "^2.15.0",
    "sass-embedded": "^1.105.0",
    "typescript": "7.0.2",
    "vite": "^8.3.1",
    "vitest": "^5.0.2"
  }
}
```

### name

`@yzt/web` 和 libs 将来的包名 `@yzt/<name>` 使用同一个作用域，一眼能看出属于同一个项目。脚本里用 `pnpm --filter @yzt/web <脚本>` 指定在哪个包里执行。

### type: module

让包里的 `.js` 文件按 ES 模块处理。Vite 的配置文件、以后可能出现的脚本都用 `import` / `export`，不用 CommonJS 的 `require`。

### dependencies 与 devDependencies

对于由 Vite 打包的应用，两者都会被安装，区别主要是语义：

- `dependencies`：代码运行时真正用到、会被打进产物的包，例如 `vue`
- `devDependencies`：只在开发和构建时使用的工具，例如 `vite`、`typescript`

保持这种区分，能让人一眼看出"用户浏览器里会跑哪些库"。以后如果把某个模块拆成独立包，这个区分也会直接影响使用方安装什么。

### 各依赖的选择理由

| 依赖 | 说明 | 常见替代 |
|---|---|---|
| `element-plus` | UI 组件库。组件显式具名导入，JS 由打包工具 tree-shake；样式全量引入 `dist/index.css`（约 345 KB，gzip 约 46 KB），主题映射见 [design/theme.md](../design/theme.md) | Naive UI、Ant Design Vue |
| `vue-router` | 路由，手写路由表、history 模式（ADR 0007）。5.x 把文件路由插件并进了核心包，所以会带来 unplugin、chokidar 等构建期依赖，本项目不启用文件路由，它们不会打进产物 | 4.6.x（旧版本线） |
| `pinia` | 状态管理，只用 setup store（约定见 AGENTS.md）。4.x 只提供 ESM | 3.x（支持 CommonJS，本项目用不到） |
| `@vue/devtools-api` | Pinia 4 的必需 peer 依赖，提供开发者工具集成。pnpm 会自动补装 peer，这里显式声明是为了让依赖关系一目了然；生产构建中不会用到 | — |
| `@element-plus/icons-vue` | Element 的图标组件。它本来就是 element-plus 的依赖，但 pnpm 不允许 import 没有声明的包，所以要自己声明 | — |
| `vite` | 开发服务器与构建工具，8.x 内部使用 Rolldown 打包 | webpack、Rsbuild |
| `@vitejs/plugin-vue-jsx` | 用 Babel 编译 Vue 的 TSX，支持 Vue 专有的 JSX 语义 | `@vitejs/plugin-vue`（SFC，ADR 0001 未采用） |
| `sass-embedded` | 编译 `*.module.scss`；通过嵌入协议调用原生 Dart Sass，比纯 JS 版 `sass` 快 | `sass`、Less、原生 CSS |
| `axios` | HTTP 请求，只在 `shared/http/client.ts` 中使用（ADR 0011） | ky、原生 fetch |
| `zod` | 接口返回值的校验与类型推断（ADR 0011） | valibot、手写类型守卫 |
| `msw` | 测试中在网络层模拟接口，只用 `msw/node`；安装脚本不放行（见 pnpm-workspace.md） | axios-mock-adapter |
| `vitest` | 测试运行器，复用 `vite.config.ts`（ADR 0010） | Jest |
| `@vue/test-utils` | Vue 官方的组件挂载与交互库 | — |
| `jsdom` | 测试时在 Node 里模拟 DOM | happy-dom（ADR 0010 有实测对比） |
| `@types/node` | 只给 `vite.config.ts` 提供 Node 类型 | — |
| `typescript` | 提供 `tsc` 命令，和根目录保持同一精确版本 | — |

`@types/node` 要跟随 Node 运行时的大版本（当前是 24），不要随 latest 升到 26。`pnpm deps:check` 会一直把它列为可升级，这是预期行为。

## 修改时的检查清单

- 新增依赖前，先确认现有依赖里没有同类库（AGENTS.md）
- 往根目录装依赖加 `-w`；精确锁定加 `-E`
- 改了 `devEngines.runtime`：同步检查 CI 能否装到对应的 Node，`@types/node` 的大版本是否一致
- 升级 `typescript`：根目录和 `apps/web` 两处同时改，保持同一版本；同时评估 `oxlint-tsgolint` 是否要跟着升
- 安装时出现 `ERR_PNPM_IGNORED_BUILDS`：在 `pnpm-workspace.yaml` 的 `allowBuilds` 里逐个决定，见 [pnpm-workspace.md](pnpm-workspace.md)
