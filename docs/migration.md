# 迁移进度

旧仓库：`C:\WebProject\yzt`，以 `master-demo` 分支为准。

开始迁移一个模块时，在下表记下旧仓库 `master-demo` 当时的 commit 作为基线。之后查看旧仓库的新改动：

```bash
cd C:\WebProject\yzt
git diff <基线>..master-demo -- <旧路径>
```

旧仓库的工作目录可能停在其他分支上，所以比较对象写 `master-demo`，不写 `HEAD`。

| 模块 | 基线 | 旧路径 | 新位置 | 状态 |
|---|---|---|---|---|
| 登录与鉴权 | `836f03b` | `src/views/login/`、`src/services/auth/auth-service.js`、`src/stores/user.js`、`src/utils/func-crypto.js`（`encryptPassword`）、`src/api/sys/sys-uaa-auth-api.js`、`src/router/index.js`（路由守卫）、`src/libs/http-service.js`（token 请求头与 401） | `shared/auth`、`features/auth`、`pages/login`、`app/router`、`app/http.ts` | 进行中（阶段二 2.9） |
