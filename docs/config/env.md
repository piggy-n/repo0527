# 环境变量配置说明

对应文件：`apps/yzt/.env`、`apps/yzt/src/shared/config/`
相关决策：ADR 0008（接口走同源代理）、ADR 0031（天地图的开关与 key）、ADR 0032（内网的构建模式）、ADR 0140（偏好的开关）

全部配置（环境变量、代码里的产品开关、运行时文件、开发用的变量）的分类和新增开关放哪，见[配置总览](overview.md)。

## 文件与优先级

Vite 按运行模式加载 `apps/yzt` 下的 `.env` 文件，后者覆盖前者：

```
.env  <  .env.local  <  .env.[mode]  <  .env.[mode].local
```

| 文件 | 是否提交 | 用途 |
|---|---|---|
| `.env` | 提交 | 所有模式共用的变量，公网部署只用它 |
| `.env.intranet` | 提交 | 内网部署（`intranet` 模式）：`VITE_TIANDITU_ENABLED=false`，并用 `VITE_TIANDITU_KEY=` 清空继承的公网 key（ADR 0032） |
| `.env.local`、`.env.[mode].local` | 不提交（`.gitignore` 中的 `*.local`） | 个人临时覆盖，例如连接另一台后端 |
| `.env.development`、`.env.production` | 需要时再建 | 只在某个模式下不同的变量 |

`pnpm dev` 的模式是 `development`，`pnpm build` 和 `vite preview` 是 `production`，Vitest 是 `test`；内网的 `dev:intranet`、`build:intranet` 是 `intranet`。`vite build --mode intranet` 仍是生产构建（`import.meta.env.PROD` 为真），所以判断是不是生产构建用 `PROD` / `DEV`，不用 `MODE`。修改 `.env` 文件后，开发服务器会自动重启。

## 变量

