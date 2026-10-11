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
| 登录与鉴权 | `836f03b` | `src/views/login/`、`src/services/auth/auth-service.js`、`src/stores/user.js`、`src/utils/func-crypto.js`（`encryptPassword`）、`src/api/sys/sys-uaa-auth-api.js`、`src/router/index.js`（路由守卫）、`src/libs/http-service.js`（token 请求头与 401） | `shared/auth`、`features/auth`、`pages/login`、`app/router`、`app/http.ts` | 已完成登录、会话、路由权限、退出（阶段二）；AI 后端登录待迁移 AI 对话时处理 |
| 文件管理 | `836f03b` | `src/views/resource-center/file-management.vue`、`src/views/resource-center/components/` 下的 `FileManagement*.vue`、`DeleteFileManagementDialog.vue`、`UploadFileManagementDialog.vue`、`DocxPreviewDialog.vue`；`src/mock/file-management-data.js`（分类树与业务类型标签，是写死的业务配置，不是 mockjs）；`src/api/resource/resource-api.js` 中的 `/file/*` | `features/file-management`、`pages/file-management`、`shared/query-form`、`shared/table` | 列表已完成（阶段三 3.3）：分类树、筛选、表格、分页、删除；"上传文档"按钮只占了位置；上传、下载、预览在阶段六 |
| 地图内核 | `836f03b` | `src/components/CommonMap/`（二维：引擎、`MapService`、各 Manager、点选、测量、绘制）；`src/views/current-map-new/cesium/`（三维）、`src/views/current-map-new/composables/useEngineSwitch.js`（二三维切换与同步）；`src/libs/bus.js`（全局事件总线） | `libs/map-core`、`libs/utils`（Worker 通信层）；三维将来在 `libs/map-cesium` | 阶段四：按新设计（ADR 0020～0025）实现了地图会话（样式、相机）、MapLibre 适配器和 Worker 通信层，在 `/dev/map` 上验证；旧代码的分析见 [modules/map-core.md](modules/map-core.md) 附录。业务图层、点选、测量、绘制、三维还没有迁移（阶段五、六）。阶段四结束时 `master-demo` 仍是 `836f03b` |
| 现状底图与公共地图能力 | `836f03b` | `src/views/current-map-new/`（页面、图层面板、地图控制栏、图例、详情面板；`cesium/` 与 `composables/useEngineSwitch.js` 归三维阶段）；`src/components/CommonMap/`（`MapContainer`、`MapService` 与底图、边界、业务图层、测量、点选、绘制、符号与地类配色）；`src/assets/LayerManager.ts`；`src/services/map-tree/`（图层树接口、规范化、样式登记表、静态节点）；`src/stores/mapTree.js`；`src/components/toolbar/`（工具栏、区划定位面板）；`src/components/map/map-configs.js`；`src/api/resource/resource-map-api.js`；`src/views/current-map/utils/MapStaticBoundaryManager.js` | `libs/map-vue`、`shared/map`、`features/*`、`pages/current-map`（分层在 5A.1 的 ADR 中确定） | 5A 完成：map-vue（`provideMap`、样式绑定、`MapCanvas`、`useMap`、定位可视区域、失败提示）与现状底图的联调骨架，旧代码还没有迁移；底图、边界、工具在 5B，资源图层、面板、图例、点选在 5C，界面在 5D。5A 结束时 `master-demo` 仍是 `836f03b`。不迁移：接口失败时回退的本地快照 `src/assets/tree-data.ts`、三区三线的占位节点。5B.1 完成：底图（`BaseLayerManager`、`MapControlBar` 的底图部分、提交 `d768c66` 的天地图开关）迁到 `shared/map/basemap`，矢量、影像都用天地图（ADR 0031），内网部署用 `pnpm build:intranet`（ADR 0032）；不迁移 `static-nodes.js` 里的内网影像（`192.168.1.180:8080`）和没用到的 `osm-tiles` 数据源。5B.2 完成：省、市、县界（`BoundaryManager` 的静态边界、`MapStaticBoundaryManager`、`TiandituBoundaryLayer` 的画线部分、`MapControlBar` 的行政区部分）与默认视角（`MapViewManager.goToDefaultView`）迁到 `shared/map`（ADR 0033）；边界数据由转换脚本从 `public/static/geojson` 生成。区划定位、区划高亮、天地图行政区接口在 5B.5，区划裁剪在 5C.7。5B.3 完成：工具栏的工具切换（`components/toolbar/index.vue` 的分组与 `navigationMode`、`MapService.handleToolbarAction`、`SelectionInteractionController` 的模式）改为会话的工具模型（ADR 0034），工具栏外壳在 `shared/map/toolbar`；点选、框选在 5C.6，测距、测面在 5B.4。5B.4 完成：测距、测面、清除（`MeasureManager`、`MapDistanceMeasureManager`、`MapAreaMeasureManager` 和 `GeometryDrawManager` 中测量用到的部分）迁到 map-core 的 `MeasureStore` 与 `shared/map/measure`（ADR 0035）；距离和面积从 turf 的球面计算改为椭球面计算，单位格式和提示文案照旧；`GeometryDrawManager` 的通用绘制等阶段六的空间查询再看能否抽成通用的绘制工具。5B.5 完成：区划定位（`RegionLocatePanel.vue`、`MapService.selectRegion`、`BoundaryManager` 与 `MapRegionBoundaryManager` 的选区边界和定位）迁到 `shared/map/region`（ADR 0036）；区划目录由 `regionLabelPoints.ts` 转换，不用 `region.js`（8 个区县的代码写错）；边界只用本地的市界、县界。不迁移：天地图行政区接口（`TiandituBoundaryLayer` 的请求部分，本地数据完整时用不到）、选中区划的名称标签（效果一般，以后在 5D 重新设计）、`DEFAULT_FIT_BOUNDS_OPTIONS` 写死的 96 像素留白（改由登记的悬浮元素决定）。区划裁剪（`MapRegionClipManager`、`MapRegionLayerFilter`）在 5C.7；坐标定位在旧项目里只是占位按钮，新做在 5B.6。5B.6 完成：坐标定位与位置点是新功能（ADR 0037），没有旧代码可迁移，交互先在原型里和用户确认（长按 0.5 秒、"坐标定位点"、拾取后打开位置信息、至少 14 级、复制用规范的 `′″`、"清除"连同位置点、所在区划用县界判断、两个定位面板互斥）。5B 结束时 `master-demo` 仍是 `836f03b`。5C.1d 完成：资源树接口、目录、样式登记表（`services/map-tree/` 的规范化、`layer-style-registry.js`、`source-layer-exceptions.js`）与地类配色（`landuseClassification.js` 的编码表、历史名称表）迁到 `features/resource-map`，差异见"现状底图：资源图层的样式数据"。5C.1e 完成：显示状态、分组推导与校验（`DataTree.vue` 的勾选、`LayerManager.ts` 和 `BusinessLayerManager` 的建层部分）改为拥有者 `useResourceLayers` 与纯函数（ADR 0041）；现状底图先用临时的勾选列表联调，图层面板在 5C.2。5C.2 完成：图层面板（`LayerPanel.vue` 的目录树、勾选、搜索、透明度、排序、收起）迁到 `features/resource-map` 的 `ResourceLayerPanel`，差异见"现状底图：图层面板与旧页面的差异"。5C.3 完成：图层排序的持久化（`LayerPanel.vue` 的 `loadStoredLayerOrder`、`saveStoredLayerOrder`）改为 `shared/storage` 的偏好（ADR 0042）：存在 IndexedDB、按登录名区分，资源图层的勾选、透明度、顺序、年份和底图、边界都记住；旧的 localStorage 键不迁移（只有同级排序，和新的顺序模型对不上）。地类配色和符号的覆盖在 5C.5。5C.4 完成：只读图例（`MapLegendPanel`、`LanduseLegendSection`、`LayerLegendGroup`、`LayerLegendPreview` 的显示部分，`landuseClassification.js` 的表 A.1 分组与地类含义）迁到 `features/resource-map` 的 `ResourceLegend`（ADR 0043）；不迁移"当前出现的地类"统计（`requestPresence`、`discoverLanduseTypes`）和运行时的几何类型识别；调色、恢复默认在 5C.5。5C.5a 完成：统一符号的编辑（`LayerSymbolEditor`、`LayerSymbolStyleManager` 和 `layerSymbolModel.js` 中统一符号的部分，`MapLegendPanel` 的"全部恢复默认"）迁到 `features/resource-map` 的 `symbols.ts`、`useResourceSymbols`、`SymbolEditor`（ADR 0044），差异见"现状底图：符号编辑与旧页面的差异"；分类样式在 5C.5b，面的描边宽度、线型、纹理在 5C.5c |
| 布局（顶部导航、用户菜单） | `836f03b` | `src/layout/components/TheHeader.vue`、`src/services/resource-application/roleService.js`（`getHeaderMenus`、`getRoleLabel`） | `app/layout` | 已完成导航与退出登录（阶段二 2.10）；修改密码、修改头像、消息铃铛待迁移对应功能时处理 |

