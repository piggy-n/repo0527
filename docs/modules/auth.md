# 鉴权（shared/auth 与 features/auth）

相关决策：ADR 0015
对应目录：`apps/web/src/shared/auth/`、`apps/web/src/features/auth/`

- `shared/auth`：登录会话、角色、token 过期判断，应用的各部分都会用到
- `features/auth`：登录接口、密码加密，只有登录功能使用
- `app`：路由守卫（`app/router/auth-guard.ts`）、请求头与 401 处理（`app/http.ts`）、多标签页同步（`app/session-sync.ts`）
- `pages/login`：登录页，组合登录表单并在成功后跳转

登录这条链路按"逻辑 → 界面 → 页面"分三层，各层只做一件事：

```
pages/login/LoginPage.tsx                       布局；登录成功后进入角色首页、提示"登录成功"
  └─ features/auth/components/LoginForm.tsx     表单界面；按回车提交；失败时弹出提示；成功时触发 success
       └─ features/auth/composables/useLoginForm.ts   表单数据、校验规则、提交中状态、submit()；不渲染、不跳转、不提示
            ├─ features/auth/api.ts             login()：加密、请求、字段转换
            └─ shared/auth/session-store.ts     start()：保存会话
```

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
| `clear()` | 清空会话；localStorage 中的会话是本标签页的（token 相同）时才删除，见"多标签页" |
| `syncFromStorage()` | 重新读取 localStorage 中的会话，由 `app/session-sync.ts` 在其他标签页修改会话时调用 |

`watchSessionStorage(onChange)` 与 store 一起从 `session-store.ts` 导出：其他标签页写入或删除会话时回调，返回取消监听的函数。

## 存储

- localStorage 的键是 `yzt.session`，值就是 `session` 的 JSON
- 读取时按 zod schema 校验：JSON 损坏、结构不符（例如旧版本写入的数据）、token 为空时，视为未登录并删除这条数据
- 浏览器禁用存储时不报错，会话只保存在内存中，刷新页面后需要重新登录

## token 过期

`token.ts` 用 jwt-decode 读取 JWT 载荷中的 `exp`：

- `getTokenExpiry(token)`：过期时间（毫秒时间戳）；不是 JWT 或没有 `exp` 时返回 `undefined`
- `isTokenExpired(token, now?)`：提前 30 秒视为过期；无法得知过期时间时视为未过期

这里只读取载荷，不校验签名：前端拿不到签名密钥，也不需要校验。本地判断只用于提前跳转到登录页，token 是否有效最终由后端决定（返回 401）。

载荷用 zod 校验（`{ exp: number }`），不直接解构 `jwtDecode()` 的返回值：jwtDecode 只保证载荷能按 JSON 解析，它的返回类型 `JwtPayload` 在运行时并不成立。阶段二的实现直接解构，载荷是 JSON `null` 时（例如 `e30.bnVsbA.x`）抛出 `TypeError`；这个错误不是 `InvalidTokenError`，会一直抛到路由守卫，导航失败。会话 schema 只要求 token 非空，这样的 token 能从存储进入守卫，每次刷新都会失败。阶段三开始前修复，现在按"无法得知过期时间"处理，由后端的 401 兜底。

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
- `onUnauthorized`：请求发出时带的 token 与当前会话的 token 不同时忽略（见下文）；否则清空会话，如果不在登录页，提示"登录状态已过期，请重新登录"并回到登录页
- 旧项目在每个请求发出前都先检查 token 是否过期；新项目不做这一步，由路由守卫在切换页面时检查，请求期间过期则由后端的 401 处理
- `router` 由参数传入，而不是直接导入：测试时可以换成只含所需路由的内存路由

### 旧会话的 401

一个 401 只说明"发出这个请求时带的 token 无效"，不能说明当前会话无效。阶段二的实现收到 401 就清空会话，会误伤之后建立的会话：token 过期后页面同时发出几个请求，快的先返回 401 回到登录页，用户重新登录（同一账号也会拿到新 token）；慢的请求（默认超时 60 秒）晚到的 401 又把新会话清掉。

现在 `shared/http` 把请求发出时 `getHeaders` 返回的请求头交给 `onUnauthorized(error, { headers })`，`app/http.ts` 比较其中的 token 与当前会话的 token，不同就忽略。`shared/http` 仍然不认识 token，只报告"这个请求带了哪些请求头"。附带的效果：同一批请求的多个 401 只有第一个会清空会话并提示，之后的 token 已对不上。

