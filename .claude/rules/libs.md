---
paths:
  - "apps/web/src/libs/**"
  - "packages/**"
---

# libs 与内部包

## 拆包规则（ADR 0004）

- 每个模块只有一个入口 `index.ts`，外部只能从 `@yzt/<name>` 导入，不直接引用模块内部文件
- 例外：需要给样式共享 Sass 变量（如断点）时，模块根目录可以有 Sass 入口 `_index.scss`，只放变量，不输出 CSS；应用用 `@use '<name>'` 引用（`vite.config.ts` 的 `loadPaths`，ADR 0016）
- 模块内部只用相对路径，不使用 `@/`
- 不读取 `import.meta.env`、store、router 或全局单例，需要的依赖通过构造参数或函数参数传入
- 模块之间不能循环依赖
- map-core 放在 libs（ADR 0018）；包不能依赖 libs，所以 `utils ← map-core ← map-cesium` 要拆包时一起拆，引入 map-cesium 时评估
- `apps/web/tsconfig.libs.json` 只检查 libs 的源码（不含测试）：不加载 `vite/client` 类型，不配置 `@/*`，读取 env 和使用 `@/` 在类型检查时报错（ADR 0006）；libs 需要的环境类型（如 CSS Modules）单独声明，不能加回 `vite/client`

## 依赖方向（lint 检查）

- libs 内部：`utils ← ui`，`utils ← map-core ← map-cesium`，`map-vue → map-core`；map-vue 只能用动态 `import()` 引用 map-cesium
- `utils`、`map-core`、`map-cesium` 不依赖 vue、element-plus、pinia；`map-vue` 不依赖 element-plus、pinia、vue-router，项目配置和地图界面放在 `shared/map`（ADR 0027）
- 应用通过 `@yzt/<name>` 使用 `packages/*`，不用相对路径；包只能依赖外部模块和包内部文件，不能导入应用代码；包同样遵守上面的拆包规则
- 以上规则由 lint 强制检查（根目录 `.oxlintrc.json` 的 `boundaries/dependencies`），分层有变化时同步修改（ADR 0006）

## 内部包

- `packages/*`：workspace 内部包，`exports` 直接指向 `src/index.ts`，不单独构建（ADR 0014）；目前有 `@yzt/icons`（图标组件与 SVG 规范化工具）。新建包按 `docs/config/internal-packages.md`