## 文件管理：接口实测（2026-10-08）

用浏览器中已登录的会话直接请求后端，按实测结果写 zod schema 和联动规则（`features/file-management/api.ts`、`composables/useFileList.ts`），不照搬旧代码的兜底判断。

**`GET /file/page`**（参数 `categoryId`、`pageNo`、`pageSize`，可选 `name`、`year`、`tag`）

- 外壳 `{ code: 200, msg, success, data }`；`data` 是 Spring Data 的分页结构：`content`、`pageNo`、`pageSize`、`totalElements`、`totalPages`，另有 `hasNextPage` 等用不到的字段
- 记录的 13 个字段每条都有：只有 `remark` 会是 `null`，`bucket` 总是 `null`；`type` 是小写扩展名，与 `name` 的后缀一致（旧代码兼容的 MIME 写法没有出现）；`year` 是字符串，`size` 是字节数，`createdTime` 是 `YYYY-MM-DD HH:mm:ss`
- `name` 模糊匹配，后端不去掉首尾空格（`' 政区 '` 查不到）；空字符串的条件等同于不筛选
- 页码越界（大于 `totalPages`）时返回最后一页的数据，但 `pageNo` 原样返回；`pageNo=0` 按第 1 页处理
- 缺少 `categoryId`：HTTP 400，`{ code: 400, msg: '请求参数缺失:categoryId' }`
- 不校验 token：token 无效或不带 token 都返回数据（已告知，属于后端问题，见 [modules/auth.md](modules/auth.md) 的"会话结束的统一处理"）

