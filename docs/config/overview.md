# 配置总览

项目里能调的东西分四类，区别在于谁来改、改完怎么生效。想改某个行为时，先在这里找到它属于哪一类，再看对应的文档。

## 四类配置

| 类别 | 放在哪 | 谁改 | 怎么生效 | 详细说明 |
|---|---|---|---|---|
| 构建时的环境变量 | `apps/yzt/.env`，内网的差异写在 `.env.intranet`；只在 `shared/config/app-config.ts` 读取和校验 | 部署方，按部署环境取值 | 重新构建 | [env.md](env.md) |
| 代码里的产品开关 | `apps/yzt/src/shared/config/*-options.ts` | 开发者，按产品决定 | 改代码、提交、重新构建 | 本页"代码里的产品开关" |
| 运行时文件 | 发布目录里的 JSON | 运维 | 替换文件，用户刷新页面 | [deployment.md](../deployment.md) |
| 开发和工具用的环境变量 | `.env` 里不带 `VITE_` 的项，或进程环境变量 | 开发者，只影响本机 | 重启开发服务器或工具 | [env.md](env.md)"不放进 `.env` 的变量"、[local-files.md](local-files.md) |

用户偏好不是配置：它是存在 IndexedDB 里的用户数据（`shared/storage`）。哪些偏好会被存下来，由下面的 `VITE_PREFERENCE_*` 决定（ADR 0140）。

## 构建时的环境变量

取值和逐项说明见 [env.md](env.md)，这里只按用途分组：

| 用途 | 变量 | ADR |
|---|---|---|
| 部署地址与密钥 | `VITE_APP_TITLE`、`VITE_API_BASE_URL`、`VITE_AI_API_BASE_URL`、`VITE_LOGIN_PUBLIC_KEY` | 0008、0015 |
| 天地图（内网关闭） | `VITE_TIANDITU_ENABLED`、`VITE_TIANDITU_KEY` | 0031、0032 |
| 离开页面后是否重置 | `VITE_PAGE_STATE_RESET` | 0114、0138 |
| 偏好存哪些 | `VITE_PREFERENCES_ENABLED`（总开关）和 6 个 `VITE_PREFERENCE_*`（分项） | 0140 |
| 资源的最小显示级别 | `VITE_RESOURCE_MIN_ZOOM_ENABLED` | 0132、0137 |
| 三维引擎 | `VITE_MAP_3D_ENGINE`（`cesium` / `maplibre`） | 0147 |

## 代码里的产品开关

所有部署都一样的产品决定，以后可能会改，所以做成开关。只在代码里改，不进 `.env`。

| 开关 | 文件 | 默认 | 作用 | ADR |
|---|---|---|---|---|
| `STATIC_BASEMAP_OPTIONS.cityColors` | `shared/config/static-basemap-options.ts` | `false` | 静态底图各市分色；关着时全省同一种陆地色。改了要运行 `basemap:generate` 更新缩略图 | 0134、0146 |
| `SCENE_OPTIONS.resourceLayers` | `shared/config/scene-options.ts` | `false` | `maplibre` 引擎的三维里显示资源图层、点/框选能识别；关着时和 Cesium 一样。放开前要先改页面设计 | 0147 |

这类文件只写类型和常量，不导入别的模块：Node 直接运行的工具也会导入它们（`basemap:generate` 读分色开关），读不了 Vite 专用的写法。

## 运行时文件

随构建复制到发布目录，部署后可以直接替换，不用重新构建。每次发布 `dist` 会整体替换，确定下来的值要同步回仓库。

| 文件 | 发布位置 | 仓库里的来源 | 作用 | ADR |
|---|---|---|---|---|
| 三维模型清单 | `dist/3dt/manifest.json` | `apps/yzt/public/3dt/manifest.json` | 三维模型面板列出哪些模型、在哪个市、什么类型；格式由代码里的 zod 校验，逐项说明见 [3dt-manifest.md](3dt-manifest.md) | 0081、0149 |
| 资源的最小显示级别 | `dist/resource-min-zooms.json` | `apps/yzt/src/features/resource-map/resource-min-zooms.json` | 每个资源放大到几级才显示；读不到或格式不对时用构建时带上的，`VITE_RESOURCE_MIN_ZOOM_ENABLED=false` 时不读 | 0132、0137 |

## 开发和工具用的环境变量

| 变量 | 在哪设 | 作用 |
|---|---|---|
| `PROXY_TARGET`、`AI_PROXY_TARGET` | `.env`（不带 `VITE_`，不进产物） | 开发服务器和 `vite preview` 的接口代理目标 |
| `YZT_LOCAL_DIR` | 进程环境变量 | 未入库的本地文件放在哪里（ADR 0141） |
| `YZT_3DT_PROXY` | 进程环境变量 | 开发服务器把 `/3dt/` 整个代理到别的服务器，用来看服务器上的大模型 |

## 新增一个开关时放哪

按下面的顺序判断，第一个符合的就是它的类别：

1. **不同部署环境要取不同的值**（地址、密钥、内网和公网的差异、某个部署要关掉的功能）：构建时的环境变量。写进 `.env`，内网的差异写进 `.env.intranet`；在 `app-config.ts` 读取和校验，在 `import-meta-env.ts` 声明类型，在 [env.md](env.md) 加一行。
2. **所有部署都一样的产品决定，只是以后可能改**：代码里的产品开关。新建或扩充 `shared/config/<主题>-options.ts`，导出接口和常量，在本页登记一行。
3. **部署以后要由运维调整、不想重新构建的数据**：运行时文件。写清楚格式、校验，以及读不到时退回什么（参照最小显示级别），写进 [deployment.md](../deployment.md) 和本页。
4. **只影响本机开发或工具**：不带 `VITE_` 的变量或进程环境变量，写进 [env.md](env.md)"不放进 `.env` 的变量"。

不在页面、feature 或包里散放开关常量；包里只放和项目无关的默认行为，项目的决定由 app 注入（例如三维引擎的能力由 app 按 `SCENE_OPTIONS` 收窄）。
