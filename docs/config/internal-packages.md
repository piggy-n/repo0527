# workspace 内部包的配置约定

对应目录：`packages/*`（utils、ui、theme、icons、map-core、map-cesium、map-vue）
相关决策：ADR 0004（模块边界）、ADR 0014（第一个内部包）、ADR 0143（libs 全部搬成包）

## 什么是内部包

内部包（internal package）是只在本仓库内使用、不发布到 npm 的 workspace 包。它不单独构建，`package.json` 的 `exports` 直接指向 TS 源码，由使用方（`apps/yzt` 的 Vite）编译：

```
apps/yzt  ──依赖 "@mx/map-core": "workspace:*"──▶  node_modules/@mx/map-core（符号链接）──▶ packages/map-core
                                                    exports "." → ./src/index.ts
```

以后的地图项目放在这个仓库的 `apps/xxx`，所以不需要构建和发布（ADR 0143）。

## 包之间的依赖

```
utils ◀── ui
utils ◀── map-core ◀── map-cesium
utils、map-core ◀── map-vue ┄┄动态 import()┄┄▶ map-cesium
icons、theme 不依赖其他包
```

方向由 lint 检查，见 [oxlintrc.md](oxlintrc.md)。

## 目录结构

```
packages/map-core/
├─ package.json
├─ tsconfig.json          只写 references
├─ tsconfig.lib.json      检查源码（不含测试）：浏览器环境，不加载 vite/client
├─ tsconfig.test.json     检查测试：可以用 Vite 的写法（?raw、?worker&url）
├─ tsconfig.worker.json   有 Worker 入口时才有：webworker 环境，不含 DOM
├─ tsconfig.node.json     检查 vitest.config.ts：Node 环境
├─ vitest.config.ts       包自己的测试配置
└─ src/
   ├─ index.ts            唯一入口
   ├─ _index.scss         要给样式共享 Sass 时才有
   ├─ css-modules.d.ts    有 CSS Modules 时才有（不加载 vite/client）
   ├─ test-setup.ts       测试要自动卸载组件时才有
   └─ test-setup.browser.ts  浏览器测试要 MapLibre 时才有
```

`@mx/theme` 只有 Sass，没有 TS，也就没有 tsconfig、测试配置和 `typecheck`、`test` 脚本；`pnpm -r` 会跳过它。`@mx/icons` 比这些约定早，还有 `tools/` 这个 Node 入口，tsconfig 没有用公共配置，测试写在 `tsconfig.lib.json` 里。

## package.json

```json
{
  "name": "@mx/map-core",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:changed": "vitest run --changed main --passWithNoTests",
    "test:watch": "vitest"
  },
  "dependencies": { "@mx/utils": "workspace:*", "nanoevents": "catalog:" },
  "peerDependencies": { "maplibre-gl": "catalog:" },
  "devDependencies": { "maplibre-gl": "catalog:", "vitest": "catalog:", "...": "catalog:" }
}
```

| 字段 | 说明 |
|---|---|
| `name` | `@mx/<名字>` |
| `exports` | 只暴露入口。深层导入（如 `@mx/map-core/src/xxx`）在解析时就会失败（已验证：TS2307） |
| `exports` 的 `sass` 条件 | 给样式用的入口，见下文"Sass 入口" |
| `exports` 的 `./tools` | 可选的第二个入口，放 Node 端代码（例如 `@mx/icons/tools` 的规范化工具与 Vite 插件），和浏览器入口分开，保证 SVGO 这类依赖不会进入浏览器产物 |
| `bin` | 可选的命令行，指向 `.ts` 文件，由 Node 直接运行（类型剥离）；使用方安装后在 `node_modules/.bin` 中出现，例如 `yzt-icons` |
| `private: true` | 防止被误发布 |
| 没有 `build` 脚本 | 内部包不构建；根目录的 `pnpm -r build` 会跳过它 |
| `typecheck`、`test`、`test:changed` | 被根目录的 `pnpm typecheck`、`pnpm test`、`pnpm test:changed` 覆盖，CI 不用改 |

使用方在自己的 `package.json` 中写 `"@mx/map-core": "workspace:*"`，pnpm 会建立符号链接。

