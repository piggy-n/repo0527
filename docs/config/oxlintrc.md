# .oxlintrc.json 配置说明

对应文件：根目录 `.oxlintrc.json`
相关决策：ADR 0003（为什么是 oxlint）、ADR 0004（分层与依赖方向）、ADR 0006（规则取舍）

## 整体结构

```
.oxlintrc.json
├─ $schema       编辑器补全与校验
├─ plugins       启用哪些内置规则集
├─ jsPlugins     通过 JS 运行的 ESLint 插件（boundaries）
├─ categories    按分类整体开启规则
├─ options       运行选项（类型感知、警告处理）
├─ settings      插件共享的设置（路径解析、分层定义）
├─ rules         逐条调整规则
└─ overrides     只对部分文件生效的调整
```

oxlint 允许在这个文件里写注释（JSONC），但本项目约定 JSON 文件不写注释，所有解释集中在本文档。

## $schema

```json
"$schema": "./node_modules/oxlint/configuration_schema.json"
```

指向 oxlint 自带的 JSON Schema。WebStorm 读取后，就能对字段名和规则名做补全、校验，写错的规则名会直接标红。

## plugins

```json
"plugins": ["eslint", "typescript", "unicorn", "oxc", "import", "vue", "promise", "vitest"]
```

| 插件 | 内容 |
|---|---|
| `eslint` | ESLint 核心规则的 Rust 实现 |
| `typescript` | typescript-eslint 规则的实现，其中一部分需要类型信息 |
| `unicorn` | 现代 JS 写法相关的规则 |
| `oxc` | oxc 自己的规则，多为明显的逻辑错误 |
| `import` | 导入导出相关，例如循环依赖 |
| `vue` | Vue 组件规则；阶段一实测，对 TSX 里的 `defineComponent` 同样生效 |
| `promise` | Promise 用法 |
| `vitest` | 测试文件的规则（阶段二加入，ADR 0010）。例如 `no-focused-tests` 在本地就能拦住误提交的 `it.only`，否则其他用例会被悄悄跳过（已验证，且对现有代码无误报） |

显式写出列表后，就只启用这些插件，不依赖 oxlint 的默认插件集。

## jsPlugins

```json
"jsPlugins": ["eslint-plugin-boundaries"]
```

oxlint 本体用 Rust 编写，`jsPlugins` 让它能在 Node 里加载现成的 ESLint 插件。这里用来运行 eslint-plugin-boundaries，做依赖方向检查。

注意：`jsPlugins` 目前是 alpha 功能，不承诺语义化版本，所以 oxlint 在 `package.json` 里精确锁定了版本。升级 oxlint 后要确认 boundaries 仍然正常（见文末"升级后的验证"）。

## categories

```json
"categories": {
  "correctness": "error",
  "suspicious": "error",
  "perf": "error"
}
```

oxlint 把约 870 条规则分成 7 类。阶段一用旧项目 yzt 的 `src`（289 个文件）统计过各类的报告数量：

| 分类 | 含义 | 旧代码报告数 | 处理 |
|---|---|---|---|
| correctness | 明确错误或无用的代码 | 43 | 整类开启 |
| suspicious | 很可能写错了 | 716 | 整类开启 |
| perf | 有性能更好的写法 | 42 | 整类开启 |
| pedantic | 很严格，偶有误报 | 1561 | 不开，逐条挑选 |
| style | 写法偏好 | 19290 | 不开，逐条挑选 |
| restriction | 禁止某些语言特性 | 4668 | 不开，逐条挑选 |
| nursery | 开发中的规则 | — | 不开 |

后三类不能整类开启，因为里面有大量互相矛盾、或和项目约定相反的偏好。例如 restriction 里有"禁止可选链""禁止 async/await"，style 里有"禁止三元表达式""对象键必须排序"。

suspicious 类里 `no-underscore-dangle` 在旧代码中报了 531 次，几乎都是 JS 类的 `_私有字段` 写法。这条规则保留，用来推动改为 TS 的 `private` 或 `#字段`。

规则只用 `error` 和 `off` 两级，不用 `warn`：警告不会让检查失败，时间一长就会被忽略，最后变成旧项目那样的"大量警告无人处理"。

## options

```json
"options": {
  "typeAware": true,
  "denyWarnings": true,
  "reportUnusedDisableDirectives": "error"
}
```

| 选项 | 作用 |
|---|---|
| `typeAware` | 开启需要类型信息的规则，由 `oxlint-tsgolint` 提供。它内置 Go 版 TS，自己读取 tsconfig，不依赖 `typescript` 包的 JS API |
| `denyWarnings` | 万一有规则被设成 `warn`，也按失败处理，是"只用两级"的兜底 |
| `reportUnusedDisableDirectives` | 不再需要的 `oxlint-disable` 注释会报错，避免残留过时的豁免 |

