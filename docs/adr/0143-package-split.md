# 0143. libs 搬到 packages，抽出 @yzt/theme

- 状态：已接受
- 日期：2026-11-05
- 落地：ADR 0004 的拆包预留；修改 ADR 0016、0018 的位置（`libs/ui`、`libs/map-core`）和 ADR 0139 的 `test:changed`；ADR 0014 的内部包形式不变

## 背景

可复用的模块放在 `apps/web/src/libs/`（utils、ui、map-core、map-cesium、map-vue，约 1.4 万行，占 src 的 14%），按"已经是一个包"的规则写（ADR 0004）。用户 2026-11-05 确认现在没有业务在改，可以开始拆。

目的是让以后的地图项目复用，边界更实在；不是为了给 web 瘦身（features 占 60%，不动）。已定的前提：未来的地图项目放在这个仓库的 `apps/xxx`，所以内部包继续直接导出 TS 源码，不构建、不发布；先搬 libs、再抽样式；`shared/map` 这次不拆，等第二个地图项目的需求明确后再说。

## 候选方案

### 测试放哪里

| 方案 | 好处 | 没选的原因 |
|---|---|---|
| **每个包一份 Vitest 配置，根目录串行跑**（选中） | 包能单独测，测试只靠声明过的依赖；和 ADR 0014 一致 | 多 5 次 Vitest 启动 |
| web 的配置统一跑 `../../packages/*` | 配置最少，没有并发问题 | 包的测试要靠应用的 `setupMapRuntime`，边界不实在；pnpm 严格模式下，`@vue/test-utils` 这些仍要声明在包里，省不了多少 |
| 根目录用 Vitest `projects` | 一个进程，worker 额度共用 | 每个项目一个 Vite 服务，约 12 个，8 GB 的开发机吃紧（按机制估算，没有实测）；要改 `pnpm -r` 的约定 |

`pnpm -r` 默认并行，软件 WebGL 的浏览器测试对负载敏感（ADR 0040，`fileParallelism: false` 也是因此加的），所以根目录的 `test` 写 `--workspace-concurrency=1`。这样不同包的浏览器测试不会同时运行，按拓扑顺序依赖在前、web 最后。

`test:changed` 的问题比 ADR 0139 记的小。实测：改 `packages/icons` 的文件，web 的 `--changed main` 能沿 workspace 链接选中 367 个单元测试文件中依赖它的 36 个。缺的只是包自己的测试，所以每个包都加 `test:changed`，根目录的 `pnpm test:changed` 串行执行。

浏览器测试的设置（软件渲染、视口、不写失败截图）放进根目录的 `vitest.shared.ts`，应用和 4 个包共用，不各写一份。

### 依赖怎么声明

| 方案 | 没选的原因 |
|---|---|
| **要和应用共用一份的写 peer + dev，版本放 catalog**（选中） | |
| 不用 catalog，peer 写宽范围（`^6`），dev 各写各的 | 版本漂移后会悄悄出现两份 MapLibre |
| 引擎写成普通 dependencies | 有 catalog 时运行结果相同，但看不出"由应用提供并装配"，也和 ADR 0014 对 vue 的做法不一致 |

catalog 不是可选的：经符号链接解析后，包里的 `import 'cesium'` 找的是包自己的 `node_modules`，不是应用的。peer 只是声明，真正让两边是同一份的，是版本完全相同、pnpm 链接到 `.pnpm` 下的同一个目录。

catalog 只放两个及以上的包用到的依赖。pnpm 12.14 实测：lockfile 只有 `specifier` 变化；`pnpm outdated -r` 能列出 catalog 里的依赖；`pnpm update -r --latest` 只改 catalog，`package.json` 保持 `catalog:`。

### lint 和类型检查

元素 `lib` 去掉，原来 libs 的策略换成 `package` 元素写进 `packages` override，方向不变。只靠 pnpm 严格模式不够：它拦不住 map-vue 静态导入 map-cesium，也拦不住有人把 vue 声明进 map-core。

`tsconfig.libs.json` 的检查换成每个包的 `tsconfig.lib.json`（不加载 `vite/client`，没有 `paths`），测试单独一份 `tsconfig.test.json`。共用选项放根目录的 `tsconfig.package*.json`，否则十几份配置要各写约 20 行。

### 主题怎么提供

| 方案 | 没选的原因 |
|---|---|
| **只导出 Sass 入口，`app/styles/index.scss` 里 `@use '@yzt/theme'`**（选中） | |
| `main.ts` 里 `import '@yzt/theme/index.scss'` | 加载顺序分散在两处，`@yzt/*` 的 lint 规则也要放宽 |
| 包先编译出 CSS | 已经定了内部包不构建 |

`tokens.scss`、`element-theme.scss`、`base.scss` 进包：`base.scss` 只读令牌，没有应用特有的内容，第二个应用否则要复制。`fonts.scss` 留在应用：字体不入库，地址依赖应用的 `public`。

### Sass 入口

`@use 'ui'` 改成 `@use '@yzt/ui'`（3 个业务样式文件各改一行，命名空间还是 `ui`），由 `exports` 的 `sass` 条件提供，去掉 `loadPaths`。没选保留 `@use 'ui'`：每个应用的 Vite 配置都要绑定 `packages/` 的目录结构，`_index.scss` 还要放到包的根目录。

## 决定