**`GET /file/delete?id=`**

- 成功：`{ code: 200, data: null, msg: '删除成功', success: true }`
- 文件不存在：HTTP 200，`{ code: 40000, data: null, msg: '文件不存在', success: false }`，由 `shared/http` 作为业务错误抛出并提示

当时全部 15 个分类共 5 条数据，都在"自然资源调查类"下；样本少，所以 schema 按字段语义声明（例如 `remark` 可为 `null`），没有为样本里没出现的情况加兜底。

## 文件管理：与旧页面的差异

按 3.3 验收时的反馈和新架构的规则，与旧页面有意不同的地方：

| 方面 | 旧页面 | 新页面 |
|---|---|---|
| 筛选栏 | `<label>` 包住控件，标签长短不一，控件宽度不一 | `QueryForm`：控件等宽；放得下一行时紧凑排列，换行时标签统一宽度并两端对齐；修复了点标签清除图标时下拉框展开的问题 |
| 条件没变时点"查询" | 每次都请求 | 同样每次都请求（Vue Query 的查询键不变时不会自动请求，所以主动 `refetch`） |
| 加载状态 | 每次请求都显示遮罩 | 首次加载显示骨架屏，翻页、换条件时在旧数据上显示遮罩，切回看过的分类直接显示缓存（见 [modules/table.md](modules/table.md)） |
| 空值 | 留空 | 显示 `-`（全局表格样式） |
| 左侧目录 | 固定在左侧 | 窄屏（< 1200）收成左侧窄条，点开抽屉 |
| 树 | 所有节点同一字重 | 分组加粗，子级有层级引导线 |
| 页码越界 | 后端返回最后一页的数据，页码不变 | 改到最后一页（例如删掉最后一页的最后一条）；只按请求成功返回的结果修正，跳回缓存过的页、请求失败时都不按旧缓存修正 |
| 登录过期 | 发请求前检查 | 同样检查（`/file/page` 不校验 token），并由会话结束的统一处理清空缓存 |
| 删除 | 确认后直接删除；单个删除状态 | 页面销毁时关闭打开的确认框；确认后页面已销毁或会话已变化时不删除；按文件 ID 记录删除中的状态，删除 A 未完成时删除 B，A 仍显示删除中、不能重复删除 |
| 翻页失败 | — | 停在当前页并显示"加载失败"，总数沿用已知的值（最近一次成功的，或重新进入列表时缓存里的），不会跳回第 1 页 |
| 名称框按回车 | — | 输入法选字时的回车不触发查询 |

