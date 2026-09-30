# 鉴权（shared/auth 与 features/auth）

相关决策：ADR 0015
对应目录：`apps/web/src/shared/auth/`、`apps/web/src/features/auth/`

- `shared/auth`：登录会话、角色、token 过期判断，应用的各部分都会用到
- `features/auth`：登录接口、密码加密，只有登录功能使用
- `app`：路由守卫（`app/router/auth-guard.ts`）、请求头与 401 处理（`app/http.ts`）
- 登录表单逻辑完成后补充到本文

## 会话怎么用

```ts
import { storeToRefs } from 'pinia';
import { useSessionStore } from '@/shared/auth/session-store';

const session = useSessionStore();

session.isActive();                 // 已登录且 token 未过期
session.start({ token, user });     // 登录成功后
session.clear();                    // 退出登录、收到 401 时

// 组件里读取 state 和 getter 要用 storeToRefs，直接解构会失去响应性
const { user, displayName } = storeToRefs(session);
```

| 成员 | 说明 |
|---|---|
| `session` | `{ token, user }` 或 `null` |
| `token` | 请求头 `token` 的值，未登录时为 `undefined` |
| `user` | `{ id?, loginName, realName?, avatar?, role }` |
| `displayName` | 真实姓名；为空时用登录名 |
| `isActive(now?)` | 已登录且 token 未过期 |
| `start(session)` | 保存会话，同时写入 localStorage |
| `clear()` | 清空会话和 localStorage |

## 存储

- localStorage 的键是 `yzt.session`，值就是 `session` 的 JSON
- 读取时按 zod schema 校验：JSON 损坏、结构不符（例如旧版本写入的数据）、token 为空时，视为未登录并删除这条数据
- 浏览器禁用存储时不报错，会话只保存在内存中，刷新页面后需要重新登录

## token 过期

`token.ts` 用 jwt-decode 读取 JWT 载荷中的 `exp`：

- `getTokenExpiry(token)`：过期时间（毫秒时间戳）；不是 JWT 或没有 `exp` 时返回 `undefined`
- `isTokenExpired(token, now?)`：提前 30 秒视为过期；无法得知过期时间时视为未过期

这里只读取载荷，不校验签名：前端拿不到签名密钥，也不需要校验。本地判断只用于提前跳转到登录页，token 是否有效最终由后端决定（返回 401）。

## 角色

`roles.ts`：

- `Role`：`admin`、`user`，值与后端的 `roleCode` 相同
- `toRole(roleCode)`：缺失或无法识别时按 `user` 处理，与旧项目一致
- `roleHome(role)`：角色登录后进入的页面（目前两种角色都是现状底图），也是访问无权限页面时的去处
- `canAccess(role, allowed)`：`allowed` 为 `undefined` 表示不限角色；路由守卫用它检查页面权限，布局的导航菜单也用它过滤

## 页面权限（路由 meta）

权限写在 `app/router/routes.ts` 的路由上，不另外维护路径清单：

```ts
{ path: '/login', name: RouteName.login, component: ..., meta: { title: '登录', public: true } }
placeholder('system-management', RouteName.systemManagement, '系统管理', [Role.admin])   // meta.roles
```

| meta | 含义 | 当前使用的页面 |
|---|---|---|
| `public: true` | 不登录也能访问 | 登录页、404、开发用的主题预览 |
| `roles: [...]` | 只允许这些角色访问 | 资源管理、系统管理（`admin`）；资源申请（`user`） |
| 都不写 | 所有已登录用户都能访问 | 其余业务页 |

`routes.test.ts` 明确列出了公开页面和限定角色的页面。给业务页误加 `public`，或者改了角色限制，这个测试都会失败；确实要改时，同步修改测试。

子路由的 `to.meta` 是父路由和子路由 meta 的浅合并，同名字段以子路由为准。所以 `public`、`roles` 写在父路由上会作用于全部子路由（已验证）。

## 路由守卫

`app/router/auth-guard.ts` 的 `installAuthGuard(router)` 按下面的顺序检查：

| 情况 | 结果 |
|---|---|
| 访问登录页，且已登录（token 未过期） | 进入角色首页 |
| 访问登录页，未登录 | 放行 |
| 访问 `public` 页面 | 放行 |
| 未登录，或 token 已过期 | 清空残留的会话，去登录页 |
| 角色不在 `meta.roles` 中 | 回到角色首页 |
| 其他 | 放行 |

- 重定向都带 `replace: true`：例如在现状底图点了没有权限的页面，重定向回现状底图时不会在历史记录里多留一条
- 守卫里调用 `useSessionStore()`：`main.ts` 中 pinia 先于 router 安装，首次导航开始时已经可以取到 store
- 登录后不回到原来要访问的页面，而是进入角色首页，与旧项目一致

## 请求头与 401

`app/http.ts` 的 `setupHttp(router)` 通过 `configureHttp` 注入：

- `getHeaders`：每次请求时读取会话，有 token 时加上请求头 `token`；登录、退出后立即生效
- `onUnauthorized`：先清空会话；如果不在登录页，提示"登录状态已过期，请重新登录"并回到登录页
- 旧项目在每个请求发出前都先检查 token 是否过期；新项目不做这一步，由路由守卫在切换页面时检查，请求期间过期则由后端的 401 处理
- `router` 由参数传入，而不是直接导入：测试时可以换成只含所需路由的内存路由

## 登录接口