在代码里关闭规则的写法（阶段一已验证可用）：

```ts
// oxlint-disable-next-line no-console -- 原因
console.log(value);
```

## settings

```json
"settings": {
  "import/resolver": {
    "typescript": {
      "project": ["apps/web/tsconfig.app.json", "packages/*/tsconfig.lib.json"],
      "noWarnOnMultipleProjects": true
    }
  },
  "boundaries/elements": [
    { "type": "app", "pattern": "apps/web/src/app" },
    { "type": "pages", "pattern": "apps/web/src/pages" },
    { "type": "feature", "pattern": "apps/web/src/features/*", "capture": ["name"] },
    { "type": "shared", "pattern": "apps/web/src/shared" },
    { "type": "lib", "pattern": "apps/web/src/libs/*", "capture": ["name"] },
    { "type": "package", "pattern": "packages/*", "capture": ["name"] }
  ]
}
```

### import/resolver

boundaries 要知道 `@/features/map` 实际指向哪个文件，才能判断它属于哪一层。这里指定用 `eslint-import-resolver-typescript`，按各 tsconfig 的 `paths` 解析别名。相对路径也会被解析成真实文件，所以 `../layer/store` 这种写法同样能被识别。

`project` 是数组：应用和每个 workspace 包各有自己的 tsconfig（阶段二加入 `packages/icons` 后改为数组）。有多个项目时解析器会打印一条性能提示，`noWarnOnMultipleProjects` 用来关掉它。

### boundaries/elements

把目录定义成"元素"（element），也就是分层检查的基本单位：

- `type`：元素类型，对应 ADR 0004 的分层
- `pattern`：匹配的目录。路径相对于仓库根目录，因为 lint 从根目录运行
- `capture`：把 `*` 匹配到的部分记成变量。`features/*` 的 `name` 让每个 feature 成为独立元素，`features/map` 和 `features/layer` 因此被视为两个不同的单元

`package` 元素对应 `packages/*` 下的 workspace 包（ADR 0014）。阶段二实测：没有这条定义时，`@yzt/icons` 经 `node_modules` 下的符号链接解析，被当作外部依赖放行，包内代码导入应用代码也不会报错；加上定义后，解析出的真实路径落在 `packages/icons` 中，被识别为 package 元素，双向的违规都能查出。

## rules

规则分三组，文件里用空行隔开。

### 第一组：对整类开启的规则做调整

| 规则 | 设置 | 原因 |
|---|---|---|
| `typescript/no-unsafe-type-assertion` | `off` | 会把 Vue 的 `String as PropType<...>`、`Object as SlotsType<...>` 误报为不安全断言，这是 Vue 声明 props 和插槽类型的标准写法 |
| `import/no-unassigned-import` | 放行 `*.css`、`*.scss` | 样式文件只能以副作用方式导入（`import './a.scss'`），不放行就会误报 |

### 第二组：对应 AGENTS.md 约定逐条开启

| 规则 | 对应约定 |
|---|---|
| `eqeqeq` | 只用 `===` |
| `no-var`、`prefer-const` | 只用 `const` / `let` |
| `typescript/no-explicit-any` | 避免 `any` |
| `no-console`（允许 `warn`、`error`） | 不留调试输出 |
| `import/no-cycle` | 模块之间不能循环依赖 |
| `import/no-duplicates` | 同一模块不重复导入 |
| `no-restricted-imports` | lodash 用法（见下） |

```json
"no-restricted-imports": ["error", {
  "paths": [{ "name": "lodash-es", "importNames": ["default"], "message": "lodash-es 按需具名导入" }],
  "patterns": [{ "regex": "^lodash(/|$)", "message": "使用 lodash-es 并按需具名导入" }]
}]
```

- `paths`：禁止 `import _ from 'lodash-es'`（默认导入整个库，影响 tree-shaking）
- `patterns`：禁止 `lodash` 和 `lodash/xxx`（CommonJS 版本）

### 第三组：类型感知规则

| 规则 | 查什么 |
|---|---|
| `no-unsafe-argument`、`no-unsafe-assignment`、`no-unsafe-call`、`no-unsafe-member-access`、`no-unsafe-return` | `any` 通过参数、赋值、调用、属性访问、返回值扩散到其他代码。例如 `response.json()` 返回 `any`，直接赋给变量会报错，要先用 `unknown` 接收再收窄 |
| `no-misused-promises` | 在期望同步函数的地方传入了返回 Promise 的函数 |
| `only-throw-error` | 只能 `throw` Error 对象 |
| `prefer-promise-reject-errors` | `reject` 的也必须是 Error |
| `switch-exhaustiveness-check` | 对联合类型做 `switch` 时漏掉了分支 |
| `no-deprecated` | 使用了标记为 `@deprecated` 的 API，迁移旧代码时很有用 |