## 现状底图：接口实测（2026-10-09）

用浏览器中已登录的会话，经开发服务器的 `/backend` 代理直接请求后端，作为 5C.1 写 zod schema 和规范化的依据。旧代码注释里的数字（2026-08-25：167 条记录、64 个图层）已经过时。

**`GET /resource-map/base/tree`**

- 外壳 `{ code: 200, msg, success, data }`，`data` 是数组
- 顶层 4 个分组：基础库、公共库、主题库（`code` 为 `null`）、三区三线（`code: 'sqsx'`）
- 分类节点都带 `children` 数组，图层节点不带 `children`，用"有没有 `children` 键"就能区分，不用猜：
  - 基础库下有"土地资源""水资源""荒漠"三个有内容的分类，另有 12 个空分类（`children: []`，没有 `geoType`、`resource`、`yearList`，`code` 有的是字符串、有的是 `null`）
  - 三区三线下直接是 4 个图层（深度 1）：城镇开发边界、耕地补划目标、保护红线、永久基本农田，年份都是 2026。旧代码里"子节点还没下发"的占位已经过时
- 图层节点 5 个字段每条都有：`code`、`name`、`geoType`（`Polygon` 54 个、`Line` 11 个、`Point` 13 个）、`resource`（所属分类名）、`yearList`（数字数组，升序，不为空）
- **后端仍按"图层 × 年份"逐条返回**：183 条图层记录，按 `code` 去重后 78 个图层；每个图层重复的次数正好等于它的年份数，重复的记录完全相同，同一个 `code` 不会出现在两个分类下
- 年份：38 个图层只有 1 年，5 个 2 年，5 个 3 年，30 个 4 年；出现的年份是 2021～2026。地类图斑（`bgdc_dltb`）只有 2022；地类图斑变化面、线、点层有多个年份

**`GET /api/tiles/{code}_{year}/{z}/{x}/{y}.pbf`**

- 经 `/backend` 同源代理可以正常请求。MapLibre 在 Worker 里请求瓦片，地址要用绝对地址（旧代码注释同样记录了这一点）
- **不校验 token**：不带 token、带无效 token 都返回 200，内容完全相同。至少目前瓦片与用户、权限无关（ADR 0025 的待定问题），以后会不会按权限过滤仍要向后端确认
- 响应头：`Content-Type: application/x-protobuf`，`Cache-Control: max-age=300, public`；没有 `ETag`、`Last-Modified`，5 分钟后只能整张重新下载；**没有压缩**
- 瓦片内的图层名默认等于瓦片集名（如 `bgdc_dltb_2022`）；旧代码例外表里的两个仍然成立：`bgdc_czcdyd_2022` 是 `czcdyd`，`bgdc_dltb_czc_2021` 是 `dltb_czc_2021`
- 地类图斑 2022 的属性字段：`bsm`、`dlmc`、`dlbm`，另有 `clustered`、`point_count`、`sqrt_point_count`
- 地类图斑低层级瓦片很大（南京附近，一次请求）：

  | 缩放级 | 大小 | 要素数 | 耗时 |
  |---|---|---|---|
  | 5 | 8.6 MB | 158706 | 657 ms |
  | 8 | 3.7 MB | 68130 | 89 ms |
  | 9 | 4.6 MB | 82079 | 507 ms |
  | 11 | 1.5 MB | 22570 | 158 ms |
  | 12 | 552 KB | 8015 | 185 ms |
  | 14 | 119 KB | 480 | 1721 ms |
  | 15 | 23 KB | 91 | 49 ms |

  z8 那张用 gzip 压缩后是 1.1 MB（原来的 31%），生产环境由 nginx 压缩（[deployment.md](deployment.md)）
- 范围外的瓦片返回 200、内容为空；**瓦片集不存在、缩放级越界时同样返回 HTTP 200**，内容是 JSON `{"success":false,"code":500,"data":null,"msg":"系统异常"}`。预计 MapLibre 会把它当作瓦片解析失败、通过 `error` 事件上报，不会让视图进入 `failed`（ADR 0026：运行中的其他错误只上报），接入资源图层时在开发页确认