1. `apps/web/src/libs/*` 搬到 `packages/*`，入口是 `src/index.ts`；业务代码的 `@yzt/<name>` 导入不变；`apps/web/tsconfig.app.json` 去掉 `@yzt/*` 的 `paths`，删掉 `tsconfig.libs.json`
2. 令牌、Element 主题和全局基础样式抽成 `@yzt/theme`，只有 Sass 入口；它的入口输出 CSS，只由 `app/styles/index.scss` 引用一次
3. 依赖方向不变：`utils ← ui`，`utils ← map-core ← map-cesium`，`map-vue → map-core`，map-vue 只能动态导入 map-cesium；`icons`、`theme` 不依赖其他包
4. 每个包有自己的 Vitest 配置；`pnpm test`、`pnpm test:changed` 逐个包串行
5. 分块按包名命名：包的入口都是 `src/index.ts`，Rolldown 默认把分块叫 `src-xxx.js`，`vite.config.ts` 的 `chunkFileNames` 换成包名
6. 根目录的 `package.json` 写 `"type": "module"`，`vitest.shared.ts` 才不会被当成 CommonJS
7. `shared/map` 不拆，记进 `docs/backlog.md`

细节和用法见 [internal-packages.md](../config/internal-packages.md)。

## 实测结果

产物（内网构建，2026-11-05，搬之前和搬之后）：

| 项目 | 搬之前 | 搬之后 |
|---|---|---|
| 入口 JS | 212,779 B（gzip 71,344） | 相同 |
| 入口 CSS | 379,683 B | 逐字节相同 |
| JS 分块 | 95 个，共 9,818,243 B | 相同，每个分块的名字和大小都相同 |
| CSS 文件 | 24 个，共 676,360 B | 相同 |
| Cesium 运行时 | 275 个文件，6,529,567 B | 相同 |

边界（放入违规，确认报出后删除）：

- lint 报出 18 类：包之间反方向依赖、静态导入 map-cesium、依赖 Vue 生态、适配器之外导入引擎、用相对路径跨包或绕过入口、`mapbox-gl`、测试文件违反方向、测试文件的类型感知规则
- 类型检查报出 5 类：包读 `import.meta.env`（TS2339）、包用 `@/`（TS2307）、深层导入（TS2307）、两份 Worker 配置里用 DOM（TS2584）
- 包用 `@/` 时 lint 不报：解析不出来，boundaries 当成外部模块放行。这条靠类型检查，和原来 `tsconfig.libs.json` 的分工相同
- 入口经由包静态引入引擎（`main.ts` 导入 `@yzt/map-core`、`@yzt/map-cesium`），`buildOutputPlugin` 分别报 MapLibre、Cesium

开发模式（`pnpm dev`）：

- Sass 入口能解析，`(width < 1200px)` 编译正确
- `nav-grid.worker.ts` 的地址改写成 `/@fs/.../packages/map-core/src/scene/nav/nav-grid.worker.ts?worker_file&type=module`，脚本能加载，构建产物里是 `nav-grid.worker-xxx.js`
- `/dev/map` 二维就绪、能缩放和拖动，切到三维后 39 个 `/cesium/` 请求全部成功
- 改包里的样式和组件，页面不刷新就生效

`--changed` 跨包选择：改 `packages/map-core/src/session/map-session.ts`，map-core 选中 3 个文件，map-vue 7 个，map-cesium 3 个，web 90 个，utils 0 个。

全量（本机，`pnpm -r --workspace-concurrency=1 test --maxWorkers=2`）：测试文件搬前搬后都是 397 个，没有漏掉；共 535 秒。

| 包 | 文件 | 用例 | 耗时 |
|---|---|---|---|
| icons | 5 | 35 | 6 秒 |
| utils | 8 | 69 | 1 秒 |
| ui | 7 | 35 | 16 秒 |
| map-core | 26 | 332 | 11 秒 |
| map-cesium | 8 | 128 | 100 秒 |
| map-vue | 8 | 127 | 7 秒 |
| web | 335 | 2885 | 382 秒 |

各包的浏览器项目在干净的 Vite 缓存下第一次运行，都没有出现运行中重载页面；web 的浏览器项目清掉 `.vite` 和 `.vitest-cache` 后重跑，20 个文件也没有出现（`optimizeDeps.include` 不用改）。生产冒烟 43 项通过，6 项按构建开关跳过（和搬动无关）。

## 后果

- 好处：依赖声明是真实的，包里用了没声明的依赖会解析失败；地图项目放进 `apps/xxx` 时直接用这些包
- 好处：改一个包时可以只跑这个包（`pnpm --filter @yzt/map-core test`），不用加载 web 的配置
- 代价：每个包多 4～5 份配置（`package.json`、3～4 份 tsconfig、`vitest.config.ts`）
- 代价：`pnpm test` 串行，一个包失败就停，看不到后面包的结果；CI 多 5 次 Vitest 启动
- 代价：`pnpm test:changed` 每个包都启动一次 Vitest，没有相关测试时也多花 1～3 秒
- 代价：包的浏览器测试不走 app 的 `setupMapRuntime`，MapLibre 的 Worker 地址在 map-core、map-vue 各设置一次，Worker 数量用默认值；app 的装配由 web 自己的浏览器测试和冒烟覆盖
- 主题改动仍然选不到测试（`packages/theme` 和原来的 `app/styles` 一样），按验证分级在 `/dev/theme` 确认