没有采用的做法：

- 会话版本号：原理相同，但请求还要带上版本号，比直接比较 token 多一个概念
- 会话变化时中止所有进行中的请求：还能防止旧会话的数据和错误提示出现在新会话中，但要和查询缓存一起设计，见下文"会话结束的统一处理"
- 在回调里用 `isActive()` 判断：后端让一个还没到期的 token 失效时，前端也必须退出

### 会话结束的统一处理（阶段三设计）

目前 `clear()` 只清会话，占位页阶段够用。引入列表和查询缓存后，会话结束（退出、401、token 过期、其他标签页退出或换账号）要一起处理：

| 事项 | 问题 |
|---|---|
| 取消请求 | 旧会话进行中的请求晚到后，数据可能显示给新账号，出错时的全局提示会弹在新会话上 |
| 账号之间的数据隔离 | 查询缓存、feature 的 store 中留着上一个账号的数据 |
| 清理缓存 | 查询缓存与 store 的重置顺序；重置后正在显示的页面是否会重新请求 |
| 错误提示由谁负责 | 退出（成功提示）、过期（警告）、其他标签页（说明原因）的提示不同；被取消的请求不提示 |
| 发请求前检查过期 | 目前只在切换页面时检查，请求期间过期靠后端 401（见上文）。2026-10-08 实测文件接口 `/file/page` 不校验 token（无效、不带都返回数据），对这类接口，停在页面上超过有效期后仍能继续请求；要不要像旧项目那样在发请求前检查，在这里一起决定。token 由后端签发，实测有效期 100 小时（`exp - iat`） |

协调逻辑放在 `app`：`app` 可以依赖所有目录，由它决定顺序、跳转和提示；`shared/auth` 只管会话本身，不反向依赖各 feature。

其中"其他标签页退出或换账号"已在阶段三开始前处理（见下一节）；引入 `endSession` 这类统一入口时，把它的"其他标签页退出"分支并进去。

### 多标签页

阶段二的 session store 只在创建时读取一次 localStorage，各标签页内存中的会话互不同步：标签页 2 退出 A、登录 B 后，标签页 1 仍显示 A、请求仍带 A 的 token，存储中却已是 B，刷新后身份才变。阶段三开始前修复，分工与 401 相同：

- `shared/auth` 提供机制：`watchSessionStorage(onChange)` 监听其他标签页对会话的修改（`storage` 事件只派发给其他标签页；`key` 为 `null` 表示对方清空了整个存储），返回取消监听的函数；store 的 `syncFromStorage()` 重新读取存储。存储的键名留在模块内部
- `app/session-sync.ts` 的 `setupSessionSync(router)` 决定怎么应对：

| 其他标签页做了什么 | 本标签页 |
|---|---|
| 同一账号重新登录（只换了 token） | 只更新内存中的 token，不刷新、不跳转 |
| 登录了另一个账号，或本标签页原来未登录 | 重新加载页面：权限、菜单和页面数据都按新身份重建；停在登录页时也会随之进入首页 |
| 退出（或因 401、过期清空了会话） | 清空内存；不在公开页面时提示"已在其他标签页退出登录，请重新登录"并回到登录页 |

- 换账号用重新加载而不是跳转：重新加载会顺带取消进行中的请求、清掉内存中上一个账号的一切状态，不需要逐项清理；代价是本标签页未保存的输入会丢失
- "同一账号"按登录名和角色判断
- `setupSessionSync` 调用时就创建 session store，所以 `main.ts` 中要放在安装 pinia 之后。如果等到事件发生时才创建，store 创建时读到的已是新会话，无法与之前的身份比较（写测试时发现：本标签页未登录时收不到"重新加载"）

`clear()` 的比较后删除：阶段二的 `clear()` 总是删除 localStorage 中的会话，会删掉其他标签页刚登录的会话，例如：

- 标签页 1 登录着 A，收到 401 或 token 过期时，删掉了标签页 2 用 B 登录的会话
- 标签页 1 未登录、停在登录页，标签页 2 登录后，在标签页 1 点击业务页，路由守卫调用 `clear()`，同样删掉了会话

