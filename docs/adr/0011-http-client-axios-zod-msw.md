# 0011. HTTP 客户端：axios + zod，测试用 MSW 模拟接口

- 状态：已接受
- 日期：2026-09-29

## 背景

旧项目的 `libs/http-service.js` 用 axios 加一个配置数组生成 `API.xxx` 方法：

- 没有类型：调用方拿到整个 `{ code, msg, data }`，自己再判断 `code`
- 失败时 `reject` 一个字符串
- 直接 import 了 router 和 `ElMessage`，处理 401 跳转和错误提示，使 HTTP 层依赖了路由和 UI
- 文件管理需要上传、下载进度

阶段二原计划在 2.7 单独决定 Mock 方案。但 HTTP 客户端的测试现在就要模拟接口，所以在这里一并决定。开发时可以稳定访问后端，走同源代理直连（ADR 0008），Mock 主要用于测试。

## 候选方案

请求库：

1. axios：成熟；在浏览器中基于 XHR，HTTP/1.1 下上传、下载进度都可靠。类型默认返回 `any`
2. ky：基于 fetch，体积小，`.json()` 默认返回 `unknown`。但上传进度依赖请求流，在 Chromium 中 HTTPS 还要求 HTTP/2，不满足时静默忽略
3. 原生 fetch 自己封装：零依赖，但超时、查询参数、错误转换都要自己写，上传进度还要另写一套 XHR

返回值校验：

1. zod 4：生态最大、资料最多，零依赖，有中文错误信息
2. valibot：体积最小，函数组合写法，资料较少
3. 手写类型守卫：不引入依赖，但嵌套结构很啰嗦，类型和判断逻辑要分别维护

测试中模拟接口：

1. MSW：在网络层拦截，测试不关心底层是 axios 还是 fetch，组件测试、开发期模拟数据也能复用
2. axios-mock-adapter 或 `vi.mock('axios')`：和请求库的实现细节绑定，换库就要重写测试

## 决定

- 请求库用 axios，只在 `shared/http/client.ts` 中使用；对外提供 `http.get / post / put / delete`
- 返回值校验用 zod 4：每个请求必须传 `schema`，客户端先校验外层 `{ code, msg, data }`，`code` 为 200 时再按 `schema` 校验 `data` 并返回，返回值类型由 `schema` 推断
- 失败时抛出 `ApiError`，`kind` 取值：`business`、`http`、`unauthorized`、`network`、`timeout`、`canceled`、`invalid-response`
- 401 跳转、错误提示、登录 token 由 app 通过 `configureHttp` 注入，shared/http 不依赖路由、UI 和鉴权
- 超时用 `AbortController` + `setTimeout` 实现，与调用方的取消共用一套中止机制；不用 axios 的 `timeout` 选项
- 测试用 MSW 2.x 的 `msw/node`；3.0.0 在决定时刚发布一天，处于冷却期内，也是新的大版本
- 上传、下载在迁移文件管理时再加

## 实测结果

- 16 个用例覆盖成功、查询参数与请求头、各类失败、`silent`、回调触发规则；又逐个改坏源码，确认每处都能被测试发现。其间发现一个测试漏洞（401 用例带了 `silent`，掩盖了"401 不触发 onError"这条检查），已拆开修正
- 测试发现 zod 4 中对象的 `z.unknown()` 字段默认必填：后端的错误响应没有 `data` 字段，照原写法会被误判为格式错误，也就不会触发跳转登录。已改为 `z.unknown().optional()`
- MSW 的 XHR 拦截器在模拟响应时不处理 `xhr.timeout`，axios 基于 XHR 的超时在测试中永远不会触发，这是改用 `AbortController` 实现超时的原因
- 在浏览器中通过代理调用真实后端 `/system/upms/user/detail`：后端返回 HTTP 401，得到 `unauthorized`，页面提示"登录状态已过期，请重新登录"并跳到登录页；超时设为 1 毫秒时得到 `timeout` 并弹出错误提示

## 后果

- 好处：接口函数有准确的类型；后端字段变化时，在响应返回的那一刻就报"格式不正确"，而不是在后面的代码里读到 `undefined`
- 好处：HTTP 层可以脱离路由和 UI 单独测试；token 通过回调获取，将来鉴权 store 依赖 http 时不会形成循环依赖
- 代价：每个接口都要写 zod schema；返回大量数据的接口，校验有运行时开销，届时评估是否只校验关键字段
- 代价：客户端要求后端统一返回 `{ code, msg, data }`；遇到不遵守这个结构的接口（例如 AI 后端、文件流），再增加对应的选项
- 代价：超时是自己实现的，替代了 axios 的一个内置功能
