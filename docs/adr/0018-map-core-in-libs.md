# 0018. map-core 放在 libs/map-core

- 状态：已接受
- 日期：2026-10-09

## 背景

阶段四开始写地图内核 `map-core`。按 ADR 0004，可拆分的模块先放在 `apps/web/src/libs/`，满足任一条件再拆成 `packages/*`：有独立的依赖集合（例如 Cesium）、需要物理隔离、被多个应用复用。ADR 0014 让图标直接做成内部包，是一个例外；ADR 0016 把通用 UI 组件放在 `libs/ui`。

map-core 和其他 libs 模块有两点不同，需要单独决定：

1. 它是整个项目里最像独立库的代码：纯 TS，不依赖 Vue；依赖（maplibre-gl、turf 等）和应用的其他部分没有交集
2. 它处在一条依赖链的中间：`utils ← map-core ← map-cesium`。AGENTS.md 规定包只能依赖外部模块和包内部文件，所以**下游一旦拆成包，上游必须一起拆**。map-cesium 带着 Cesium，正是 ADR 0004 举的拆包例子

## 候选方案

| | A. `libs/map-core` | B. `packages/map-core` | C. 整条地图链现在都拆成包 |
|---|---|---|---|
| 边界检查 | lint（禁止依赖 Vue 生态、只能从入口导入）+ `tsconfig.libs.json`（不能读 env、不能用 `@/`、没有 Vite 类型），阶段三已配好 | 再加一层：没声明的依赖在解析时就找不到 | 同 B |
| 依赖声明 | 写在 `apps/web` | 写在包里，maplibre-gl 作为 peer 依赖（与 icons 对 vue 的做法相同） | 同 B，utils 也要先做成包 |
| 测试 | 跟 `apps/web` 一起跑 | 包自己的 Vitest 配置 | 同 B |
| 额外成本 | 无 | `package.json`、2～3 份 tsconfig、测试配置 | B 的成本乘以模块数 |

## 决定

选 A：map-core 放在 `apps/web/src/libs/map-core`，统一用 `@yzt/map-core` 导入。

- map-core 自身不满足拆包条件：maplibre-gl 是普通的 npm 依赖，不需要 Cesium 那样拷贝静态资源、设置 `CESIUM_BASE_URL`；只有一个应用使用
- "不依赖 Vue"已经由 lint 和 `tsconfig.libs.json` 强制，拆成包在这一点上不会更严格
- ADR 0004 的设计目的就是让以后拆包变成机械操作（移动目录、补 `package.json`、删 `paths` 映射）；内部包的配置已经在 icons 上练过，阶段四的学习重点放在接口、外观、工厂、观察者和资源释放上
- **引入 map-cesium 时，评估把 utils、map-core、map-cesium 一起拆到 `packages/`**；不单独拆其中一个

MapLibre 的装配留在 app：Vite 加载 Worker 要写 `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'`（ADR 0019），这是 Vite 特有的导入写法。`tsconfig.libs.json` 不加载 `vite/client` 类型，libs 里这样写会报 TS2307（已实测），所以 `setWorkerUrl` 和 maplibre-gl 的 CSS 都由 app 导入，map-core 不关心 Worker 从哪里加载。

## 后果

- 好处：不增加包的配置；边界规则沿用阶段三的 lint 和 `tsconfig.libs.json`
- 代价：maplibre-gl 等依赖声明在 `apps/web`，features 也能直接导入 maplibre-gl。设计上 SDK 只应出现在 map-core 的适配器和 app 的装配中，写第一个适配器时评估用 lint 限制导入位置
- 代价：map-core 的测试跑在 `apps/web` 的 jsdom 环境里。jsdom 能导入 maplibre-gl，但没有 WebGL，构造 `Map` 会抛出 `GPUInitializationError`（已实测），所以 Manager 的测试要靠接口和测试替身，不依赖真实地图
- 待定：自己写的 Worker 要按 `WebWorker` 环境做类型检查，不能和 DOM 环境放在同一份 tsconfig 里。旧项目的 Worker 都属于三维（MVT 栅格化、漫游寻路），出现第一个 Worker 时再决定配置，可能和 map-cesium 拆包一起考虑