行政区边界在旧项目是静态文件 `public/static/geojson/`：省界 0.8 MB、市界 2.5 MB、县界 0.2 MB。县界比市界小得多，可能做过简化或不完整，到 5B.2 确认。

## 现状底图：资源图层实测（2026-10-11，5C.1b）

开发页 `/dev/resources`（不需要登录，资源树和瓦片不校验 token）用真实的资源树和瓦片实测：本会话的浏览器面板（NVIDIA RTX 3060、16 核），地图固定 1024 × 640。每次操作记"到最后一次 `idle`"的时间、瓦片请求数和最长的一帧（面板里观察不到 `longtask`，阻塞 120 ms 也没有记录，改用帧间隔）。资源树与 5A 时一致：183 条记录、去重后 78 个资源。

**瓦片是现场生成的，没有固定的金字塔**

- 任何级别都返回数据（z22 也有）；同一张瓦片第一次要几百毫秒到几秒，再请求只要几毫秒（服务端缓存）。旧样式登记表注释里"地类图斑 z9～z13 有洞"已经不成立，缩放分段只剩"控制向哪一级请求、用低一级放大"的作用
- 低层级的瓦片又大又慢（南京位置的一张 z7）：水域面层 42 MB、20 s，公路线层 27 MB、8 s，永久基本农田图斑 10 MB，城市道路线层 9 MB，地类图斑 6.9 MB；78 个资源的 z7 合计 124.5 MB，z10 合计 9.7 MB
- 全省视图勾选水域面层：4 张瓦片，14.3 s 才画出来（主线程不卡）；勾选地类图斑：0.7～1.0 s，所以地类图斑保留默认勾选
- 结论：每个资源要有最小显示级别，重的图层放大后才显示；数据源的最大级别设在 15 左右，更高的级别由 MapLibre 放大，不再向后端请求

**12 个资源没有瓦片（后端的问题，要告诉后端）**

- 水资源 7 个（`szy_*`）、林草湿荒 1 个（`lcsh_lcshfbtb`）、三区三线 4 个（`gtkjgh_*`）：z7、z10 都返回 HTTP 200 加"系统异常"的 JSON，后端没有这些瓦片集
- MapLibre 把它当作瓦片解析失败：原生 `error` 事件带 `sourceId`（如 `resources-dev_missing`），信息是 `Unable to parse the tile at <地址>, got error: Unimplemented type: 3`，每张瓦片一次。适配器现在只把 `event.error` 交给 `onError`，`sourceId` 丢了，失败对应不到资源
- 瓦片出错不会触发重绘，没有重绘就没有 `idle`（这时 `map.loaded()` 已经是 `true`）：靠 `idle` 触发的事（旧项目的要素发现、图例统计）遇到出错的图层会一直等

**未勾选的图层不放进样式**（旧项目全部放进样式，未勾选的设为 `visibility: none`）

| 操作（z10 南京） | 不放进样式 | 放进样式、隐藏 |
|---|---|---|
| 开启这种做法本身 | — | 45 ms（加进 79 个隐藏的数据源） |
| 勾选村级调查区：首次 / 再次 | 572 / 227 ms | 483 / 235 ms |
| 全选：首次 / 再次 | 9.4 / 7.5 s | 11.7 / 7.0 s |
| 全不选时发出的瓦片请求 | 0 | 492 |

隐藏的数据源本来就不加载瓦片，所以放进样式并没有让重新勾选变快（再次勾选时的瓦片来自 HTTP 缓存，两种做法一样）；隐藏时 MapLibre 反而重新请求了这些数据源的瓦片（命中缓存，但 Worker 要重新解析）。取消勾选两种做法都在 50 ms 以内。

**Worker 数量设 4**

- MapLibre 6 的默认值：Safari 是 `max(min(核数 / 2, 3), 1)`，其他浏览器（包括 Chrome）只有 1 个（读 maplibre-gl 6.12 的源码确认，实测"不设置"与显式设 1 一致）
- z10 全选 77 个资源，瓦片都在 HTTP 缓存里（只比较解析）：

  | Worker | 耗时 | 最长一帧 |
  |---|---|---|
  | 1（Chrome 的默认值） | 7.2～9.8 s | 18～50 ms |
  | 2 | 5.1～6.1 s | 33～83 ms |
  | 3 | 5.0～6.7 s | 33～83 ms |
  | 4 | 4.7～5.1 s | 50～83 ms |
  | 6 | 5.1～5.8 s | 83～100 ms，慢帧 1～3 个 |