标签页 2 刷新后就被退出。现在 `clear()` 只在存储中的 token 与本标签页相同时才删除，内存照常清空。有了 `storage` 同步后仍需要它：事件到达之前有时间窗口，本标签页内存中的会话可能还是旧的。

## 登录表单

### useLoginForm

```ts
const { formRef, model, rules, submitting, errorMessage, submit } = useLoginForm();

<ElForm ref={formRef} model={model} rules={rules}>...</ElForm>

const session = await submit();   // 成功时是会话，校验未通过或登录失败时是 undefined
```

| 返回值 | 说明 |
|---|---|
| `formRef` | 绑定到 `ElForm` 的 `ref`，`submit()` 通过它调用 `validate()` |
| `model` | `{ loginName, password }`，reactive |
| `rules` | 必填校验，在失焦和值变化时触发（`trigger: ['blur', 'change']`）；账号只有空格也算未填写（`whitespace: true`） |
| `submitting` | 提交中；用于按钮的 `loading` |
| `errorMessage` | 最近一次登录失败的原因，每次提交前清空 |
| `submit()` | 校验 → 登录 → `start()` 保存会话；账号去掉首尾空格，密码原样提交 |

- 提交中再次调用 `submit()` 会被忽略。标志在第一个 `await` 之前设置，回车和点击同时触发也只发一次请求，所以不需要旧项目的 150ms 防抖
- 只捕获 `ApiError` 并写入 `errorMessage`；其他异常（代码错误）照常抛出，不被吞掉
- 表单销毁时（`onScopeDispose`）取消进行中的登录，晚到的结果不写入会话，被取消的请求也不写 `errorMessage`。阶段二没有处理：登录 A 未完成时表单销毁、随后建立了 B 的会话，A 的结果返回后会把当前会话和存储都覆盖成 A。请求返回后还要再检查一次 `signal.aborted`：响应已经收到、后续代码还没执行时表单被销毁（Vue 的卸载也在微任务中进行），取消来不及生效。这个时间窗口在测试中无法稳定构造，这次检查没有单独的用例
- 不跳转、不弹提示：由使用它的组件决定怎么显示，同一套逻辑可以配不同的界面

### LoginForm 与登录页

- `LoginForm` 绑定 `useLoginForm`；登录失败时用 `ElMessage.error` 显示 `errorMessage`，成功时触发 `success` 事件并带上会话
- 在输入框中按回车提交。输入法选字时按的回车（`event.isComposing`）不提交。没有监听表单的 `submit` 事件，因为 `ElForm` 的类型没有声明 `onSubmit`
- 按钮的加载样式用 `useDelayedFlag(submitting)`：请求 300ms 内完成时不显示，显示后至少保持 400ms，避免按钮一闪（见 [composables.md](composables.md)）

#### 校验为什么同时在 blur 和 change 时触发

`ElInput` 在失焦时以 `blur` 触发表单项校验，在值变化时（`watch(modelValue)`）以 `change` 触发。只写 `trigger: 'blur'` 时，值变化这次没有匹配的规则，表单项什么也不做，已经显示的错误提示也不会清除。

这在浏览器自动填充时会出问题：先清空输入框（失焦后显示"请输入账号"），再从下拉列表选择保存的账号，浏览器会同时写入账号和密码。聚焦的那个输入框之后失焦时会重新校验，错误消失；另一个没有聚焦，不会失焦，错误就一直留着，看起来像"有时只影响账号或密码，和当前聚焦的输入框有关"。加上 `change` 后，值一变化就重新校验。回归测试："显示校验错误后，值被自动填充写入（没有失焦）时错误随之消失"，修复前失败、修复后通过。
- `LoginPage` 收到 `success` 后 `router.replace` 到角色首页（按后退键不会回到登录页），再提示"登录成功"
- 输入框和按钮用主题变体 `input-filled`、`button-xl`（见 [design/theme.md](../design/theme.md)），按钮用 Element 的 `autoInsertSpace` 在"登录"两字之间加空格

### 登录页布局

外观按 2026-09-30 确认的设计稿（方案 A）实现。完成外观时只改了 `LoginPage` 和 `LoginForm` 的样式与 class，`useLoginForm` 没有改动。

背景由两张图组成，放在 `pages/login/images/`，只有登录页使用，和页面放在一起；构建时文件名带内容哈希：

