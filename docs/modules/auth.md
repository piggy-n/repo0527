# 鉴权（shared/auth）

相关决策：ADR 0015
对应目录：`apps/web/src/shared/auth/`

`shared/auth` 管理登录会话、角色和 token 过期判断。登录接口与表单逻辑在 `features/auth`，路由守卫和请求头在 `app`，完成后补充到本文。

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

## 测试

`testing.ts` 提供测试用的 JWT：

```ts
import { createTestJwt, createTestJwtExpiringAt } from '@/shared/auth/testing';

createTestJwt({ sub: 'u1', exp: 1_790_000_000 });
createTestJwtExpiringAt(Date.now() + 3_600_000);
```

头和载荷是真实的 base64url 编码，签名是假的。测试过期逻辑时用 `vi.useFakeTimers({ now })` 固定当前时间。

已验证：`shared/auth` 共 17 个用例；逐个改坏 9 处源码（去掉 30 秒提前量、`exp` 不换算毫秒、非 JWT 时抛错、不删除损坏数据、`start` 不写存储、`clear` 不删存储、`||` 改成 `??`、接受任意角色码、允许空 token），每处都有用例失败。

## 设计理由

- **会话放在 shared 而不是 features/auth**：路由守卫、HTTP 请求头、布局（用户名、退出）都要读会话，它们不属于 auth 这个 feature；而 features 之间不能互相导入
- **`isActive` 是方法而不是 computed**：computed 只在它读取的响应式数据变化时重新计算，时间流逝不会触发，写成 computed 会一直返回第一次算出的结果
- **显示名用 `||` 而不是 `??`**：后端可能返回空字符串的真实姓名，`??` 只在 `null` / `undefined` 时才取后者
- **schema 同时用于校验和类型**：`Session` 类型由 `sessionSchema` 推断（`z.infer`），存储格式只有一处定义
- **`roleHome` 用 `Record<Role, RouteName>`**：新增角色时如果漏配首页，类型检查会报错