- HTTP 缓存只有 5 分钟，过期后又回到服务端现场生成，耗时主要看服务端（同样是 4 个 Worker，冷的一次 12.6 s），比较时要连续测、取缓存命中的几次
- 结论：设 4（旧项目也是 4）；再多没有收益，回传结果时主线程更卡

**每个资源按 `geoType` 建 1 个图层**：全选时 1 个和 3 个耗时相同（都约 7 s）；解码每个资源在南京、苏州、徐州、扬州附近的 z11 瓦片，实际的几何类型都与 `geoType` 一致，只有城镇村等用地在 8751 个面里夹着 8 条线（退化的要素，面图层按几何类型过滤后不显示）。所以不需要旧项目"每个资源 3 个几何图层、运行时发现几何类型"的做法。瓦片里的图层名都是 `code_年份`，只有旧例外表的两个不同（`bgdc_czcdyd_2022` 是 `czcdyd`，`bgdc_dltb_czc_2021` 是 `dltb_czc_2021`）；13 个资源在这 4 个位置没有数据（稀疏）

**标注不需要旧项目 34 MB 的字形**

- 样式的 `glyphs` 只提供 Noto Sans 的 0-255 一个区段（76 KB），汉字由 MapLibre 的 `localIdeographFontFamily`（默认 `sans-serif`）用浏览器本地字体画
- 实测 6 条标注（汉字、全角括号、`·`、拉丁字母、数字、罗马数字）都放置成功；只请求了 0-255 和 8448-8703（`Ⅰ` 所在的区段），汉字和全角括号没有请求字形；没提供的区段返回 404，`Ⅰ` 显示不正确，地类名称、水系名称里基本用不到
- Noto Sans 是 OFL 许可，字形可以随项目分发；实验时字形临时放在不入库的 `public/fonts/glyphs/`（ADR 0013）

## 现状底图：资源图层的样式数据（2026-10-11，5C.1d）

直接请求后端的瓦片（南京、苏州两处），定样式登记表（`features/resource-map/style-registry.ts`）里的数据。

**最小显示级别**：取单张瓦片小于约 2 MB、首次生成少于约 2 s 的最低级别；地类图斑例外（默认勾选，z7 有 6.9 MB 但只要 0.2 s，全省视图 0.7～1.0 s 画出来，ADR 0041）

| 资源 | z7（南京） | z8（南京 / 苏州） | z9（南京 / 苏州） | 最小级别 |
|---|---|---|---|---|
| 水域面层 `csxhjctb_hyda` | 42.3 MB、20.5 s | 17.5 MB、8.4 s / 17.6 MB、8.4 s | 2.4 MB、3.5 s / 2.2 MB、3.2 s | 10 |
| 公路线层 `csxhjctb_lrdl` | 27.0 MB、7.9 s | 4.5 MB、1.8 s / 7.4 MB、2.3 s | 0.6 MB、0.3 s / 1.0 MB、0.4 s | 9 |
| 永久基本农田图斑 `bgdc_yjjbnttb` | 10.4 MB、4.3 s | 0 / 3.5 MB、2.2 s | 0 / 0 | 9 |
| 城市道路线层 `csxhjctb_lctl` | 9.3 MB、3.1 s | 2.6 MB、1.1 s / 6.0 MB、1.8 s | 0.9 MB、0.3 s / 1.3 MB、0.5 s | 9 |
| 路面范围 `bgdc_lmfw` | 5.6 MB、4.4 s | 2.3 MB、2.5 s / 3.5 MB、3.0 s | 0.8 MB、1.2 s / 0.9 MB、1.3 s | 9 |
| 村级调查区 `bgdc_cjdcq` | 4.5 MB、4.2 s | 1.2 MB、2.9 s / 1.8 MB、3.9 s | 0.3 MB、0.8 s / 0.5 MB、1.2 s | 9 |
| 村级调查区界线 `bgdc_cjdcqjx` | 5.0 MB、2.1 s | 1.0 MB、0.8 s / 1.7 MB、1.2 s | | 8 |
| 推土区 `bgdc_ttq` | 2.4 MB、1.8 s | 1.1 MB、1.3 s / 1.6 MB、1.5 s | | 8 |
| 行政区 `bgdc_xzq` | 0.9 MB、2.6 s | 0.4 MB、1.2 s / 0.4 MB、1.4 s | | 8 |

