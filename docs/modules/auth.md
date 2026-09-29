# 鉴权（shared/auth 与 features/auth）

相关决策：ADR 0015
对应目录：`apps/web/src/shared/auth/`、`apps/web/src/features/auth/`

- `shared/auth`：登录会话、角色、token 过期判断，应用的各部分都会用到
- `features/auth`：登录接口、密码加密，只有登录功能使用
- 路由守卫、请求头和登录表单逻辑完成后补充到本文

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

## 设计理由

- **会话放在 shared 而不是 features/auth**：路由守卫、HTTP 请求头、布局（用户名、退出）都要读会话，它们不属于 auth 这个 feature；而 features 之间不能互相导入
- **`isActive` 是方法而不是 computed**：computed 只在它读取的响应式数据变化时重新计算，时间流逝不会触发，写成 computed 会一直返回第一次算出的结果
- **显示名用 `||` 而不是 `??`**：后端可能返回空字符串的真实姓名，`??` 只在 `null` / `undefined` 时才取后者
- **schema 同时用于校验和类型**：`Session` 类型由 `sessionSchema` 推断（`z.infer`），存储格式只有一处定义
- **`roleHome` 用 `Record<Role, RouteName>`**：新增角色时如果漏配首页，类型检查会报错
- **接口函数负责字段转换**：`login` 返回 `Session` 而不是后端的原始结构，后端改字段名时只需改 `api.ts`。这种在边界上隔离外部模型的做法叫"防腐层"（anti-corruption layer）
- **加密放在接口函数里，而不是表单逻辑里**：怎么加密是和后端的约定，属于接口的一部分；表单只处理用户输入的明文
