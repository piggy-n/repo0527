---
paths:
  - "packages/**"
  - "tsconfig.package*.json"
  - "vitest.shared.ts"
---

# 内部包

## 拆包规则（ADR 0004、0143）

- `packages/*` 是 workspace 内部包：`exports` 直接指向源码，不单独构建、不发布（ADR 0014）；新建包按 `docs/config/internal-packages.md`
- 每个包只有一个入口 `src/index.ts`，外部只能从 `@mx/<name>` 导入，不直接引用包内部文件（`exports` 拦截）
- 例外：需要给样式共享 Sass 时，包有 Sass 入口 `src/_index.scss`，用 `exports` 的 `sass` 条件提供，样式写 `@use '@mx/<name>'`；`@mx/ui` 的只放变量、不输出 CSS（ADR 0016）；`@mx/theme` 只有 Sass 入口，输出令牌和 Element 主题，整个应用只由 `app/styles/index.scss` 引用一次
- 包内部只用相对路径，不使用 `@/`；不读取 `import.meta.env`、store、router 或全局单例，需要的依赖通过构造参数或函数参数传入
- 包之间不能循环依赖
- 每个包的 `tsconfig.lib.json` 只检查源码（不含测试）：不加载 `vite/client` 类型，没有 `paths`，读取 env 和使用 `@/` 在类型检查时报错；需要的环境类型（如 CSS Modules）单独声明，不能加回 `vite/client`。测试由 `tsconfig.test.json` 检查，可以用 Vite 的写法

## 依赖方向（lint 检查）

- `utils ← ui`，`utils ← map-core ← map-cesium`，`map-vue → map-core`；map-vue 只能用动态 `import()` 引用 map-cesium；`icons`、`theme` 不依赖其他包
- `utils`、`map-core`、`map-cesium` 不依赖 vue、element-plus、pinia；`map-vue` 不依赖 element-plus、pinia、vue-router，项目配置和地图界面放在 `shared/map`（ADR 0027）
- 应用通过 `@mx/<name>` 使用包，不用相对路径；包只能依赖外部模块、声明过的包和包内部文件，不能导入应用代码
- 以上规则由 lint 强制检查（根目录 `.oxlintrc.json` 的 `boundaries/dependencies`），分层有变化时同步修改（ADR 0006）

## 依赖声明（ADR 0143）

- 要和应用共用一份的写 `peerDependencies` + `devDependencies`：vue、element-plus、maplibre-gl（`setWorkerUrl` 是全局状态）、cesium（`setBaseUrl` 也是）；其他写普通 `dependencies`
- 两个及以上的包用到的依赖在 `pnpm-workspace.yaml` 的 `catalog` 写版本，包里写 `catalog:`。包经符号链接解析时找的是自己的 `node_modules`，版本一致才能和应用共用一份，所以这不是可选的

## 测试

- 每个包有自己的 `vitest.config.ts`，包的测试不依赖应用的 setup；浏览器测试的设置来自根目录的 `vitest.shared.ts`，要 MapLibre 的包自己设置 Worker 地址（`src/test-setup.browser.ts`），要 Cesium 的包自己提供 `/cesium/`
- `pnpm test`、`pnpm test:changed` 逐个包串行执行，不同包的浏览器测试不会同时运行；单独跑一个包用 `pnpm --filter @mx/<name> test`
