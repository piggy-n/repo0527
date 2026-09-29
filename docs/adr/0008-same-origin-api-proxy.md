# 0008. 接口走同源的 /backend 代理

- 状态：已接受
- 日期：2026-09-29

## 背景

旧项目让浏览器跨域直连后端（`http://192.168.1.180:18010`），后端地址写死在 `api-config.js` 里，开发时靠 backend-switcher 在 localStorage 中切换。跨域请求依赖后端的 CORS 配置，并且会触发预检请求；旧项目 README 记录过矢量瓦片因此每片都多一次预检，建议用 nginx 同源转发 `/api/tiles`。

后端接口路径没有统一前缀（`/api`、`/system`、`/resource-management`、`/file` 等），其中 `/resource-management` 与页面路由同名。新项目使用 history 模式（ADR 0007），同源请求时无法仅凭路径区分页面和接口。

## 候选方案

1. 跨域直连：`VITE_API_BASE_URL` 设为后端完整地址，和旧项目一致
2. 同源代理，加统一前缀：前端请求 `/backend/...`，开发时由 Vite、生产时由 nginx 转发到后端并去掉前缀
3. 同源代理，不加前缀：按后端路径逐个配置代理规则。路径分散且与页面路由冲突，不可行

前缀不用 `/api`：后端本身有 `/api/...` 路径，会出现 `/api/api/tiles` 这样难以分辨的地址。

## 决定

- 选方案 2，前缀为 `/backend`，写在 `apps/web/.env` 的 `VITE_API_BASE_URL` 中
- 代理目标写在 `.env` 的 `PROXY_TARGET` 中（不带 `VITE_` 前缀，不进入前端代码），开发服务器与 `vite preview` 共用；个人临时连接其他后端时，用不提交的 `.env.local` 覆盖
- 后端内网地址属于私有网段、不含凭据，提交进仓库，新 clone 可以直接运行
- 生产环境由 nginx 做同样的转发，配置示例见 `docs/deployment.md`

## 后果

- 好处：浏览器只看到同源请求，没有 CORS 和预检；开发与生产的请求路径一致
- 好处：代码只认 `appConfig.apiBaseUrl`，以后改成跨域直连只需要改这一个变量
- 好处：替代旧项目的 backend-switcher，切换后端不再依赖浏览器 localStorage
- 代价：部署时 nginx 需要增加一个 `location`
- 代价：`VITE_API_BASE_URL` 在构建时写入产物，改地址要重新构建；需要"一次构建、多处部署"时，再改为启动时读取运行时配置
- 旧项目中 AI 对话、文件管理使用其他后端地址，迁移到对应模块时按同样方式增加前缀和代理
