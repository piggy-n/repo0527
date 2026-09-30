# tsconfig 配置说明

对应文件：`apps/web/tsconfig.json`、`apps/web/tsconfig.app.json`、`apps/web/tsconfig.libs.json`、`apps/web/tsconfig.node.json`
相关决策：ADR 0003（TypeScript 7）、ADR 0004（模块边界）、ADR 0006（依赖方向检查）、ADR 0016（第一个 libs 模块）

## 为什么拆成多个文件

浏览器代码（`src/`）和构建配置（`vite.config.ts`）运行在不同环境：前者能用 DOM、`import.meta.env`，后者运行在 Node 里、要用 Node 的类型。放在一个 tsconfig 里，就会出现"浏览器代码能调用 `fs`""配置文件能访问 `document`"这类类型上允许、运行时却出错的情况。

| 文件 | 检查范围 | 环境类型 |
|---|---|---|
| `tsconfig.json` | 不检查任何文件，只列出引用 | — |
| `tsconfig.app.json` | `src/` | DOM + `vite/client` |
| `tsconfig.libs.json` | `src/libs/`（不含测试） | DOM，不加载 `vite/client`，没有 `@/*` |
| `tsconfig.node.json` | `vite.config.ts`、`tools/` | Node |

这种写法叫 **solution 风格**：根 `tsconfig.json` 用 `"files": []` 表示自己不包含文件，再用 `references` 指向真正干活的配置。运行 `tsc -b`（build 模式）时，TS 会依次检查每个被引用的项目。

编辑器、Vite、oxlint（tsgolint）都能顺着 `references` 找到某个文件实际属于哪份配置，这一点在阶段一实测过。

## tsconfig.json

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.libs.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- `files: []`：根配置自己不检查任何文件，避免和子项目重复检查
- `references`：告诉 `tsc -b` 要检查哪些子项目

## tsconfig.app.json 逐项说明

### 增量检查（已关闭）

| 选项 | 值 | 说明 |
|---|---|---|
| `incremental` | 不设置（默认关闭） | 有意关闭，见下文和 ADR 0009 |
| `tsBuildInfoFile` | `./node_modules/.tmp/tsconfig.app.tsbuildinfo` | build 模式的记录文件位置，放在 `node_modules` 里，不进 git |

阶段一曾开启 `incremental`，让 `tsc -b` 跳过没有变化的文件。阶段一实测：在 `tsc -b` 下只写 `noEmit` 而不开 `incremental`，TS 每次都会因为"找不到输出的 .js 文件"判定项目过期，然后全量重查。TS 6 也是这样，属于 build 模式本身的规则。

阶段二发现 TS 7.0.2 的增量检查有问题：`declare global` 文件变化后，它不会重新检查依赖这些全局类型的文件，既会误报也会漏报。全量检查只慢约 0.3 秒，所以关闭了增量，正好利用上面这条规则让 `tsc -b` 每次都全量检查。

`tsBuildInfoFile` 仍然保留：不开 `incremental` 时，build 模式照样会写一份记录，只包含根文件和 `package.json` 列表，用来判断项目是否需要重查。不指定位置的话，它会出现在 `apps/web/` 目录下（阶段二实际遇到过）。

升级 TS 后想重新开启时，用下面的步骤复测：

1. 两份配置加回 `"incremental": true`
2. 新建 `src/shared/config/probe.ts`，内容为 `export const probeTypo = import.meta.env.VITE_APP_TITEL;`，运行 `tsc -b`，应报错
3. 删掉 `import-meta-env.ts` 中的 `ViteTypeOptions` 声明，再运行 `tsc -b`，应不报错
4. 恢复 `ViteTypeOptions`，再运行 `tsc -b`，应报错
5. 第 3、4 步都正确，才说明问题已修复；复测完删除探针文件

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
| `moduleDetection` | `force` | 每个文件都当作独立模块，即使没有 `import` / `export`（见下文） |
| `verbatimModuleSyntax` | `true` | 导入导出按原样保留，只用于类型的导入必须写 `import type` |

