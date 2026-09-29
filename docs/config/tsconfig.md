# tsconfig 配置说明

对应文件：`apps/web/tsconfig.json`、`apps/web/tsconfig.app.json`、`apps/web/tsconfig.node.json`
相关决策：ADR 0003（TypeScript 7）、ADR 0004（模块边界）、ADR 0006（依赖方向检查）

## 为什么拆成三个文件

浏览器代码（`src/`）和构建配置（`vite.config.ts`）运行在不同环境：前者能用 DOM、`import.meta.env`，后者运行在 Node 里、要用 Node 的类型。放在一个 tsconfig 里，就会出现"浏览器代码能调用 `fs`""配置文件能访问 `document`"这类类型上允许、运行时却出错的情况。

| 文件 | 检查范围 | 环境类型 |
|---|---|---|
| `tsconfig.json` | 不检查任何文件，只列出引用 | — |
| `tsconfig.app.json` | `src/` | DOM + `vite/client` |
| `tsconfig.node.json` | `vite.config.ts` | Node |

这种写法叫 **solution 风格**：根 `tsconfig.json` 用 `"files": []` 表示自己不包含文件，再用 `references` 指向真正干活的配置。运行 `tsc -b`（build 模式）时，TS 会依次检查每个被引用的项目。

编辑器、Vite、oxlint（tsgolint）都能顺着 `references` 找到某个文件实际属于哪份配置，这一点在阶段一实测过。

## tsconfig.json

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- `files: []`：根配置自己不检查任何文件，避免和子项目重复检查
- `references`：告诉 `tsc -b` 要检查哪些子项目

## tsconfig.app.json 逐项说明

### 增量检查

| 选项 | 值 | 说明 |
|---|---|---|
| `incremental` | `true` | 记录上次检查的结果，文件没变就跳过 |
| `tsBuildInfoFile` | `./node_modules/.tmp/tsconfig.app.tsbuildinfo` | 增量记录放在 `node_modules` 里，不进 git，删除依赖时一起清掉 |

阶段一实测：在 `tsc -b` 下，如果只写 `noEmit` 而不开 `incremental`，TS 每次都会因为"找不到输出的 .js 文件"判定项目过期，然后全量重查。TS 6 也是这样，属于 build 模式本身的规则。

### 语言与运行环境

| 选项 | 值 | 说明 |
|---|---|---|
| `target` | `es2023` | 语法按 ES2023 检查 |
| `lib` | `["es2023", "dom"]` | 允许使用哪些内置 API 的类型 |
| `types` | `["vite/client"]` | 自动加载的全局类型包 |

`target` 和 `lib` 的区别：

- `target` 管**语法**，例如能不能写类字段、`?.`
- `lib` 管**API**，例如能不能调用 `Array.prototype.toSorted`

Vite 构建时只转换语法，不会给 API 打补丁。所以 `lib` 实际上是在约束"代码里能用哪些浏览器 API"。选 `es2023`，是为了和 Vite 默认的浏览器目标（Baseline Widely Available）大致对齐。如果写到了更新的 API（例如 ES2024 的 `Object.groupBy`），类型检查会直接报错，而不是等到旧浏览器上运行时才出问题。

TS 6 起，`dom` 已经包含了原来 `dom.iterable` 的内容，`for (const node of document.querySelectorAll('div'))` 这类写法只写 `dom` 就够了（阶段一已用 TS 7 验证）。

`vite/client` 提供三类类型：

- `import.meta.env` 的类型
- `import.meta.hot` 的类型
- 各类资源模块的声明，例如 `*.module.scss` 会被声明成 `CSSModuleClasses`，所以 `styles.root` 的类型是 `string`

TS 6 起 `types` 默认值变成了 `[]`（以前会自动加载 `node_modules/@types` 下的全部包），因此这里必须显式写出来。

### 模块系统

| 选项 | 值 | 说明 |
|---|---|---|
| `module` | `esnext` | 按最新的 ES 模块语法检查 |
| `moduleResolution` | `bundler` | 按打包工具的规则解析导入路径 |
| `moduleDetection` | `force` | 每个文件都当作独立模块 |
| `verbatimModuleSyntax` | `true` | 导入导出按原样保留，只用于类型的导入必须写 `import type` |

`moduleResolution` 的常见取值：

- `bundler`：认 `package.json` 的 `exports`，相对导入可以省略扩展名。适合 Vite 这类打包工具处理的代码
- `nodenext`：严格按 Node 的规则，相对导入必须写 `.js` 扩展名。适合直接在 Node 里运行、不经过打包的代码
- `node10` / `classic`：旧规则，TS 7 已移除

`verbatimModuleSyntax` 的意义：Vite 用的转译器（Babel、oxc、esbuild）每次只看一个文件，判断不出 `import { Foo }` 里的 `Foo` 是类型还是值。开启这个选项后，TS 强制要求类型导入写成 `import type`，转译器照着删掉就行，不会误删值、也不会残留类型导入。这也正好落实了 AGENTS.md 里"只用于类型的导入写 `import type`"的约定。

### JSX

| 选项 | 值 | 说明 |
|---|---|---|
| `jsx` | `preserve` | TS 不转换 JSX，原样交给后续工具 |
| `jsxImportSource` | `vue` | 从 `vue/jsx-runtime` 读取 JSX 的类型定义 |