| 变量 | 值 | 读取位置 | 说明 |
|---|---|---|---|
| `VITE_APP_TITLE` | `江苏省统一调查监测现状图` | `index.html`（`%VITE_APP_TITLE%`）、`appConfig.title` | 系统名称，只定义一次 |
| `VITE_API_BASE_URL` | `/backend` | `vite.config.ts`（代理前缀）、`appConfig.apiBaseUrl` | 接口基础地址 |
| `VITE_LOGIN_PUBLIC_KEY` | `04d2bf…fa83`（130 位） | `appConfig.loginPublicKey` | 登录密码加密用的 SM2 公钥，由后端提供（ADR 0015）。公钥本身是公开的，可以写进产物 |
| `VITE_TIANDITU_ENABLED` | `true` | `appConfig.tianditu` | 天地图开关（ADR 0031）。不能访问公网的内网部署设为 `false`，地图不再向天地图发任何请求，底图是本地数据画的静态底图和无底图（ADR 0133） |
| `VITE_TIANDITU_KEY` | `13745b…8974`（32 位） | `appConfig.tianditu.key` | 天地图的浏览器端 key，开启时必填，关闭时不读。它本来就写在每个瓦片地址里，防盗用靠天地图控制台的域名白名单和配额 |
| `PROXY_TARGET` | `http://192.168.1.180:18010` | 只在 `vite.config.ts` | 开发服务器与 `vite preview` 的代理目标 |
| `VITE_AI_API_BASE_URL` | `/ai-backend` | `vite.config.ts`（代理前缀）、`appConfig.aiApiBaseUrl` | AI 对话后端的基础地址。AI 后端是另一个服务（Bearer 鉴权、没有信封），同样走同源代理，见 [modules/ai-chat.md](../modules/ai-chat.md) |
| `AI_PROXY_TARGET` | `http://localhost:8090` | 只在 `vite.config.ts` | AI 后端的代理目标，沿用旧项目的本机开发地址，尚未联调 |
| `YZT_3DT_PROXY` | 不设 | `vite.config.ts` 和工具脚本 | 设了（如 `http://192.168.1.180:5173`）时开发服务器把 `/3dt/` 整个代理到那台服务器，本地的 `local/3dt/` 不再映射；在显卡机器上跑瓦片集的诊断页时用，`measure:3d`、`lcc2:register` 也从它取模型。这个示例地址上有 LCC2 模型和 `XZ_GC_3DT`，没有 JKQ、JKQ2。只在进程的环境变量里设，不写进 `.env`：工具脚本读不到 `.env`，写在 `.env.local` 里只对开发服务器生效（[local-files.md](local-files.md)） |
| `VITE_PAGE_STATE_RESET` | `true` | `appConfig.pageStateReset`、`AppLayout` | 离开页面后是否重置（ADR 0114，提交的取值见 ADR 0138）。`false` 时现状底图、指标 AI 计算切走再回来保留上次的状态；`true` 时不缓存页面，每次进入都是初始状态。只管页面缓存，偏好是否恢复看下面的开关（ADR 0140） |
| `VITE_PREFERENCES_ENABLED` | `true` | `appConfig.preferences`、`usePreference` | 偏好（IndexedDB）的总开关（ADR 0140）。`false` 时下面各项都不读不写，存下的数据保留，重新打开后还能恢复 |
| `VITE_PREFERENCE_BASEMAP` | `false` | 同上 | 底图和透明度（`basemap`）。`false` 时每次进入都是默认底图 |
| `VITE_PREFERENCE_BASEMAP_LABELS` | `true` | 同上 | 底图标注的显隐（`basemap-labels`，ADR 0146）。和底图、透明度分开，上一项关着也记住 |
| `VITE_PREFERENCE_BOUNDARIES` | `true` | 同上 | 行政区边界的级别和透明度（`boundaries`） |
| `VITE_PREFERENCE_RESOURCE_LAYERS` | `true` | 同上 | 资源图层的勾选、透明度、顺序和年份（`resource-layers`） |
| `VITE_PREFERENCE_RESOURCE_SYMBOLS` | `true` | 同上 | 资源图层的符号样式（`resource-symbols`） |
| `VITE_PREFERENCE_RESOURCE_PANEL` | `true` | 同上 | 资源图层面板的收起和高度比例（`resource-panel`） |
| `VITE_RESOURCE_MIN_ZOOM_ENABLED` | `false` | `appConfig.resourceMinZoomEnabled`、`fetchResourceMinZooms`、`builtInMinZooms` | 资源的最小显示级别（ADR 0132、0137）。`true` 时按发布目录的 `resource-min-zooms.json` 限制（读不到时用构建带上的那份），没到层级不请求瓦片、提示放大到几级；`false` 时不读文件、不限制，各级都请求瓦片，低级别的瓦片可能有十几 MB。**现在暂时关着：** 用户 2026-11-04 确定先不打开（`88c4a99` 改成 `false`），层级表和部署的文件都不生效；层级表和实测的瓦片大小也还对不上（水域面层不在表里，永久基本农田图斑的 8 级偏低）。打开前按 [backlog](../backlog.md)"最小显示级别"两条重测层级，再在真实后端上换一次文件确认 |
| `VITE_MAP_3D_ENGINE` | `maplibre` | `appConfig.map3dEngine`、`app/map-runtime-provider.ts`、`vite.config.ts` | 三维引擎（ADR 0147、0150）。`cesium` 是可选的 Cesium，三维是另一块画布；`maplibre`（默认）是 MapLibre + Three.js，二三维共用 MapLibre 的画布和视图（地球投影、三维里的覆盖物和测量、三维模型、地下、漫游和缓存；资源图层和三维里的点/框选由 `shared/config/scene-options.ts` 的开关关着，开关只在代码里改，不进 `.env`，见 [map-three.md](../modules/map-three.md)）。app 按它把引擎的描述注入地图（`MAP_SCENE_ENGINE`），页面不判断它；构建时只在 `cesium` 时复制 Cesium 的运行时文件到 `cesium/`（约 7 MB）。换引擎要重新构建；公网、内网要不同时写在 `.env.intranet` |

## 两类变量

**`VITE_` 开头的变量会暴露给前端代码。** 构建时，`import.meta.env.VITE_X` 被替换成字符串常量，直接写进产物。所以：

- 不能在 `VITE_` 变量里放密钥、口令，任何人都能在浏览器里看到
- 改值后要重新构建，部署后不能再改

