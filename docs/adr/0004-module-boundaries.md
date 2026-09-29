# 0004. 模块边界与拆包预留

- 状态：已接受
- 日期：2026-09-29

## 背景

旧项目按技术类型分目录（api、components、views、stores），出现了 8 处 components 反向依赖 views 的情况，还有多套新旧版本并存。
地图内核 `MapService` 直接 import 了 `API`、`ElMessage` 和图层树快照，和应用环境绑死，无法独立测试，也无法抽成单独的包。
仓库已经是 pnpm workspace（`apps/*`、`packages/*`）。希望先在单个应用内实现，同时为以后拆出地图、Cesium、通用组件和工具库做好准备。

## 候选方案

1. 一开始就把可复用模块建成 `packages/*`：边界靠 pnpm 物理隔离，但前期要多维护包配置
2. 全部放在应用内，只靠目录约定：成本最低，但边界容易被慢慢破坏，以后拆包要大量改代码
3. 放在应用内的 `src/libs/`，并按"已经是一个包"的规则来写：前期成本低，以后拆包是机械操作

## 决定

选方案 3，具体规则：

- 目录分为 `app/`、`pages/`、`features/`、`shared/`、`libs/`，依赖方向为 `pages → features → shared → libs`
- `libs/` 下每个模块只有一个 `index.ts` 入口，通过 tsconfig `paths` 映射成未来的包名 `@yzt/<name>`，外部只从这个包名导入
- libs 内部只用相对路径，不读取 `import.meta.env`、store、router 或全局单例，需要的依赖通过参数注入
- 依赖方向靠 lint 规则强制检查，模块之间不能循环依赖

真正拆包的条件（满足任一条）：有独立的依赖集合（例如 Cesium）、需要物理隔离、被多个应用复用。
拆包时采用"源码直出"：包的 `exports` 直接指向 `src/index.ts`，由使用方的 Vite 编译，不单独构建。

## 后果

- 好处：拆包时只需移动目录、补上 `package.json`、删掉 `paths` 映射，业务代码里的 import 不用改
- 好处：依赖注入让核心模块可以脱离应用单独测试
- 代价：在拆包之前，第三方依赖都声明在 `apps/web`，隔离只能靠 lint 保证
- 代价：tsconfig `paths` 和 Vite 别名要保持同步
