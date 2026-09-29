# 0015. 登录与会话：会话存 localStorage，SM2 用 sm-crypto-v2，权限声明在路由上

- 状态：已接受
- 日期：2026-09-29

## 背景

旧项目的登录与鉴权分散在多个文件里：

- `views/login/index.vue`：表单、SM2 加密密码、"记住账号 / 密码"（明文 base64 存在 sessionStorage）；登录后再用写死在代码里的账号密码登录 AI 后端
- `services/auth/auth-service.js`：token 和用户信息同时写进 localStorage 和 sessionStorage 的新旧两套键；用 `atob` 解析 JWT 判断过期；按角色维护两份允许访问的路径清单
- `utils/func-crypto.js`：用 sm-crypto 加密；同一文件里还写着 SM2 私钥和 SM4 密钥
- `router/index.js`、`libs/http-service.js`：路由守卫和请求拦截器各自读取存储

## 候选方案

SM2 加密库：

1. sm-crypto-v2：用 TypeScript 重写，自带类型和 ESM，底层是经过审计的 `@noble/curves`，版本 1.x，接口与 sm-crypto 兼容
2. sm-crypto 0.5：旧项目在用的库的新版。CommonJS，没有类型声明，仍是 0.x；2026 年 7~8 月连续发布了多个版本（发布者仍是原作者）

token 过期判断：

1. jwt-decode：auth0 维护，无依赖，带类型
2. 手写解析：旧代码的写法，`atob` 会把载荷里的中文解成乱码（不影响 `exp`），base64url 的补位和字符替换都要自己处理
3. 不在本地判断，只靠后端返回 401：少一个依赖，但打开页面后要等第一个请求失败才跳转

登录公钥的位置：`.env` 环境变量，或代码中的常量。

会话存储：

1. localStorage：关闭浏览器后仍保持登录，与旧项目相同
2. sessionStorage：关闭标签页即退出，新开标签页也要重新登录
3. httpOnly Cookie：脚本读不到 token，最安全，但需要后端改造

页面权限：

1. 在路由的 `meta.roles` 上声明允许的角色
2. 按角色维护允许访问的路径清单（旧做法）

## 决定

- 会话 `{ token, user }` 由 `shared/auth` 的 `useSessionStore` 管理，只在 localStorage 保存一份（键 `yzt.session`）；读取时用 zod 校验，不符合就丢弃
- 用 jwt-decode 读取 `exp`，提前 30 秒视为过期；不是 JWT 或没有 `exp` 时视为未过期，由后端的 401 兜底。前端不校验签名
- 登录密码用 sm-crypto-v2 的 SM2 加密（C1C3C2）；公钥放在 `.env` 的 `VITE_LOGIN_PUBLIC_KEY`，由 `appConfig` 校验格式
- 页面权限声明在路由的 `meta.roles` 上，公开页面标记 `meta.public`，路由守卫只读 meta
- 请求头 `token` 由 app 通过 `configureHttp` 的 `getHeaders` 注入；收到 401 时清空会话、回到登录页
- 角色只识别 `admin`、`user`，缺失或无法识别时按 `user` 处理，与旧项目一致
- 不迁移：
  - 记住账号 / 密码
  - AI 后端登录：账号密码写在前端代码里，迁移 AI 对话时另行决定
  - SM2 私钥、解密函数与 SM4
  - `sadmin` 的特殊判断：它来自不迁移的 mockjs 数据
  - 提交时的 150ms 防抖：改为提交中标志
  - 新旧两套存储键

## 实测结果

- sm-crypto-v2 1.15.1 与旧项目的 sm-crypto 0.3.14 互相加解密：3 组明文（含中文、64 个字符的长串）双向都能正确解密；密文长度一致，都是不带 `04` 前缀的小写十六进制
- 旧代码的 `atob` 写法：载荷 `{ name: '张三' }` 解出 `'å¼ ä¸\x89'`，不报错，`exp` 正确
- 后端的接口文档（`/v3/api-docs` 等）需要登录才能访问，所以登录响应的结构按旧代码的用法确定：`token`、`roleCode` 必填，其余字段可选
- 其余各部分的测试与验证记录在 [modules/auth.md](../modules/auth.md)

## 后果

- 好处：会话只有一个来源；存储里的旧数据、被手工改坏的数据不会让页面出错
- 好处：权限和路由写在一起，新增页面时不会忘记修改另一份清单
- 代价：token 放在 localStorage，页面一旦被注入脚本（XSS）就能读到。httpOnly Cookie 更安全，但需要后端配合改造；旧项目也是这样存的
- 代价：本地判断过期不校验签名，只用于提前跳转到登录页，真正的鉴权仍在后端
- 风险：旧前端的代码中公开了登录用的 SM2 私钥，建议后端更换密钥对；更换后只需修改 `.env`
