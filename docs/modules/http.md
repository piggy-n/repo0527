# shared/http：HTTP 客户端

对应目录：`apps/web/src/shared/http/`、`apps/web/src/app/http.ts`
相关决策：ADR 0008（同源代理）、ADR 0011（axios + zod + MSW）

## 文件

| 文件 | 内容 |
|---|---|
| `client.ts` | 请求实例、响应解析、错误转换，对外只导出 `http` 和类型 |
| `errors.ts` | `ApiError` 与 `ApiErrorKind` |
| `messages.ts` | 状态码到中文提示的对照，文案沿用旧项目 |
| `configure.ts` | `configureHttp` / `getHttpHooks`：app 注入的回调 |
| `client.test.ts` | 用 MSW 模拟接口的测试 |
| `app/http.ts` | 在 app 层实现回调：401 提示并跳转登录页，其他错误弹出提示 |

## 怎么写接口函数

接口函数写在各 feature 的 `api.ts` 里，不直接使用 axios：

```ts
import { z } from 'zod';
import { http } from '@/shared/http/client';

const layerSchema = z.object({
  id: z.string(),
  name: z.string(),
  year: z.number().nullable()
});

/** 类型从 schema 推断，不另外手写 interface */
export type Layer = z.infer<typeof layerSchema>;

export function fetchLayers(year: number, signal?: AbortSignal) {
  return http.get('/resource-management/layers', {
    schema: z.array(layerSchema),
    query: { year },
    signal
  });
}
```

- `schema` 必填，没有返回值的接口也要写出来（例如 `z.null()`、`z.undefined()`）
- zod 4 中，对象里 `z.unknown()`、`z.any()` 字段默认必填，可能缺失的字段要写 `.optional()`
- 路径参数用模板字符串拼接，值要 `encodeURIComponent`
- 查询参数目前只支持标量；需要数组时，先确认后端期望的格式再扩展 `QueryValue`

## 请求的处理流程

```
http.get(url, options)
  → 合并调用方的 signal 与超时，得到统一的中止信号
  → 附加 getHeaders() 返回的请求头
  → axios 发出请求（baseURL 为 appConfig.apiBaseUrl，即 /backend）
  → 响应体按 { code, msg, data } 校验
      code === 200 → 按 schema 校验 data 并返回
      code === 401 → ApiError('unauthorized')
      其他 code     → ApiError('business')，提示优先用后端的 msg
  → 任何失败都转换成 ApiError，再按下表决定调用哪个回调，最后抛出
```

## ApiError 与回调

| `kind` | 什么时候 | 回调 |
|---|---|---|
| `business` | HTTP 成功，但 `code` 不是 200 | `onError`（`silent` 时不调） |
| `http` | HTTP 状态码不是 2xx（401 除外） | `onError`（`silent` 时不调） |
| `unauthorized` | HTTP 401 或业务码 401 | 只调 `onUnauthorized`，不受 `silent` 影响 |
| `network` | 没有收到响应 | `onError`（`silent` 时不调） |
| `timeout` | 超过 `timeout`（默认 60 秒） | `onError`（`silent` 时不调） |
| `canceled` | 调用方的 `signal` 被中止 | 都不调 |
| `invalid-response` | 响应结构或 `data` 不符合 schema | `onError`（`silent` 时不调） |

调用方需要自己处理错误时：

```ts
try {
  await saveLayer(layer, { silent: true });
} catch (error) {
  if (error instanceof ApiError && error.kind === 'business') {
    // 按业务码处理
  }
}
```

## 为什么这样设计

- **依赖倒置**：401 跳转要用 router，提示要用 `ElMessage`，它们属于 app 层。shared 不能依赖 app，所以 shared 只定义回调接口，由 app 在 `main.ts` 中调用 `setupHttp(router)` 注入。app 注入的内容（token 请求头、401 时清空会话）见 [auth.md](auth.md)
- **避免循环依赖**：鉴权 store 要调用登录接口，而 http 要读 token。token 通过 `getHeaders()` 回调获取后，依赖只有一个方向
- **超时自己实现**：MSW 的 XHR 拦截器模拟响应时不处理 `xhr.timeout`，axios 的超时在测试中测不到。改为 `AbortController` + `setTimeout`，和取消共用一套机制，中止原因是 `TIMEOUT_REASON` 时判为超时
- **`isAxiosError<unknown>()` 而不是 `instanceof AxiosError`**：`instanceof` 收窄出的是 `AxiosError<any>`，响应体会变成 `any`，类型感知 lint 会报错

## 测试

- 用 MSW 的 `setupServer()`，`onUnhandledRequest: 'error'`：没有注册的请求直接失败，避免测试意外访问真实网络
- jsdom 中相对地址按 `http://localhost:3000/` 解析，所以处理函数写 `/backend/...`
- 每个用例结束后 `server.resetHandlers()`、`configureHttp({})`，互不影响

## 暂未实现

| 事项 | 时机 |
|---|---|
| 上传、下载、进度 | 迁移文件管理时 |
| 不遵守 `{ code, msg, data }` 的接口 | 遇到时再加选项，例如 AI 后端 |
| 请求重试、去重、缓存 | 阶段三决定是否引入 TanStack Query 时一并考虑 |
