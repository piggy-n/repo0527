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
| `transfer.ts` | 业务无关的传输进度、可取消的小型 Blob 错误体读取 |
| `client-transfer.test.ts`、`transfer.test.ts` | 文件响应、上传进度、鉴权与取消的回归测试 |
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

### 没有信封的接口（ADR 0047 第 8 节）

要素查询这类接口成功时直接返回 `{ total, list, … }` 或数组，没有 `{ code, msg, data }` 外层，失败时却返回信封（如 `{ success: false, code: 500, data: null, msg: '系统异常' }`）。这类接口传 `envelope: false`：

```ts
export function queryFeaturesAt(layerCode: string, geometry: Point | Polygon, signal?: AbortSignal) {
  return http.get('/api/query/scope/geojson/page', {
    schema: featurePageSchema,  // 整个返回体的 schema
    envelope: false,
    query: { layerCode, geometry: JSON.stringify(geometry), relation: 'INTERSECTS' },
    signal
  });
}
```

- 返回体带数字 `code` 且不是 200 时按失败的信封处理，和有信封时一样：401 是 `unauthorized`，其他是 `business`，提示优先用后端的 `msg`
- 否则整个返回体按 `schema` 校验，不符合时是 `invalid-response`；所以成功的返回体不能有数字的 `code` 字段，遇到时再给失败的判断加条件
- 超时、取消、鉴权、回调和有信封时完全一样

### 文件上传与下载

上传继续使用 `http.post(url, formData, { schema, onUploadProgress, ... })`，由浏览器设置 multipart boundary，不手写 Content-Type。进度只暴露 `{ loaded, total, percent }`，总量未知时后两项为 null；发送 100% 不代表服务端成功。

`http.getBlob(url, { query, signal, timeout, silent, onDownloadProgress })` 返回 `{ blob, contentType, contentDisposition }`，不传 JSON schema；`http.postBlob(url, body?, options)` 是 POST 的版本（数据申请的下载，ADR 0092）；二进制先检查响应类型和错误信封，再交出 Blob。取消、鉴权和超时仍经过同一个请求通道。文件名整理、MIME 后备值和触发浏览器保存使用 `shared/file-transfer`，完整接口、限制和三场景示例见 [file-transfer.md](file-transfer.md)。

这些接口只中止网络传输，不撤销已经发生的服务端写入；上传与 Excel 导入的防重复、会话检查和刷新由各 feature 按 ADR 0039 持有。

## 请求的处理流程

```
http.get(url, options)
  → 合并调用方的 signal 与超时，得到统一的中止信号
  → 附加 getHeaders() 返回的请求头
  → isCredentialExpired() 为 true 时不发出请求，直接 ApiError('unauthorized')
  → axios 发出请求（baseURL 为 appConfig.apiBaseUrl，即 /backend）
  → 响应体按 { code, msg, data } 校验
      code === 200 → 按 schema 校验 data 并返回
      code === 401 → ApiError('unauthorized')
      其他 code     → ApiError('business')，提示优先用后端的 msg
    envelope: false 时：
      带数字 code 且不是 200 → 同上，按 401 或其他业务码处理
      否则           → 按 schema 校验整个响应体并返回
  → 任何失败都转换成 ApiError，再按下表决定调用哪个回调，最后抛出
```

## ApiError 与回调

| `kind` | 什么时候 | 回调 |
|---|---|---|
| `business` | HTTP 成功，但 `code` 不是 200 | `onError`（`silent` 时不调） |
| `http` | HTTP 状态码不是 2xx（401 除外） | `onError`（`silent` 时不调） |
| `unauthorized` | HTTP 401、业务码 401，或发请求前 `isCredentialExpired()` 返回 true（这时不发出请求） | 只调 `onUnauthorized(error, { headers })`，不受 `silent` 影响；`headers` 是请求发出时 `getHeaders()` 的返回值。提示文案固定为"登录状态已过期，请重新登录"（`UNAUTHORIZED_MESSAGE`），不用后端的 msg |
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
- **401 带上发出时的请求头**：401 只说明发出请求时带的凭据无效。请求往返期间会话可能已经换过，回调要能分辨这是不是旧会话的请求（见 [auth.md](auth.md) 的"旧会话的 401"）；shared 不认识 token，所以原样交出请求头，由 app 判断
- **超时自己实现**：MSW 的 XHR 拦截器模拟响应时不处理 `xhr.timeout`，axios 的超时在测试中测不到。改为 `AbortController` + `setTimeout`，和取消共用一套机制，中止原因是 `TIMEOUT_REASON` 时判为超时
- **`isAxiosError<unknown>()` 而不是 `instanceof AxiosError`**：`instanceof` 收窄出的是 `AxiosError<any>`，响应体会变成 `any`，类型感知 lint 会报错

## 测试

- 用 MSW 的 `setupServer()`，`onUnhandledRequest: 'error'`：没有注册的请求直接失败，避免测试意外访问真实网络
- jsdom 中相对地址按 `http://localhost:3000/` 解析，所以处理函数写 `/backend/...`
- 每个用例结束后 `server.resetHandlers()`、`configureHttp({})`，互不影响

## 暂未实现

| 事项 | 时机 |
|---|---|
| 失败时也不返回 `{ code, msg }` 的接口 | 遇到时再加选项，例如 AI 后端；成功时没有信封、失败时有的已用 `envelope: false` 支持 |
| 请求重试、去重、缓存 | 已决定（ADR 0017）：查询交给 TanStack Vue Query，相同 key 的请求自动去重、结果缓存；全局关闭失败重试 |
