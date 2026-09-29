# yzt 重构（repo0527）

用 Vue 3 + TSX + TypeScript 重写 `C:\WebProject\yzt`（江苏省统一调查监测现状图，master-demo 分支）。
这是学习型重构：迁移的同时学习 Vue 3、TS、架构设计、面向对象与设计模式、monorepo 和前端工程化。

## 协作方式

- 每一步先说明设计理由、替代方案和涉及的知识点，再动手
- 一次推进一个小步骤，不擅自扩大范围；涉及选型的问题先讨论再决定
- 重要决策写成 ADR（`docs/adr/`）；阶段结束时把新结论同步到本文件
- 提交信息使用 Conventional Commits 格式（`feat` / `fix` / `refactor` / `docs` / `chore` 等）

## 技术栈

已确定：

- Vue 3 + TSX（`defineComponent`），不使用 `.vue` 单文件组件（ADR 0001）
- TypeScript strict，Vite，Pinia，Vue Router，Element Plus，pnpm workspace
- 二维地图用 MapLibre GL JS，大版本在地图阶段确定；禁止引入 `mapbox-gl`（2.0 起为专有许可）（ADR 0002）
- 三维地图用 Cesium，精确锁定版本（ADR 0002）
- 浏览器目标用 Vite 默认值，不兼容旧浏览器，不引入 `@vitejs/plugin-legacy`
- CI 用 GitHub Actions，阶段 1 接入（ADR 0005）

待定：TS 7 工具链（ADR 0003）、lint、测试、服务端状态、Mock、持久化（计划用 IndexedDB + idb-keyval）

## 目录结构

```
apps/web/src/
├─ app/        应用装配：入口、路由、Pinia、全局插件、布局
├─ pages/      路由页面，只负责组合 features
├─ features/   按业务域划分：api.ts、queries.ts、store.ts、components/、composables/
├─ shared/     应用内通用：HTTP 客户端、鉴权、存储、通用 composables 与类型
└─ libs/       将来可拆到 packages/* 的模块，统一用 @yzt/<name> 导入
   ├─ utils/       @yzt/utils       纯 TS 工具，不依赖框架
   ├─ ui/          @yzt/ui          Mx* 通用组件
   ├─ map-core/    @yzt/map-core    地图内核，不依赖 Vue
   ├─ map-cesium/  @yzt/map-cesium  Cesium 三维
   └─ map-vue/     @yzt/map-vue     地图与 Vue 的衔接
```

## 依赖方向

- `pages → features → shared → libs`，`app` 可以依赖所有目录
- features 之间不互相导入，需要复用的内容上移到 shared 或 libs
- libs 内部：`utils ← ui`，`utils ← map-core ← map-cesium`，`map-vue → map-core`（map-cesium 懒加载）
- `utils`、`map-core`、`map-cesium` 不依赖 vue、element-plus、pinia

## libs 的拆包规则（ADR 0004）

- 每个模块只有一个入口 `index.ts`，外部只能从 `@yzt/<name>` 导入，不直接引用模块内部文件
- 模块内部只用相对路径，不使用 `@/`
- 不读取 `import.meta.env`、store、router 或全局单例，需要的依赖通过构造参数或函数参数传入
- 模块之间不能循环依赖

## 编码约定

### 格式

以根目录 `.editorconfig` + WebStorm 格式化为准：UTF-8、2 空格缩进、120 列、单引号、语句末尾加分号、不加尾随逗号、`if` / `else` 必须带大括号。
完整说明见 `docs/CODE_STYLE.md`。格式规则只交给一个工具负责，ESLint 不管格式。

### 注释

- 只说明变量、方法和关键步骤的用途或原因，一行为主，最多两句；不复述代码本身
- 复杂逻辑写成 `docs/` 下的独立文档或 Skill，代码里只留一行注释指向它
- 中文注释结尾不加句号
- 导出的函数和类可以写单行 `/** */` 注释，方便 IDE 悬停提示；类型信息交给 TS，不在注释里重复
- 不写文件头的作者、日期注释，不保留注释掉的旧代码，这些由 git 记录

### 依赖

- 通用问题优先用成熟稳定的库，不重复造轮子：比如 `lodash-es`（判断、防抖节流、深拷贝）、`tippy.js`（提示交互）
- `lodash-es` 按需具名导入，例如 `import { debounce } from 'lodash-es'`，保证未用到的函数能被 tree-shaking 掉
- 原生语法已经足够清晰时直接用原生，例如 `?.`、`??`、`Array.isArray`、`Object.entries`
- 引入新依赖前先确认现有依赖里没有同类库，同一类问题只保留一个库

### 语法

- 优先用现代 ES 语法：解构、展开、箭头函数、模板字符串、可选链、空值合并、`async` / `await`
- 可读性优先：解构用于给值起有意义的名字，不为了缩短代码写多层嵌套解构或长串三元表达式
- 只用 `const` / `let` 和 `===`

### TypeScript 与 Vue

- 避免 `any`；外部数据先用 `unknown` 接收，再收窄类型；只用于类型的导入写 `import type`
- 组件用 `defineComponent` + TSX，样式用 `*.module.scss`
- 不挂 `globalProperties`，不用 `getCurrentInstance().proxy`，不往 `window` 上挂对象，不使用 API 自动导入；依赖一律显式 `import` 或通过 provide / inject 获取
- 跨组件通信按 props / emit → provide / inject → Pinia 的顺序选择，不使用无类型的字符串事件总线

## 迁移规则

- 只迁移旧项目中实际在用的模块。不迁移：资源中心（含知识图谱）、资源共享、统计分析、旧版 resource-management、`views/sys` 与动态菜单路由、`/home` 测试页、mockjs、backend-switcher
- 先读懂旧模块的行为，再按新架构重写，不逐行照搬；类结构和算法有价值的，保留设计并补上类型
- 开始迁移一个模块时，在 `docs/migration.md` 记下 yzt 的基线 commit，之后用 `git diff <基线>..HEAD -- <路径>` 同步旧仓库的新改动

## 依赖维护（ADR 0005）

- 一般依赖用 `^`；不遵守语义化版本的包精确锁定：Cesium、TypeScript
- 0.x 版本的包，小版本升级按大版本对待
- 新版本要发布满 `minimumReleaseAge` 设定的时长才能安装（防止装到刚发布的恶意版本）
- 小版本和补丁：CI 通过后合并
- 大版本：先读 Breaking Changes 和迁移指南再决定；等出过几个补丁版本再升；一次只升一个包，单独提交，并在提交说明里写明迁移内容
- 每月手动检查一次（`pnpm deps:check`），接入 Renovate 后改为每周自动处理；安全告警随时处理
- `pnpm-lock.yaml` 必须提交

## 文档

- `docs/` 有意不纳入 git，新 clone 或 worktree 里可能没有；必须遵守的规则都写在本文件里
- `docs/CODE_STYLE.md`：完整代码风格
- `docs/adr/`：架构决策记录，编号递增，接受后不再修改；决策有变化时新写一份，并注明取代了哪一份
- `docs/migration.md`：各模块的迁移基线与进度

## 常用命令

- `pnpm deps:check`：检查所有包的过期依赖
- `pnpm deps:update:within-range`：在版本范围内更新依赖
- 应用的开发、构建、测试命令在阶段 1 搭建后补充