## 依赖怎么声明

| 写法 | 什么时候用 | 例子 |
|---|---|---|
| `peerDependencies` + `devDependencies` | 要和应用共用同一份：有全局状态，或者两份会互不相通 | `vue`、`element-plus`、`maplibre-gl`（`setWorkerUrl`）、`cesium`（`buildModuleUrl.setBaseUrl`） |
| `dependencies` | 其他运行时依赖，包括别的内部包 | `nanoevents`、`@turf/simplify`、`@vueuse/core`、`@mx/utils` |
| `devDependencies` | 只有测试和类型检查用 | `vitest`、`@vue/test-utils`、`@types/geojson` |

两个及以上的包用到的依赖在 `pnpm-workspace.yaml` 的 `catalog` 写版本，这里写 `catalog:`（见 [pnpm-workspace.md](pnpm-workspace.md)）。

**catalog 不是可选的。** 经符号链接解析后，包里的 `import 'cesium'` 从 `packages/map-cesium` 往上找，用的是包自己的 `node_modules`（devDependencies 装的那一份），不是应用的。peer 只是声明"由应用提供"，真正让两边是同一份的，是版本完全相同、pnpm 链接到 `.pnpm` 下的同一个目录。版本不同时不会报错，只会悄悄出现两份：`setWorkerUrl` 设到一份上，地图用的是另一份。

装完依赖后可以这样确认：

```bash
ls node_modules/.pnpm | grep -E '^(vue|maplibre-gl|cesium|element-plus)@'
```

## tsconfig

共用的选项在仓库根目录的 `tsconfig.package.json`（浏览器环境）、`tsconfig.package.node.json`（Node 环境），各份配置只写自己的差异，见 [tsconfig.md](tsconfig.md) 的"包的 tsconfig"。

- `tsconfig.lib.json` 的 `types` 不含 `vite/client`：包里读取 `import.meta.env` 会报错（包不能依赖应用的环境，ADR 0004）。CSS Modules 的类型由 `src/css-modules.d.ts` 声明
- 不配置 `paths`：包内部只用相对路径，别的包经 `node_modules` 按 `exports` 解析；用 `@/` 会报 TS2307
- 用到 GeoJSON 的包在 `types` 里加 `geojson`，并装 `@types/geojson`（见 [tsconfig.md](tsconfig.md) 的"语言与运行环境"）

## 应用侧的解析

`@mx/*` 不在 tsconfig 的 `paths` 里，TS、Vite、lint 都按 `node_modules` 的符号链接和包的 `exports` 解析。解析出的是 `packages/` 下的真实路径，不在 `node_modules` 里，所以：

- Vite 不预构建它，当作自己的源码编译，改了能热更新（已验证：改包里的样式和组件，页面不刷新就生效）
- 应用的 `tsc -b` 把用到的包源码按应用的配置再检查一遍，和原来 libs 的做法相同，多花的时间可以忽略
- `vitest --changed` 能沿着链接找到依赖这个包的测试（已验证，见下文）

## 测试

每个包有自己的 `vitest.config.ts`，有浏览器测试的包分 `unit`、`browser` 两个项目，写法和 `apps/yzt` 相同（ADR 0143）。

- **共用设置：** 浏览器测试的设置（软件渲染、视口、不写失败截图）在根目录的 `vitest.shared.ts`，应用和各个包用同一份
- **不依赖应用：** 包的测试不用应用的 setup。要 MapLibre 的包在 `src/test-setup.browser.ts` 里自己设置 Worker 地址和样式；要 Cesium 的包在配置里用 `viteStaticCopy` 提供 `/cesium/`；要挂载组件的包在 `src/test-setup.ts` 里调用 `enableAutoUnmount`
- **串行：** `pnpm test`、`pnpm test:changed` 用 `--workspace-concurrency=1` 逐个包执行。这些浏览器测试用软件 WebGL，对负载敏感（ADR 0040），不能让两个包同时开浏览器；依赖在前，web 最后
- **选测试：** 改 `packages/map-core` 的 `map-session.ts` 时，`--changed` 在 map-core 选中 3 个文件，map-vue 7 个，map-cesium 3 个，web 90 个，utils 0 个（2026-11-05 实测）
- **浏览器：** 用同一个版本的 Playwright，装一次（`pnpm --filter yzt test:browser:install`）就够