**不带前缀的变量只在 `vite.config.ts` 里可用。** 通过 `loadEnv(mode, process.cwd(), '')` 读取（第三个参数为空字符串表示读取全部变量）。`PROXY_TARGET`、`AI_PROXY_TARGET` 属于这一类，已验证产物中不包含 `PROXY_TARGET` 的值。

## 类型与校验

`shared/config/import-meta-env.ts` 声明变量的类型：

- 用 `declare global { interface ImportMetaEnv {...} }`：tsconfig 的 `moduleDetection: force` 让这个 `.ts` 文件按模块处理，直接写 `interface ImportMetaEnv` 只在文件内部生效
- 开启 `ViteTypeOptions.strictImportMetaEnv`：Vite 8 的 `ImportMetaEnv` 默认继承 `Record<string, any>`，拼错的变量名（如 `VITE_APP_TITEL`）不报错，类型还是 `any`。开启后，没有声明的变量名会报错（已用探针和对照组验证）
- 变量声明为可选（`?: string`），因为 `.env` 文件里确实可能漏写

`shared/config/app-config.ts` 集中读取并校验：缺失或为空时，在启动时抛出"缺少环境变量 XXX"，不带着空值继续运行（已验证）。其他代码只使用 `appConfig`。

有固定格式的变量还会校验格式。`VITE_LOGIN_PUBLIC_KEY` 必须是 `04` 开头、共 130 位的十六进制（未压缩格式的 SM2 公钥），复制时少了字符会在启动时报错，而不是等到登录时才失败（已验证）。天地图开启时，`VITE_TIANDITU_KEY` 必须是 32 位十六进制。

取值固定的变量也在启动时校验：`VITE_MAP_3D_ENGINE` 只能是 `cesium` 或 `maplibre`。

开关类变量（如 `VITE_TIANDITU_ENABLED`）只接受小写的 `true`、`false`，其他值（`TRUE`、`1`、`yes`）在启动时报错，不按"非空即真"处理：`.env` 里的值都是字符串，`'false'` 也是非空的。

**几个变量合成一个值**：天地图的开关和 key 在 `appConfig` 里合成 `tianditu: { key } | null`，关闭时为 `null`。"开启了却没有 key"在类型上不存在，使用方拿到 `null` 时必须处理天地图不可用的情况（内网部署），不用在每条调用路径上各写一次开关判断。公网和内网各用一套构建命令（ADR 0032）：内网用 `intranet` 模式，由 `.env.intranet` 覆盖开关；代码只读 `appConfig`，不判断模式名。

关闭天地图并不自动删除传给配置函数的 key 字面量，所以内网配置要显式清空 key。构建插件会拒绝“关闭但 key 非空”的有效配置，并检查产物不含公网配置的 key；更高优先级的个人配置或进程环境变量也受检查。通用底图代码仍保留未调用的地址模板，不会因此发出请求。

偏好的总开关和分项开关同样合成一个值：`appConfig.preferences` 按偏好的名称给出生效值，两个开关都为 `true` 才是 `true`。总开关关闭时分项开关照样校验，拼错的值不等到打开时才报错（ADR 0140）。

例外：Vite 内置的 `DEV`、`PROD`、`MODE`、`BASE_URL` 直接读取 `import.meta.env`。例如路由表在定义整个开发路由数组时判断 `import.meta.env.DEV`，让生产构建同时删除开发路由和动态导入，产物检查保证不残留开发页。

## 不放进 `.env` 的变量

`YZT_LOCAL_DIR`（未入库的本地文件放在哪里）只从进程的环境变量读：工具脚本由 Node 直接运行，读不到 `.env`，写在 `.env.local` 里会只对开发服务器生效。见 [local-files.md](local-files.md)。

## 修改时的检查清单

- 新增变量：先想清楚它会不会写进产物（`VITE_` 前缀）；在 `import-meta-env.ts` 中声明类型，在 `app-config.ts` 中读取和校验；更新本文的变量表
- 新增后端（如文件管理使用的其他后端）：按 ADR 0008 增加新的前缀变量和 `vite.config.ts` 中的代理规则，并更新 `docs/deployment.md` 的 nginx 示例；AI 对话已按这个做法加了 `VITE_AI_API_BASE_URL` 和 `AI_PROXY_TARGET`
