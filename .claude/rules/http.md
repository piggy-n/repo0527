---
paths:
  - "apps/yzt/src/features/**/api.ts"
  - "apps/yzt/src/features/**/queries.ts"
  - "apps/yzt/src/features/ai-chat/ai-client.ts"
  - "apps/yzt/src/shared/http/**"
  - "apps/yzt/src/shared/auth/session-guard*"
  - "apps/yzt/src/app/http.ts"
---

# 接口请求（ADR 0011，用法见 `docs/modules/http.md`）

- HTTP 用 axios + zod 4，测试中用 MSW 2.x 模拟接口（ADR 0011）
- 接口数据用 TanStack Vue Query 5 管理，全局关闭失败重试和切回窗口时的自动刷新（ADR 0017）
- 接口请求走同源的 `appConfig.apiBaseUrl`（`/backend`），由 Vite 或 nginx 转发到后端（ADR 0008）
- 接口函数写在 `features/<域>/api.ts`，统一用 `shared/http/client.ts` 的 `http.get / post / put / delete`，不直接使用 axios
- 每个请求都传 zod schema，返回值类型由 schema 推断（`z.infer`），不另外手写 interface；对象中可能缺失的字段写 `.optional()`（zod 4 中 `z.unknown()` 字段默认必填）
- 失败时抛出 `ApiError`，按 `kind` 区分；接口函数里不弹提示，全局提示由 app 注入，需要自己处理时传 `silent: true`
- 成功时没有 `{ code, msg, data }` 外层的接口（如要素查询）传 `envelope: false`，schema 描述整个返回体；失败时的信封仍按业务码转成 `ApiError`（ADR 0047）
- 支持取消的场景把 `AbortSignal` 传给接口函数
- 查询和变更写在 `features/<域>/queries.ts`，用 TanStack Vue Query 的 `useQuery` / `useMutation`；`queryFn` 把收到的 `signal` 交给接口函数，组件不直接拼 query key；接口数据由查询缓存持有，不放进 Pinia，组件里也不另存一份
- 服务端写操作用 `shared/auth/session-guard` 的 `useSessionGuard` 核对会话：提交时 `capture()`，`mutationFn` 发请求前 `assertCurrent()`（调度期间换了会话就不用新凭据发送旧操作），响应后 `isCurrent()`（旧会话不刷新新缓存、不报告成功）；已发出的写操作不随卸载取消。只是过期不算换会话，组合式函数不另外判断 `isActive()`，由 shared/http 在发请求前统一按登录过期处理；路由已限定的角色也不在组合式函数里重复判断
- shared/http 不依赖路由、UI 和鉴权，这些由 `app/http.ts` 通过 `configureHttp` 注入
- 例外：AI 对话的后端是第二个服务（同源 `/ai-backend`、Bearer、没有信封、SSE），最小迁移时暂由 `features/ai-chat/ai-client.ts` 用 `fetch` 请求，错误仍转成 `ApiError`，AI 的 401 不结束系统会话；重构时统一进 shared/http，其他模块不照搬（见 `docs/modules/ai-chat.md`）
- `useQuery` 的 key 变化后，`data` 要到下一轮调度才换成新 key 的结果；同步读取或在侦听里要知道结果属于哪个 key 时，用 `select` 给结果标上 key 再比较（写法见 `features/resource-map/queries.ts` 的 `useFeatureDetailQuery`）
