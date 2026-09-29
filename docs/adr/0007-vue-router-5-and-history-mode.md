# 0007. 路由使用 Vue Router 5 与 history 模式

- 状态：已接受
- 日期：2026-09-29

## 背景

阶段二接入路由。需要决定两件事：

1. 大版本。Vue Router 的最新版本线是 5.x（当前 5.3.1），4.x 最后一次发布是 2025 年 10 月的 4.6.3。按官方迁移指南，5 是过渡版本：把原来独立的 unplugin-vue-router（文件路由）并入核心包；手写路由的项目从 4 升到 5 没有破坏性变化；v6 将只提供 ESM，并删除已弃用的 API
2. 路由模式。旧项目使用 hash 模式（`/#/current-map`），部署在 nginx 后面，没有子路径，也没有定义 SSO 回调之类需要外部系统登记地址的路由

项目今后要用 MapLibre。它的 `hash` 选项可以把地图中心、缩放级别写进 URL 的 hash，便于分享当前视野，而 hash 路由会占用 URL 的 hash。

## 候选方案

大版本：

1. Vue Router 5：当前维护的版本线，将来升级 v6 也要经过它。代价是文件路由用到的 unplugin、chokidar 等构建期依赖会装进 `node_modules`（不打进产物）
2. Vue Router 4.6：依赖更少，但已是旧版本线

文件路由（5 内置）：

1. 手写路由表：路由记录、`meta`、懒加载都显式写在 `app/router/routes.ts`
2. 文件路由：按 `pages/` 的文件结构自动生成路由，并能生成带类型的路由名。但它的 `definePage()` 只能用在 SFC 中，本项目用 TSX（ADR 0001），而且它依赖编译期插件自动生成代码，和"依赖一律显式"的约定相反

路由模式：

1. history：地址是 `/current-map`，hash 留给页面自己使用；部署时服务端要把未知路径回退到 `index.html`
2. hash：和旧项目一致，部署不需要服务端配合；hash 被路由占用

## 决定

- 使用 Vue Router 5，手写路由表，不启用文件路由
- 使用 history 模式：`createWebHistory(import.meta.env.BASE_URL)`
- 路由地址沿用旧项目，方便用户对照

## 后果

- 好处：跟随当前维护的版本线；项目已开启 `typescript/no-deprecated`，v6 要删除的 API 一旦用到就会报错，提前为升级做准备
- 好处：地址更干净；地图状态以后可以写进 hash
- 代价：部署时 nginx 需要配置回退，例如 `try_files $uri $uri/ /index.html;`。开发服务器和 `vite preview` 默认已经这样处理
- 代价：旧系统书签里的 `/#/xxx` 地址不能直接打开。如果新系统部署在旧系统的地址上，需要在启动时把 `#/xxx` 转成 `/xxx`，届时再实现
- 代价：路由名不能像文件路由那样自动生成类型，改用 `shared/router/route-names.ts` 中的常量，写错名字时由类型检查报错