## Sass 入口

包要给样式共享 Sass 时，用 `exports` 的 `sass` 条件：

```json
"exports": {
  ".": { "sass": "./src/_index.scss", "default": "./src/index.ts" }
}
```

样式里写 `@use '@mx/ui'`，命名空间是最后一段（`ui.$compact`）。Vite 解析 Sass 的 `@use` 时带 `sass` 条件，解析 TS 的 `import` 时不带，所以同一个包名在两边各自找到自己的入口；TS 不认识 `sass` 条件，走 `default`。

| 包 | 入口的内容 |
|---|---|
| `@mx/ui` | 只放变量（断点），不输出 CSS，否则每个 `@use` 它的样式文件都会重复输出一份（ADR 0016） |
| `@mx/theme` | 输出令牌、Element 主题和全局基础样式，整个应用只由 `app/styles/index.scss` 引用一次（见 [design/theme.md](../design/theme.md)） |

## lint

- `boundaries/elements` 中有 `package` 元素（`packages/*`，按目录名捕获 `name`）
- 应用只能通过 `@mx/*` 引用包
- 包之间按上面的方向放行，也只能写 `@mx/*`；其余的只能依赖外部模块和包内部的相对路径（`packages` override）

详见 [oxlintrc.md](oxlintrc.md)。

## 分块的名字

包的入口都是 `src/index.ts`，Rolldown 按目录给分块命名，默认都会叫 `src-xxx.js`。`apps/yzt/vite.config.ts` 的 `chunkFileNames` 把它换成包名（`map-cesium-xxx.js`），产物里才认得出。

## 踩过的坑

**给已安装的包新增 `bin` 后，命令不会出现。** lockfile 没有变化时，`pnpm install` 直接跳过链接。处理办法：

- 推荐：在使用方删掉再加回这个依赖，`pnpm --filter yzt remove @mx/icons`，然后 `pnpm --filter yzt add "@mx/icons@workspace:*"`
- 或者 `pnpm install --force`，但**必须先停掉所有开发服务器、测试等正在运行的 Node 进程**。阶段二实测：开发服务器运行时，sass 的 `dart.exe` 占用着文件，强制重装中途失败，把 sass-embedded 平台包里的二进制文件删掉了，之后所有 SCSS 编译都会失败（报 `sass --embedded is unavailable in pure JS mode`）。停掉进程后再执行一次 `pnpm install --force` 可以恢复

全新 clone 后的首次安装会正常链接（已在干净目录中验证）。

**`git mv` 报 Permission denied。** Windows 上 shell 的当前目录在被搬的目录里时，这个目录被锁住，先 `cd` 出来。

**根 `package.json` 要写 `"type": "module"`。** 没有的话，Vite 加载配置时把根目录的 `vitest.shared.ts` 当成 CommonJS，打印一条 `configLoader: 'native'` 的警告。

## 新建一个内部包的检查清单

1. 建目录和 `package.json`（参考上文）；有 Vue 组件时把 `vue` 设为 peer 依赖；两个包以上用到的依赖放进 catalog
2. 复制 `tsconfig.json`、`tsconfig.lib.json`、`tsconfig.test.json`、`tsconfig.node.json`、`vitest.config.ts`，按需调整 `include`、`types`
3. `.oxlintrc.json` 的 `import/resolver` 的 `project` 数组已用 `packages/*/tsconfig.lib.json` 通配，不用改；新包要依赖或被依赖时，在 `packages` override 里补上方向
4. 在使用方添加 `workspace:*` 依赖，运行 `pnpm install`，确认 `.pnpm` 里没有多出 Vue、MapLibre、Cesium 的第二份
5. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm --filter <包名> test`，确认新包被覆盖
6. 构建后比较产物：入口大小不变，入口没有带上地图引擎
7. 在 `docs/modules/` 写模块说明，并在 AGENTS.md 的目录结构中登记
