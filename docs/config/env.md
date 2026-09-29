# 环境变量配置说明

对应文件：`apps/web/.env`、`apps/web/src/shared/config/`
相关决策：ADR 0008（接口走同源代理）

## 文件与优先级

Vite 按运行模式加载 `apps/web` 下的 `.env` 文件，后者覆盖前者：

```
.env  <  .env.local  <  .env.[mode]  <  .env.[mode].local
```

| 文件 | 是否提交 | 用途 |
|---|---|---|
| `.env` | 提交 | 所有模式共用的变量，目前全部变量都在这里 |
| `.env.local`、`.env.[mode].local` | 不提交（`.gitignore` 中的 `*.local`） | 个人临时覆盖，例如连接另一台后端 |
| `.env.development`、`.env.production` | 需要时再建 | 只在某个模式下不同的变量 |

`pnpm dev` 的模式是 `development`，`pnpm build` 和 `vite preview` 是 `production`，以后 Vitest 是 `test`。修改 `.env` 文件后，开发服务器会自动重启。

## 变量

| 变量 | 值 | 读取位置 | 说明 |
|---|---|---|---|
| `VITE_APP_TITLE` | `江苏省统一调查监测现状图` | `index.html`（`%VITE_APP_TITLE%`）、`appConfig.title` | 系统名称，只定义一次 |
| `VITE_API_BASE_URL` | `/backend` | `vite.config.ts`（代理前缀）、`appConfig.apiBaseUrl` | 接口基础地址 |
| `PROXY_TARGET` | `http://192.168.1.180:18010` | 只在 `vite.config.ts` | 开发服务器与 `vite preview` 的代理目标 |

## 两类变量

**`VITE_` 开头的变量会暴露给前端代码。** 构建时，`import.meta.env.VITE_X` 被替换成字符串常量，直接写进产物。所以：

- 不能在 `VITE_` 变量里放密钥、口令，任何人都能在浏览器里看到
- 改值后要重新构建，部署后不能再改

**不带前缀的变量只在 `vite.config.ts` 里可用。** 通过 `loadEnv(mode, process.cwd(), '')` 读取（第三个参数为空字符串表示读取全部变量）。`PROXY_TARGET` 属于这一类，已验证产物中不包含它的值。

## 类型与校验

`shared/config/import-meta-env.ts` 声明变量的类型：

- 用 `declare global { interface ImportMetaEnv {...} }`：tsconfig 的 `moduleDetection: force` 让这个 `.ts` 文件按模块处理，直接写 `interface ImportMetaEnv` 只在文件内部生效
- 开启 `ViteTypeOptions.strictImportMetaEnv`：Vite 8 的 `ImportMetaEnv` 默认继承 `Record<string, any>`，拼错的变量名（如 `VITE_APP_TITEL`）不报错，类型还是 `any`。开启后，没有声明的变量名会报错（已用探针和对照组验证）
- 变量声明为可选（`?: string`），因为 `.env` 文件里确实可能漏写

`shared/config/app-config.ts` 集中读取并校验：缺失或为空时，在启动时抛出"缺少环境变量 XXX"，不带着空值继续运行（已验证）。其他代码只使用 `appConfig`。

例外：Vite 内置的 `DEV`、`PROD`、`MODE`、`BASE_URL` 直接读取 `import.meta.env`。例如路由表靠 `import.meta.env.DEV` 的静态替换，在生产构建中删除开发路由。

## 修改时的检查清单

- 新增变量：先想清楚它会不会写进产物（`VITE_` 前缀）；在 `import-meta-env.ts` 中声明类型，在 `app-config.ts` 中读取和校验；更新本文的变量表
- 新增后端（如 AI 对话、文件管理使用的其他后端）：按 ADR 0008 增加新的前缀变量和 `vite.config.ts` 中的代理规则，并更新 `docs/deployment.md` 的 nginx 示例