```ts
import { login } from '@/features/auth/api';

const session = await login({ loginName, password });   // 明文密码，函数内部加密
useSessionStore().start(session);
```

- 请求 `POST /user/login`，请求体 `{ loginName, password }`，`password` 是 SM2 密文
- 返回值已经转换成会话结构（`Session`），可以直接交给 `start()`：
  - `roleCode` 经 `toRole` 转成 `role`
  - 数字 `id` 转成字符串
  - 响应没有 `loginName` 时依次用 `username`、输入的登录名
  - `null` 字段去掉
- 响应缺少 `token` 或 `roleCode` 时抛出 `invalid-response`：后端的约定变了应该尽早暴露，而不是把管理员当成普通用户
- 请求设置了 `silent: true`：失败时不弹全局提示，由登录表单显示错误。401 不受 `silent` 影响，仍会调用 `onUnauthorized`；app 注入的回调在登录页上不做任何事

### 待验证

后端对"账号或密码错误"返回什么，要等登录页完成后用错误密码实测：

- 如果是业务码（如 500）加 `msg`：`ApiError.message` 就是后端的文案，直接显示即可
- 如果是 401：`resolveErrorMessage` 会把文案统一成"登录状态已过期，请重新登录"，在登录页上意思不对，届时要在登录表单里单独处理

### 密码加密

`password.ts` 的 `encryptPassword(password, publicKey)` 用 sm-crypto-v2 做 SM2 加密：

- 密文按 C1C3C2 排列，是不带 `04` 前缀的小写十六进制，长度 = 128（C1）+ 64（C3）+ 明文字节数 × 2
- 加密含随机数，同一密码每次的密文都不同
- 公钥作为参数传入，函数没有外部依赖；`login` 传入 `appConfig.loginPublicKey`（环境变量 `VITE_LOGIN_PUBLIC_KEY`，见 [config/env.md](../config/env.md)）
- 前端只有公钥，不保存私钥：旧项目把私钥写在前端代码里，等于公开了私钥（ADR 0015）

## 测试

`testing.ts` 提供测试用的 JWT：

```ts
import { createTestJwt, createTestJwtExpiringAt } from '@/shared/auth/testing';

createTestJwt({ sub: 'u1', exp: 1_790_000_000 });
createTestJwtExpiringAt(Date.now() + 3_600_000);
```

头和载荷是真实的 base64url 编码，签名是假的。测试过期逻辑时用 `vi.useFakeTimers({ now })` 固定当前时间。

密码加密的测试用 `sm2.generateKeyPairHex()` 临时生成密钥对，用私钥验证密文能被解密；登录接口的测试用 MSW 模拟，检查请求体里的密码是密文而不是明文。

已验证：

- `shared/auth` 共 17 个用例；逐个改坏 9 处源码（去掉 30 秒提前量、`exp` 不换算毫秒、非 JWT 时抛错、不删除损坏数据、`start` 不写存储、`clear` 不删存储、`||` 改成 `??`、接受任意角色码、允许空 token），每处都有用例失败
- `features/auth` 共 10 个用例，`appConfig` 的公钥校验 3 个用例；逐个改坏 10 处（改成 C1C2C3、去掉 `silent`、明文提交密码、`||` 改成 `??`、`roleCode` 可缺失、角色写死、`id` 不转字符串、允许空 token、公钥长度放宽、不检查 `04` 前缀），每处都有用例失败
- 路由守卫 8 个用例、`setupHttp` 3 个用例、路由表的权限 2 个用例、`canAccess` 2 个用例；逐个改坏 11 处（公开页面也要求登录、不检查过期、过期不清会话、已登录仍停在登录页、不检查角色、空数组视为不限角色、不带 token、401 不清会话、登录页上也提示并跳转、业务页误加 `public`、系统管理不限角色），每处都有用例失败
- 浏览器实测（开发服务器，真实后端）：
  - 未登录访问 `/current-map` 被带到 `/login`
  - 在 localStorage 放入普通用户的测试会话后：访问 `/system-management` 回到 `/current-map`；`/resource-application` 能进入；`/login` 进入 `/current-map`；不存在的地址显示 404
  - 带着这个假 token 请求 `/system/upms/user/detail`：请求带有 `token` 请求头，后端返回 401；会话被清空，页面回到 `/login`，提示"登录状态已过期，请重新登录"

## 设计理由

- **会话放在 shared 而不是 features/auth**：路由守卫、HTTP 请求头、布局（用户名、退出）都要读会话，它们不属于 auth 这个 feature；而 features 之间不能互相导入
- **`isActive` 是方法而不是 computed**：computed 只在它读取的响应式数据变化时重新计算，时间流逝不会触发，写成 computed 会一直返回第一次算出的结果
- **显示名用 `||` 而不是 `??`**：后端可能返回空字符串的真实姓名，`??` 只在 `null` / `undefined` 时才取后者
- **schema 同时用于校验和类型**：`Session` 类型由 `sessionSchema` 推断（`z.infer`），存储格式只有一处定义
- **`roleHome` 用 `Record<Role, RouteName>`**：新增角色时如果漏配首页，类型检查会报错
- **接口函数负责字段转换**：`login` 返回 `Session` 而不是后端的原始结构，后端改字段名时只需改 `api.ts`。这种在边界上隔离外部模型的做法叫"防腐层"（anti-corruption layer）
- **加密放在接口函数里，而不是表单逻辑里**：怎么加密是和后端的约定，属于接口的一部分；表单只处理用户输入的明文