其余资源 z7 都在 2 MB、2 s 以内（城镇住宅用地面层 0.7 MB、1.0 s，商业服务业设施点层 1.0 MB、0.5 s），不限制。

**属性字段**：瓦片里的字段名都是小写，旧项目为大写字段名写的兜底（`DLBM`、`CZCLX`、`CCN`、`TYPE` 等）不迁移

| 资源 | 字段 | 取值 |
|---|---|---|
| 地类图斑 `bgdc_dltb_2022` | `bsm`、`dlmc`、`dlbm` | 样本里的编码、名称都在表 A.2 之内 |
| 地类图斑（城镇村）`bgdc_dltb_czc_2021` | `dlbm`、`qsxz`、`dlbm_20` | **没有 `dlmc`**，只能按编码换成名称再配色 |
| 城镇村等用地 `bgdc_czcdyd_2022` | `bsm`、`czclx` | `czclx` 有 8 个值：201、201A、202、202A、203、203A、204、205 |
| 水域线层 `csxhjctb_hydl_2025` | `ccn`、`bas`、`name` | `ccn`：河流、水渠 |
| 乡村道路线层 `csxhjctb_lvll_2025` | `type` | 农村硬化道路、机耕路、乡村路 |

**与旧项目的差异**

- 注记压在资源图层上面（2026-10-11 看过效果后决定）：旧项目是资源压住注记，省内的地名被不透明的地类图斑盖住
- 城镇村等用地：旧项目只列了 6 个值、每次刷新随机配色，201A、202A 落到灰色兜底；现在 8 个值按顺序从配色板取色，每次一样
- 地类图斑：旧项目靠运行时发现地类，把表外的编码按名称补进历史颜色；现在编码没命中时按名称查历史名称表，直接写在表达式里
- 缩放分段（`mvtZoomFallbacks`）不迁移，改为每个资源一个数据源，按上表设最小显示级别，数据源的最大级别 15
- 默认样式（10 色配色板、面 0.35 的半透明填充加同色描边、线宽和点半径的插值、默认透明度 0.9）与旧项目相同；标注还没有迁移（ADR 0041）

## 现状底图：图例统计实测（2026-10-11，5C.4）

ADR 0021 留下的待定：旧图例打开时，地图空闲后对地类图斑做整屏 `queryRenderedFeatures`，统计"当前出现的地类"，阻塞主线程。开发页 `/dev/resources?workers=4` 的"统计地类"按钮在真实的 MapLibre 6 上测（本会话的浏览器面板，地图 1024 × 640，只勾选地类图斑，等 `idle` 后再统计；每格是同一视野连续测的几次）：

| 视野 | `queryRenderedFeatures` | `querySourceFeatures` | 不同的编码 | 表外编码 |
|---|---|---|---|---|
| 全省 z6.5 | 18.9 万个要素，327～563 ms | 20.7 万个，148～154 ms | 57 | 无 |
| 南京 z10 | 10.7 万个，205～334 ms | 20.8 万个（含视野外已缓存的瓦片），133～200 ms | 55 | 无 |
| 南京 z13 | 2481 个，5～8 ms | 5095 个，2 ms | 26 | 无 |

- 两种查询都在主线程上同步执行，要把要素逐个构造出来；全省和 z10 时一次就是几百毫秒的卡顿，比 ADR 0021 记的"近 1 秒"少，但仍是明显的阻塞
- 旧项目做这项统计只是为了发现表 A.2 之外的编码，放进"其他地类"分组；图例本身一直列出全表，不按统计结果过滤。ADR 0041 已经把表外的情况写成静态规则（编码没命中时按名称查历史地类，再用兜底色），实测三个视野也都没有表外编码，所以新项目不做这项统计（ADR 0043）

## 现状底图：图层面板与旧页面的差异

5C.2 讨论确定（2026-10-11），界面在 5D 再设计：