`no-floating-promises`（没有处理的 Promise）等规则属于 correctness 类，已经随整类开启。

## overrides

`overrides` 按文件匹配，只对匹配的文件调整规则。

### JS 文件关闭 no-unsafe 系列

```json
{ "files": ["**/*.{js,mjs,cjs}"], "rules": { "typescript/no-unsafe-*": "off" } }
```

（实际文件里是五条规则逐个列出。）JS 文件没有类型标注，也不属于任何 tsconfig，tsgolint 会把很多值推断成 `any` 或错误类型。阶段一中 `scripts/pnpm-major.mjs` 因此报了 31 条无意义的错误。

### scripts 允许 console

```json
{ "files": ["scripts/**", "apps/web/tools/**", "packages/*/tools/**"], "rules": { "no-console": "off" } }
```

命令行脚本本来就通过 console 输出结果。`apps/web/tools/`、`packages/*/tools/` 是阶段二加入的 Node 工具目录（例如 `pnpm title:generate`、`yzt-icons`）。

### packages 的依赖方向

```json
{ "files": ["packages/*/src/**", "packages/*/tools/**"], "rules": { "boundaries/dependencies": [ ... ] } }
```

workspace 包只允许依赖外部模块、Node 内置模块和本包内部的相对路径，不能导入应用或其他单元的代码，保证包可以脱离应用单独使用。阶段二用探针验证：`packages/icons` 导入 `apps/web/src/shared/...` 会报错。

策略比应用少：除了下文的 0（外部模块）、1（单元内部相对路径），还有一条放行 Node 内置模块（boundaries 把 `node:fs` 这类归为 `origin: "core"`），供 `tools/` 使用。浏览器端的 `src/` 不需要单独禁止内置模块：`tsconfig.lib.json` 没有加载 Node 类型，导入 `node:fs` 会直接类型报错。

### apps/web/src 的依赖方向

应用源码的分层规则都在这个 override 里。

## boundaries/dependencies 详解

### 规则选项

```json
{
  "default": "disallow",
  "checkAllOrigins": true,
  "checkInternals": true,
  "policies": [ ... ]
}
```

| 选项 | 作用 |
|---|---|
| `default: "disallow"` | 没有被任何策略放行的依赖一律禁止，采用白名单思路 |
| `checkAllOrigins: true` | 同时检查外部包（npm 依赖）。默认只检查项目内文件，不开的话"utils 不能依赖 vue"这类策略写了也不生效 |
| `checkInternals: true` | 同时检查同一元素内部的导入。默认不检查，不开的话"单元内部只用相对路径"无法生效 |

后两项默认都是关闭的，阶段一踩过这个坑：策略写对了却不报错，排查后才发现是这两个开关。

### 策略执行顺序：后匹配的生效

一条依赖可能同时匹配多条策略，此时**排在后面的策略说了算**。阶段一实测：把"禁止 utils 依赖 vue"放在"放行所有外部包"之后，能报出违规；顺序反过来，禁止策略就静默失效了。

所以本文件的策略顺序是：先写宽泛的放行，再写具体的放行，最后写禁止。

### 策略逐条说明

| 序号 | 策略 | 含义 |
|---|---|---|
| 0 | 放行所有外部包 | 任何单元都可以用 npm 依赖（后面的禁止策略会再收紧） |
| 1 | 放行单元内部的相对导入 | 同一元素内部的导入必须写成相对路径，写成 `@/` 别名就不匹配，会被默认规则禁止 |
| 2 | app → pages、feature、shared，且写成 `@/` 别名 | 应用装配层可以组合下面所有层 |
| 3 | pages → feature、shared，且写成 `@/` 别名 | 页面只负责组合 features |
| 4 | feature → shared，且写成 `@/` 别名 | feature 之间不互相导入 |
| 5 | app、pages、feature、shared → lib，且写成 `@yzt/*` | 引用 libs 只能用包名，不能用 `@/libs/...` 或相对路径 |
| 6 | app、pages、feature、shared → package，且写成 `@yzt/*` | 引用 workspace 包只能用包名，不能用相对路径绕过包的入口（阶段二加入，已验证） |
| 7 | ui、map-core、map-cesium、map-vue → utils，且写成 `@yzt/*` | libs 之间的依赖也只能用包名 |
| 8 | map-cesium、map-vue → map-core，且写成 `@yzt/*` | 地图内核被三维和 Vue 衔接层使用 |
| 9 | map-vue → map-cesium，且只能动态 `import()` | Cesium 体积大，只能懒加载 |
| 10 | 禁止 utils、map-core、map-cesium 依赖 Vue 生态 | 这三个模块要保持框架无关 |
| 11 | 全局禁止 `mapbox-gl` | 2.0 起为专有许可（ADR 0002） |

几个写法细节：

