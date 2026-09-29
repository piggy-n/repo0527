# vite.config.ts 配置说明

对应文件：`apps/web/vite.config.ts`
相关决策：ADR 0001（TSX）、ADR 0008（接口同源代理）、ADR 0010（测试）

## 整体结构

配置导出的是一个函数 `defineConfig(({ mode }) => ({ ... }))`，而不是对象。因为代理配置要读取 `.env` 中的变量，而读取哪些文件取决于运行模式（`development` / `production` / `test`）。

`defineConfig` 从 `vitest/config` 导入，而不是从 `vite`。两者是同一个函数，前者的类型多了 `test` 字段。这样开发、构建、测试共用一份配置，插件、别名、`.env` 只写一次。

## 各项配置

| 配置 | 值 | 说明 |
|---|---|---|
| `plugins` | `vueJsx()`、`systemTitlePlugin()` | 前者用 Babel 编译 Vue 的 TSX（ADR 0001）；后者按 `VITE_APP_TITLE` 同步系统名称的 SVG 轮廓，测试模式下不启用（ADR 0012，见 [modules/system-title.md](../modules/system-title.md)） |
| `resolve.tsconfigPaths` | `true` | 直接读取 tsconfig 的 `paths`，路径别名只在一处定义 |
| `server.proxy` | `/backend/` → `PROXY_TARGET` | 同源代理，见下文 |
| `test` | 见下文 | Vitest 的配置（ADR 0010） |

### 系统名称插件

```ts
...(mode === 'test' ? [] : [systemTitlePlugin({ text: env.VITE_APP_TITLE, ...systemTitlePaths(process.cwd()) })])
```

- 在 `buildStart` 钩子中运行：开发服务器启动时、构建开始时各一次。修改 `.env` 后开发服务器会自动重启，所以改名称后轮廓会自动更新
- 测试模式（`mode === 'test'`，即 Vitest）下不加入插件：测试检查已提交的结果，不在运行时改动源文件
- 插件文件从 `./tools/system-title/vite-plugin.ts` 导入，带 `.ts` 扩展名，因为同一份代码也由 Node 直接运行

### 测试

| 字段 | 值 | 说明 |
|---|---|---|
| `include` | `['src/**/*.test.{ts,tsx}']` | 测试文件和源文件放在一起 |
| `environment` | `'jsdom'` | 在 Node 里模拟 DOM，挂载组件用 |
| `unstubEnvs` | `true` | 每个用例结束后撤销 `vi.stubEnv`。已用对照实验验证：关掉后，一个用例修改的环境变量会泄漏到下一个用例 |

没有开启 `globals`，测试文件显式导入 `describe`、`it`、`expect`，和 AGENTS.md"不使用自动导入"一致。Vitest 5 默认开启 `clearMocks`，每个用例之间会清空 mock 的调用记录。

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
- 新增插件：确认它不依赖 TS 的 JS API（ADR 0003），并在本文登记；插件对测试同样生效，改完运行 `pnpm test`
- 改动路径别名：只改 tsconfig 的 `paths`，不要在这里加 `resolve.alias`