`moduleResolution` 的常见取值：

- `bundler`：认 `package.json` 的 `exports`，相对导入可以省略扩展名。适合 Vite 这类打包工具处理的代码
- `nodenext`：严格按 Node 的规则，相对导入必须写 `.js` 扩展名。适合直接在 Node 里运行、不经过打包的代码
- `node10` / `classic`：旧规则，TS 7 已移除

`moduleDetection: force` 的一个实际影响（阶段二已验证）：给第三方库扩充类型时（例如 `shared/router/route-meta.ts` 中的 `declare module 'vue-router'`），文件里不需要再写 `export {}`。如果文件不被当作模块，`declare module` 就成了环境模块声明，会遮住整个库原有的类型。官方文档示例里的 `export {}` 就是为了避免这个问题，而在本项目里 `force` 已经保证了这一点。反过来，要扩充全局接口（例如 `shared/config/import-meta-env.ts` 中的 `ImportMetaEnv`）时，必须写在 `declare global { ... }` 里，否则接口只在文件内部生效。

`verbatimModuleSyntax` 的意义：Vite 用的转译器（Babel、oxc、esbuild）每次只看一个文件，判断不出 `import { Foo }` 里的 `Foo` 是类型还是值。开启这个选项后，TS 强制要求类型导入写成 `import type`，转译器照着删掉就行，不会误删值、也不会残留类型导入。这也正好落实了 AGENTS.md 里"只用于类型的导入写 `import type`"的约定。

### JSX

| 选项 | 值 | 说明 |
|---|---|---|
| `jsx` | `preserve` | TS 不转换 JSX，原样交给后续工具 |
| `jsxImportSource` | `vue` | 从 `vue/jsx-runtime` 读取 JSX 的类型定义 |

分工是：`tsc` 只做类型检查，JSX 的真正编译交给 `@vitejs/plugin-vue-jsx`（内部是 Babel + Vue 的 JSX 插件）。Vue 的 JSX 有 `v-model`、`v-slots` 等专有语义，通用的 JSX 编译不认识这些写法，所以不能交给 TS 编译。

`jsxImportSource: 'vue'` 让 TS 使用 Vue 提供的 `JSX` 命名空间，因此组件的 props、emit 回调、原生元素属性都能被检查。已知局限：

- Vue 的 `JSX` 命名空间没有声明 `ElementChildrenAttribute`，所以插槽参数不会按 `SlotsType` 推断，写错插槽名也不报错，插槽函数的参数要手动标注类型（AGENTS.md 已有此规则）
- `v-model` 的值不做类型检查（阶段二用探针验证）：TS 对属性名里带短横线的 JSX 属性（如 `data-*`、`v-model`）不拿去和 props 对照。`<ElInput v-model={boolRef.value} />` 不报错，而 `<ElInput modelValue={boolRef.value} />` 会报错。所以双向绑定统一写 `modelValue` + `onUpdate:modelValue`（AGENTS.md 规则）。事件名按组件声明的写法来，例如 `ElPagination` 声明的是 `update:current-page`，就要写 `onUpdate:current-page`
- 组件上的透传属性只放行 `class`、`style`（阶段二验证）：`<ElButton id="x" />` 会报"属性 id 不存在"，因为组件的 props 类型里没有它。需要标记元素时用 `data-*`，它和 `v-model` 一样因为带短横线而不被检查

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

检查构建配置和 `tools/` 下的 Node 工具脚本（阶段二加入，见 [modules/system-title.md](../modules/system-title.md)）。结构和 app 配置基本相同，区别在于：

| 选项 | 值 | 区别 |
|---|---|---|
| `lib` | `["es2023"]` | 没有 `dom`，代码运行在 Node 里 |
| `types` | `["node"]` | 加载 `@types/node` |
| `include` | `["vite.config.ts", "tools"]` | 构建配置和工具脚本 |
| `allowImportingTsExtensions` | `true` | 允许 `import './sync.ts'`。Node 直接运行 TS 时要求写出扩展名；只能和 `noEmit` 一起用 |
| `erasableSyntaxOnly` | `true` | 只允许"删掉类型标注就能运行"的语法。Node 24 运行 `.ts` 时只做类型剥离，不编译 `enum`、`namespace` 等语法；写了会报 TS1294（已验证） |