- **`"@(./|+(../))**"`（策略 1）**：意思是"以 `./` 开头，或以一个或多个 `../` 开头"。
  - 不能写成 `./**`：底层的 micromatch 会把 `./` 规范化掉，导致 `./store` 匹配不上（阶段一实测）
  - 阶段一原来写的是 `".{,.}/**"`（展开为 `./**`、`../**`），阶段二发现它匹配不了 `../../router/routes`：micromatch 的 `**` 不匹配以点开头的路径段，第二个 `..` 过不去，所以单元内部往上跨两层的相对导入被误报。改成现在的写法后，用 micromatch 4.0.8 实测：`./a`、`../a`、`../../a`、`../../../a` 都匹配，`@/app/x`、`vue` 不匹配；用 lint 实测：两层相对导入通过，单元内部改用 `@/` 别名仍然报错
- **`"@/**"`（策略 2–4）**：跨单元导入必须写成 `@/` 别名（AGENTS.md"跨单元只用别名"）。阶段二之前这三条策略没有限制写法，用 `../../../shared/...` 这样的相对路径跨单元导入也会放行；2026-09-30 补上，用探针验证 app → shared、pages → feature、feature → shared 改用相对路径后各报 1 处，现有代码没有违规。`@/**` 不会误匹配 `@yzt/icons`、`@element-plus/...` 这类以 `@` 开头的包名（已用 micromatch 验证）
- **`"@yzt/*"`（策略 5–9）**：micromatch 的 `*` 不跨越 `/`，所以 `@yzt/map-core/internal` 不匹配。不过这种深层导入在 tsconfig 那一关就已经解析失败了
- **`"nodeKind": "dynamic-import"`（策略 9）**：boundaries 会区分静态 `import` 和动态 `import()`，前者的 `nodeKind` 是 `import`
- **`captured.name`**：用 `{a,b}` 花括号语法匹配多个模块名

### 能查什么、不能查什么

阶段一在真实仓库放了 13 类违规，全部报出，没有误报：

| 违规 | 由谁拦截 |
|---|---|
| 跨 feature 导入（别名或相对路径） | 策略 4 |
| 跨单元用相对路径（如 app 用 `../../shared/...`） | 策略 2–4（阶段二补充） |
| 单元内部使用别名 | 策略 1 |
| 引用 libs 没写 `@yzt` | 策略 5 |
| shared 依赖 feature、pages 依赖 app | 策略 2–4 |
| utils 依赖 vue | 策略 10 |
| 静态导入 map-cesium | 策略 9 |
| 应用用相对路径导入 workspace 包的内部文件 | 策略 6（阶段二） |
| workspace 包导入应用代码 | packages override（阶段二） |
| lodash 默认导入、整包 lodash | `no-restricted-imports` |
| 未处理的 Promise、`any`、`console.log`、`==` | 各自的规则 |

有两类问题不归 lint 管，而是交给 TS：

- 深层导入 `@yzt/x/internal`：tsconfig 的 `paths` 只映射到 `index.ts`，解析直接失败
- libs 读取 `import.meta.env`、使用 `@/`：由 `tsconfig.libs.json` 拦截（`no-restricted-properties` 检查不到 `import.meta`），见 [tsconfig.md](tsconfig.md)

## 维护指南

### 什么时候要改这个文件

| 场景 | 要改什么 |
|---|---|
| 新增一个 feature | 不用改，`features/*` 自动匹配 |
| 新增 ADR 0004 已列出的 lib 模块 | 不用改，策略里已经写好了名字 |
| 新增一个新名字的 lib 模块 | 在策略 6–9 中补充它的依赖关系，并同步 AGENTS.md 与 ADR |
| 调整分层 | 同时改 `boundaries/elements`、策略、tsconfig `paths`、AGENTS.md，并写新的 ADR |
| 新增 app 或 package | 补充对应的元素和 `import/resolver` 配置 |

### 调试方法

```bash
pnpm exec oxlint --print-config
```

打印合并后的最终配置，确认规则是否真的生效。

```bash
pnpm exec oxlint --debug=files
```

列出会被检查的文件。

```bash
ESLINT_PLUGIN_BOUNDARIES_DEBUG=1 pnpm lint
```

打印 boundaries 对每条依赖的描述，包括元素类型、`relationship`、`nodeKind`、`source`，是排查"策略为什么没匹配上"最直接的办法。上面是 bash 写法，PowerShell 里先执行 `$env:ESLINT_PLUGIN_BOUNDARIES_DEBUG=1`。

### 升级后的验证

升级 oxlint、boundaries 或 resolver 之后，除了 `pnpm lint` 通过，还要确认规则仍在生效：临时放入几处已知违规（例如跨 feature 导入、utils 导入 vue），确认都能报出后再删除。只看"没有报错"不能说明规则还在工作。