分工是：`tsc` 只做类型检查，JSX 的真正编译交给 `@vitejs/plugin-vue-jsx`（内部是 Babel + Vue 的 JSX 插件）。Vue 的 JSX 有 `v-model`、`v-slots` 等专有语义，通用的 JSX 编译不认识这些写法，所以不能交给 TS 编译。

`jsxImportSource: 'vue'` 让 TS 使用 Vue 提供的 `JSX` 命名空间，因此组件的 props、emit 回调、原生元素属性都能被检查。已知局限：Vue 的 `JSX` 命名空间没有声明 `ElementChildrenAttribute`，所以插槽参数不会按 `SlotsType` 推断，写错插槽名也不报错，插槽函数的参数要手动标注类型（AGENTS.md 已有此规则）。

### 严格程度

| 选项 | 值 | 说明 |
|---|---|---|
| `strict` | `true` | 开启整组严格检查（`strictNullChecks`、`noImplicitAny` 等） |
| `noUnusedLocals` | `true` | 未使用的局部变量报错 |
| `noUnusedParameters` | `true` | 未使用的参数报错；有意不用的参数以 `_` 开头 |
| `noFallthroughCasesInSwitch` | `true` | `switch` 的 case 不能无意中穿透到下一个 |
| `skipLibCheck` | `true` | 不检查 `node_modules` 里的 `.d.ts` |

TS 7 的 `strict` 默认已经是 `true`，这里显式写出来，是为了不依赖默认值、读配置时一目了然。

`skipLibCheck` 是速度和稳定性的取舍：第三方包的类型声明之间偶尔会互相冲突，跳过检查可以避免被别人的问题卡住。代价是项目自己写的 `.d.ts` 也不会被检查。

### 输出与路径

| 选项 | 值 | 说明 |
|---|---|---|
| `noEmit` | `true` | 只检查不输出，编译交给 Vite |
| `paths` | 见下 | 路径别名 |
| `include` | `["src"]` | 检查范围 |

```json
"paths": {
  "@/*": ["./src/*"],
  "@yzt/*": ["./src/libs/*/index.ts"]
}
```

- `@/*`：应用内跨单元导入用的别名
- `@yzt/*`：libs 模块将来的包名，**只映射到各模块的 `index.ts`**。所以 `@yzt/map-core` 能解析，`@yzt/map-core/internal` 会被映射成 `src/libs/map-core/internal/index.ts`，这个文件不存在，TS 直接报"找不到模块"。"只能从入口导入"这条规则就这样由类型检查强制保证了
- TS 7 移除了 `baseUrl`，`paths` 里的相对路径以 tsconfig 文件所在目录为基准

读取这份 `paths` 的工具有三个，改动时要保持一致：

- Vite：`vite.config.ts` 里的 `resolve.tsconfigPaths: true`
- oxlint 的 boundaries 插件：`.oxlintrc.json` 的 `settings["import/resolver"]` 指向本文件
- tsgolint：自动发现

## tsconfig.node.json

结构和 app 配置基本相同，区别只有三处：

| 选项 | 值 | 区别 |
|---|---|---|
| `lib` | `["es2023"]` | 没有 `dom`，配置文件运行在 Node 里 |
| `types` | `["node"]` | 加载 `@types/node` |
| `include` | `["vite.config.ts"]` | 只检查构建配置 |

它没有 JSX 和 `paths` 相关选项，因为 `vite.config.ts` 用不到。

## 有意没有开启的选项

这些选项更严格或更激进，目前没有开启。以后需要时可以单独讨论：

| 选项 | 作用 | 没开的原因 |
|---|---|---|
| `noUncheckedIndexedAccess` | `arr[i]` 的类型带上 `undefined` | 更安全，但会让大量下标访问都要判空，先观察实际代码再决定 |
| `exactOptionalPropertyTypes` | 区分"属性不存在"和"值为 `undefined`" | 和不少第三方库的类型不兼容 |
| `erasableSyntaxOnly` | 禁止 `enum`、`namespace`、构造函数参数属性 | 会限制 TS 的面向对象写法，项目还在学习阶段，暂不限制 |
| `allowImportingTsExtensions` | 允许 `import './a.ts'` | 目前的导入都不写扩展名，用不到 |

## 以后会新增的配置

创建第一个 libs 模块时，要加上 `tsconfig.libs.json`（ADR 0006）：

- 只包含 `src/libs`
- `types` 不加载 `vite/client`，libs 里读取 `import.meta.env` 就会报错
- `paths` 里只有 `@yzt/*`，没有 `@/*`，libs 里使用 `@/` 导入就会报错

同时要把它加进 `tsconfig.json` 的 `references`。

## 修改时的检查清单

- 改了 `paths`：同步检查 `vite.config.ts`、`.oxlintrc.json` 的 boundaries 元素定义，然后运行 `pnpm typecheck`、`pnpm lint`、`pnpm build`
- 改了 `lib` 或 `target`：确认和 Vite 的浏览器目标一致
- 新增 tsconfig：加进 `tsconfig.json` 的 `references`，并设置独立的 `tsBuildInfoFile`
- 怀疑增量记录有问题：删除 `apps/web/node_modules/.tmp` 后重新运行 `pnpm typecheck`
