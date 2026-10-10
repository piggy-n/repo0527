# 环境变量配置说明

对应文件：`apps/web/.env`、`apps/web/src/shared/config/`
相关决策：ADR 0008（接口走同源代理）、ADR 0031（天地图的开关与 key）、ADR 0032（内网的构建模式）

## 文件与优先级

Vite 按运行模式加载 `apps/web` 下的 `.env` 文件，后者覆盖前者：

```
.env  <  .env.local  <  .env.[mode]  <  .env.[mode].local
```

| 文件 | 是否提交 | 用途 |
|---|---|---|
| `.env` | 提交 | 所有模式共用的变量，公网部署只用它 |
| `.env.intranet` | 提交 | 内网部署（`intranet` 模式）与公网不同的变量，目前只有 `VITE_TIANDITU_ENABLED=false`（ADR 0032） |
| `.env.local`、`.env.[mode].local` | 不提交（`.gitignore` 中的 `*.local`） | 个人临时覆盖，例如连接另一台后端 |
| `.env.development`、`.env.production` | 需要时再建 | 只在某个模式下不同的变量 |

`pnpm dev` 的模式是 `development`，`pnpm build` 和 `vite preview` 是 `production`，Vitest 是 `test`；内网的 `dev:intranet`、`build:intranet` 是 `intranet`。`vite build --mode intranet` 仍是生产构建（`import.meta.env.PROD` 为真），所以判断是不是生产构建用 `PROD` / `DEV`，不用 `MODE`。修改 `.env` 文件后，开发服务器会自动重启。

## 变量

| 变量 | 值 | 读取位置 | 说明 |
|---|---|---|---|
| `VITE_APP_TITLE` | `江苏省统一调查监测现状图` | `index.html`（`%VITE_APP_TITLE%`）、`appConfig.title` | 系统名称，只定义一次 |
| `VITE_API_BASE_URL` | `/backend` | `vite.config.ts`（代理前缀）、`appConfig.apiBaseUrl` | 接口基础地址 |
| `VITE_LOGIN_PUBLIC_KEY` | `04d2bf…fa83`（130 位） | `appConfig.loginPublicKey` | 登录密码加密用的 SM2 公钥，由后端提供（ADR 0015）。公钥本身是公开的，可以写进产物 |
| `VITE_TIANDITU_ENABLED` | `true` | `appConfig.tianditu` | 天地图开关（ADR 0031）。不能访问公网的内网部署设为 `false`，地图不再向天地图发任何请求 |
| `VITE_TIANDITU_KEY` | `13745b…8974`（32 位） | `appConfig.tianditu.key` | 天地图的浏览器端 key，开启时必填，关闭时不读。它本来就写在每个瓦片地址里，防盗用靠天地图控制台的域名白名单和配额 |
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

有固定格式的变量还会校验格式。`VITE_LOGIN_PUBLIC_KEY` 必须是 `04` 开头、共 130 位的十六进制（未压缩格式的 SM2 公钥），复制时少了字符会在启动时报错，而不是等到登录时才失败（已验证）。天地图开启时，`VITE_TIANDITU_KEY` 必须是 32 位十六进制。

开关类变量（如 `VITE_TIANDITU_ENABLED`）只接受小写的 `true`、`false`，其他值（`TRUE`、`1`、`yes`）在启动时报错，不按"非空即真"处理：`.env` 里的值都是字符串，`'false'` 也是非空的。

**几个变量合成一个值**：天地图的开关和 key 在 `appConfig` 里合成 `tianditu: { key } | null`，关闭时为 `null`。"开启了却没有 key"在类型上不存在，使用方拿到 `null` 时必须处理天地图不可用的情况（内网部署），不用在每条调用路径上各写一次开关判断。公网和内网各用一套构建命令（ADR 0032）：内网用 `intranet` 模式，由 `.env.intranet` 覆盖开关；代码只读 `appConfig`，不判断模式名。

例外：Vite 内置的 `DEV`、`PROD`、`MODE`、`BASE_URL` 直接读取 `import.meta.env`。例如路由表靠 `import.meta.env.DEV` 的静态替换，在生产构建中删除开发路由。

## 修改时的检查清单

- 新增变量：先想清楚它会不会写进产物（`VITE_` 前缀）；在 `import-meta-env.ts` 中声明类型，在 `app-config.ts` 中读取和校验；更新本文的变量表
- 新增后端（如 AI 对话、文件管理使用的其他后端）：按 ADR 0008 增加新的前缀变量和 `vite.config.ts` 中的代理规则，并更新 `docs/deployment.md` 的 nginx 示例