| 文件 | 尺寸 | 内容 |
|---|---|---|
| `login-background.webp` | 3840×2160，71 KB | 整页的浅色底图 |
| `login-illustration.webp` | 2078×2160，252 KB | 左侧的插画，宽度是底图的 54.1% |

样式从窄到宽编写，断点只往上加：

| 视口宽度 | 布局 |
|---|---|
| < 600px | 单列；只显示底图，靠右对齐（与宽屏时卡片后面的背景一致）；卡片宽度为屏宽减 32px，内边距 36/24/40 |
| 600～1199px | 单列；卡片 480px，内边距 52/44/56 |
| ≥ 1200px | 左侧插画占 54.1%，卡片在插画右侧的区域居中 |
| ≥ 2400px | 卡片整体放大 1.25 倍（CSS `zoom`，令牌值不变；不支持的旧浏览器保持原尺寸） |

- 单列的断点是 1200px：插画右侧剩下 45.9% 的宽度，要放下 480px 的卡片和两侧留白，视口至少要 1150px 左右
- 插画的背景图只写在 ≥1200px 的规则里，窄屏时不会下载（已验证：窄屏只请求了底图）
- 系统名称和 `WELCOME!` 都是高度 1em 的 SVG，宽度不够时按比例缩小，不需要单独的断点

已验证的尺寸（卡片位置与大小、表单项间距、是否与插画重叠、是否出现滚动条）：375×812、768×1024、1199×800、1200×800、1280×720、1366×768、1440×900、1920×1080、2560×1440、3840×2160。卡片为 480×404（手机 343×364，≥2400px 为 600×505），输入框之间 24px、按钮前 32px，都不与插画重叠，都没有滚动条。

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

### 账号或密码错误时的提示

2026-09-30 用错误密码实测，登录页提示"密码错误"：后端返回的是业务码加 `msg`，不是 401，`ApiError.message` 就是后端的文案，直接显示。

如果以后后端改为返回 401，`resolveErrorMessage` 会把文案统一成"登录状态已过期，请重新登录"，在登录页上意思不对，需要在登录表单里单独处理。

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
- 多标签页同步（阶段三开始前修复）：`setupSessionSync` 5 个用例，session store 增加 2 个；改坏 3 处（不调用 `syncFromStorage`，即修复前的行为；同一账号也当成换账号；不过滤存储的键名），每处都有用例失败。浏览器实测（开发服务器，两个标签页）：停在登录页的标签页在另一个标签页登录后自动进入首页；同一账号换 token 时不刷新；换成 B 登录后重新加载并显示 B；另一个标签页退出时提示并回到登录页
- 多标签页的比较后删除（阶段三开始前修复）：session store 增加 2 个用例；改坏 2 处（比较条件写反、不删存储时也不清内存），每处都有用例失败。浏览器实测（开发服务器）：停在登录页时写入另一个会话，模拟其他标签页登录，再用客户端导航进入 `/current-map`；守卫把页面带回 `/login`，存储中的会话保留，刷新后进入 `/current-map`
- 旧会话的 401（阶段三开始前修复）：`setupHttp` 增加到 5 个用例，`client.test.ts` 增加 1 个；改坏 2 处（去掉 token 比较，即修复前的逻辑；回调时重新读取请求头而不是用发出时的），新用例都因断言失败
- `useLoginForm` 6 个用例（用只含 `ElForm` 的宿主组件运行）、`LoginForm` 3 个用例；逐个改坏 10 处（去掉 `vite.config.ts` 中 inline element-plus 的修复、去掉 `whitespace`、去掉提交中判断、账号不去空格、不保存会话、不清空上次错误、校验失败当成通过、选字回车也提交、失败不提示、成功不触发事件），每处都有用例失败
- 写 `useLoginForm` 的测试时发现 Element 表单的校验在 Vitest 中永远通过，原因和修复见 [config/vite-config.md](../config/vite-config.md)
- 构建产物：sm-crypto-v2 只出现在登录页的 chunk 中（174 KB，gzip 64 KB），首屏入口不引用它
- 浏览器实测（开发服务器，真实后端）：
  - 登录页空表单提交，两个输入框显示"请输入账号""请输入密码"，没有发出请求
  - 在页面中调用 `encryptPassword`：密文长度 208（`admin123`），两次结果不同；浏览器提供 `crypto.getRandomValues`，sm-crypto-v2 不会用到 Node 的 `crypto`
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
