# vite.config.ts 配置说明

对应文件：`apps/web/vite.config.ts`
相关决策：ADR 0001（TSX）、ADR 0008（接口同源代理）

## 整体结构

配置导出的是一个函数 `defineConfig(({ mode }) => ({ ... }))`，而不是对象。因为代理配置要读取 `.env` 中的变量，而读取哪些文件取决于运行模式（`development` / `production`）。

## 各项配置

| 配置 | 值 | 说明 |
|---|---|---|
| `plugins` | `vueJsx()` | 用 Babel 编译 Vue 的 TSX（ADR 0001） |
| `resolve.tsconfigPaths` | `true` | 直接读取 tsconfig 的 `paths`，路径别名只在一处定义 |
| `server.proxy` | `/backend/` → `PROXY_TARGET` | 同源代理，见下文 |

### 读取环境变量

```ts
const env = loadEnv(mode, process.cwd(), '');
```

- 配置文件运行在 Node 里，此时 `import.meta.env` 还没有加载 `.env`，所以要用 `loadEnv` 手动读取
- 第三个参数是变量前缀，传空字符串表示读取全部变量，这样才能读到不带 `VITE_` 前缀的 `PROXY_TARGET`
- `process.cwd()` 在 `pnpm --filter @yzt/web dev` 下就是 `apps/web`，和 Vite 默认的 `envDir` 一致

### 代理

```ts
proxy: {
  [`${apiBaseUrl}/`]: {
    target: env.PROXY_TARGET,
    changeOrigin: true,
    rewrite: path => path.slice(apiBaseUrl.length)
  }
}
```

| 字段 | 说明 |
|---|---|
| 键 `/backend/` | 以它开头的请求才转发。带上结尾的 `/`，避免误匹配 `/backend-xxx` 这样的页面路径 |
| `target` | 后端地址 |
| `changeOrigin` | 把请求头中的 `Host` 改成目标地址，有些后端或网关会校验它 |
| `rewrite` | 去掉 `/backend` 前缀：`/backend/system/upms/user/detail` → `/system/upms/user/detail` |

`vite preview` 的 `preview.proxy` 默认沿用 `server.proxy`，所以 `PROXY_TARGET` 写在所有模式共用的 `.env` 里，而不是 `.env.development`，本地预览生产构建时也能连到后端。

已验证：通过开发服务器请求 `/backend/system/upms/user/detail`，后端返回 `{"code":401,"msg":"用户未登录"}`；和接口同名的页面路径 `/resource-management` 仍然返回页面。

## 修改时的检查清单

- 新增代理规则：同步更新 `docs/deployment.md` 中的 nginx 示例，保持开发和生产一致
- 新增插件：确认它不依赖 TS 的 JS API（ADR 0003），并在本文登记
- 改动路径别名：只改 tsconfig 的 `paths`，不要在这里加 `resolve.alias`