| 方面 | 旧页面 | 新页面 |
|---|---|---|
| 排序 | 在树里同级排序（上移、下移、长按 320 ms 拖动），分类也能移动；叠放顺序是树展开后的顺序 | 目录树按目录顺序，只负责浏览和勾选；"已勾选"区按叠放顺序列出勾选的资源，在这里上移、下移，可以跨分类；拖动在 5D 再定 |
| 透明度 | 勾选的资源在树里点开滑块 | 在"已勾选"区点开滑块 |
| 搜索 | 分类名称命中时只留下同样命中的子节点（子节点都不命中时显示空分类） | 分类名称命中时留下它的全部资源；勾选分类只作用于显示出来的资源（旧页面会连同被过滤掉的一起勾选） |
| 提示 | 没有 | 配置错误、"放大至第 N 级显示"、"部分瓦片加载失败"（ADR 0041） |
| 空分类 | 显示 | 不显示（真实数据里公共库、主题库下都是空分类） |
| 页签与年份 | "主节点""统计报表""分节点资源"三个页签，后两个只有"暂无数据"；年份下拉只是入口、不生效 | 不迁移；年份在 5C.8 |
| 几何图标 | 点、线、面三种 PNG | 暂不显示，等 5D 的图标素材 |
| 宽度 | 370 | 320（面板型侧栏的档位，`page-layout.md`） |
| 排序的保存 | localStorage，按角色和用户 ID 区分，只存排序 | IndexedDB，按登录名区分；勾选、透明度、顺序、年份都记住，底图和边界也记住（5C.3，ADR 0042） |

## 现状底图：符号编辑与旧页面的差异

5C.5a（2026-10-12），界面在 5D 再设计：

| 方面 | 旧页面 | 新页面 |
|---|---|---|
| 保存 | localStorage，按角色和用户 ID 区分；首次加载时把更早的地类配色迁进来 | IndexedDB 的 `resource-symbols`，按登录名区分（ADR 0042）；旧的 localStorage 覆盖和"首次迁移旧配色"都不迁移 |
| 覆盖 | 只记和默认不同的字段，直接比较字符串 | 只记和默认不同的字段，颜色规范化成 `rgba(r, g, b, a)` 后比较和保存，自定义大小按步长取整 |
| 颜色选择器 | 自己写的 `SymbolColorPicker` | `ElColorPicker`（带透明度、预设色为配色板加黑白），不允许清空 |
| 拖动调色 | 实时预览，写入有防抖，停顿超过防抖就存下了没确认的颜色 | 拖动只是预览，不写入覆盖；确认时写入并保存；按 Esc、点外面时回到原来的颜色 |
| 自定义大小 | 输入框，`change` 时提交 | 回车或失焦时确认，不合法的值不提交，留在输入框里提示范围；和当前档位像素相同时不提交 |
| 恢复默认 | 单个图层、单个分组、全部（全部有确认框） | 单个资源、全部（全部有确认框）；分组在 5C.5b |
| 面的选项 | 填充色、10 种填充方式、纹理颜色、描边色、描边宽度、描边线型 | 填充色、描边色；其余在 5C.5c |
| 图例的预览 | 画出线型、粗细 | 只反映颜色，5D 再做 |

## 底图：天地图实测（2026-10-10）

5B.1 的依据（ADR 0031），从本机直接请求：

- 天地图 `vec`、`cva`、`img`、`cia`（`_w` 球面墨卡托）的有效级别是 1～18；0 级和 19 级也返回 200，内容是占位图（`img` 的 0 级和 19 级同为 4769 字节），所以数据源设 `minzoom: 1`、`maxzoom: 18`
- 返回头有 `Access-Control-Allow-Origin: *`、`Cache-Control: max-age=432000`（5 天）；key 不对时返回 418；不带 Referer 也能取到瓦片，这个 key 可能没有设域名白名单（待确认，见 roadmap）
- 旧项目的内网影像 `http://192.168.1.180:8080/tiles/{z}/{x}/{y}.jpg` 只有 1～9 级（10 级以上全部 404），9 级覆盖约 90.7～135.7°E、20～52.9°N；用户决定改用天地图影像，不迁移
- 旧项目提交 `d768c66` 的天地图开关：关闭时底图样式里不放天地图数据源，区划边界只用本地 GeoJSON、天地图行政区接口直接抛错；同一提交把现状底图的默认选择从"无底图"改回"矢量底图"。新项目用 `appConfig.tianditu`（关闭时为 `null`）和内网构建模式实现同样的语义，5B.2 的边界、5B.5 的区划定位沿用
- 旧项目的 `auth-service` 把 `t0`～`t7.tianditu.gov.cn` 排除在加 token 的范围之外：以后给瓦片请求加 token 时只给同源请求加，不能把登录 token 发给天地图