它没有 JSX 和 `paths` 相关选项，因为这些文件用不到。

## 有意没有开启的选项

这些选项更严格或更激进，目前没有开启。以后需要时可以单独讨论：

| 选项 | 作用 | 没开的原因 |
|---|---|---|
| `noUncheckedIndexedAccess` | `arr[i]` 的类型带上 `undefined` | 更安全，但会让大量下标访问都要判空，先观察实际代码再决定 |
| `exactOptionalPropertyTypes` | 区分"属性不存在"和"值为 `undefined`" | 和不少第三方库的类型不兼容 |
| `erasableSyntaxOnly` | 禁止 `enum`、`namespace`、构造函数参数属性 | 会限制 TS 的面向对象写法，项目还在学习阶段，暂不限制 |
| `allowImportingTsExtensions` | 允许 `import './a.ts'` | 目前的导入都不写扩展名，用不到 |

## tsconfig.libs.json

阶段三创建第一个 libs 模块 `libs/ui` 时加入（ADR 0006、0016）。作用是在类型检查阶段拦住 libs 违反拆包规则（ADR 0004）的写法：

```json
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.libs.tsbuildinfo",
    "types": [],
    "paths": {
      "@yzt/*": ["./src/libs/*/index.ts"]
    }
  },
  "include": ["src/libs"],
  "exclude": ["src/libs/**/*.test.ts", "src/libs/**/*.test.tsx"]
}
```

| 选项 | 值 | 说明 |
|---|---|---|
| `extends` | `./tsconfig.app.json` | 其余选项与 app 相同，只覆盖下面几项，两份配置不会逐渐不一致 |
| `types` | `[]` | 不加载 `vite/client`，libs 里读取 `import.meta.env` 会报错 |
| `paths` | 只有 `@yzt/*` | `paths` 整体覆盖而不是合并，没有 `@/*`，libs 里用 `@/` 导入会报错 |
| `include` | `["src/libs"]` | 只检查 libs |
| `exclude` | 测试文件 | 测试不打包进模块，可以用 Vite 的特性（如 `?raw` 导入），仍由 app 配置检查 |

已验证：在 `src/libs/ui` 下放一个同时读取 `import.meta.env.VITE_APP_TITLE`、导入 `@/shared/config/app-config` 的探针文件，`tsc -b` 报出 TS2339（`ImportMeta` 上没有 `env`）和 TS2307（找不到模块），且只由这份配置报出；删掉探针后通过。

**libs 被检查两次**：`tsconfig.app.json` 的 `include` 是整个 `src`，所以 libs 的源码也会按 app 的规则检查一遍。这是有意保留的：如果把 libs 从 app 配置中排除，app 就要通过项目引用使用 libs 的类型，被引用的项目必须开启 `composite`（隐含输出声明文件），配置会复杂很多。多一次检查的耗时可以忽略。

**CSS Modules 的类型**：`*.module.scss` 的模块声明来自 `vite/client`，这份配置不加载它，libs 里的组件导入样式时要另外声明，写第一个带样式的组件时加入。

## 修改时的检查清单

- 改了 `paths`：同步检查 `vite.config.ts`、`.oxlintrc.json` 的 boundaries 元素定义，然后运行 `pnpm typecheck`、`pnpm lint`、`pnpm build`
- 改了 `lib` 或 `target`：确认和 Vite 的浏览器目标一致
- 新增 tsconfig：加进 `tsconfig.json` 的 `references`，设置独立的 `tsBuildInfoFile`；在 ADR 0009 被取代之前，不要开启 `incremental`
- 升级 TS：按上文"增量检查"一节的步骤复测，决定是否恢复增量检查
