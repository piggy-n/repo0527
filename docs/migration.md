# 迁移进度

旧仓库：`C:\work\zhjsqdxin`，以 `master-demo` 分支为准。

开始迁移一个模块时，在下表记下旧仓库 `master-demo` 当时的 commit 作为基线。之后查看旧仓库的新改动：

```bash
cd C:\work\zhjsqdxin
git diff <基线>..master-demo -- <旧路径>
```

旧仓库的工作目录可能停在其他分支上，所以比较对象写 `master-demo`，不写 `HEAD`。

| 模块 | 基线 | 旧路径 | 新位置 | 状态 |
|---|---|---|---|---|
| 城市体检驾驶舱 | `6b4799b922efb2ed276cc28122fbe78527234b75` | `src/views/city-dashboard/`、`public/images/jsc/`、`public/static/geojson/江苏省市界.json`、`src/router/index.js`、`src/services/auth/auth-service.js` | `features/city-dashboard`、`pages/city-dashboard`；顶级 `/city-dashboard`；预览在忽略目录 `apps/web/public/design.local/city-dashboard/` | 阶段六 D3 前端迁移独立验收通过（2026-10-22），按用户授权合入 main；Web 1844 + 图标包 35、生产冒烟 25 项通过。仅固定模拟数据；字体体积、暖刷新、真实硬件及依赖告警限制见[验收报告](stages/city-dashboard-acceptance.md)。含自身 Three.js，不涉及现状底图 Cesium |
| 资源管理 | `6b4799b922efb2ed276cc28122fbe78527234b75` | `src/views/resource-management-new/`、`src/api/resource/resource-manage-api.js`、`src/router/index.js` 的实际入口 | `features/resource-management`、`pages/resource-management` | 阶段六 R1～R4 已完成并验收（2026-10-21）：目录、年份、管理员列表、详情/属性编辑与图层启停均已接入。按确认 A 版仅属性表滚动，头部「返回 / 修改」同高，查看纯文字，目录弹窗采用获准新增的公共灰底标题变体；最终删除详情只读说明，精简编辑提示、统一底栏按钮间距。107 项相关测试、15 项产物冒烟通过；最终文案收尾的六尺寸布局、类型 / lint / 内网构建复查通过。读取经过真实接口核对，写操作仅在本地固定数据验证，真实写契约及 Excel 尚未实测。地图服务 / 数据接口的前端内存实现单独待确认；Excel 等待用户通知公共传输合入后接入。分支变更清单、提交顺序、验证边界及合入说明见 [资源管理模块](modules/resource-management.md) 末尾；main 合入由用户协调。2026-10-27 的附属服务、自助取数、下载申请见下文 |
| 登录与鉴权 | `836f03b` | `src/views/login/`、`src/services/auth/auth-service.js`、`src/stores/user.js`、`src/utils/func-crypto.js`（`encryptPassword`）、`src/api/sys/sys-uaa-auth-api.js`、`src/router/index.js`（路由守卫）、`src/libs/http-service.js`（token 请求头与 401） | `shared/auth`、`features/auth`、`pages/login`、`app/router`、`app/http.ts` | 已完成登录、会话、路由权限、退出（阶段二）；AI 后端的登录接口和 token 随 AI 对话迁移（2026-10-28），账号来源待定，见下行 |
| AI 对话 | `b4f39874293b4d01f77b66966a382e6e77a4bcbf`（yzt 基线 `c17eb06`） | `src/views/ai-chat/`（含后端实际返回的 `data.json`）、`src/components/AiChat/ChatPanel.vue`、`src/api/ai/ai-api.js`、`src/services/ai-map-service.js`、`src/components/CommonMap/managers/AiResultLayerManager.js`、`src/styles/ai-chat.css`；`src/views/login/index.vue` 的 `loginToAiBackend`、`src/services/auth/auth-service.js` 的 AI token、`src/configs/api-config.js` 的 `ai` 后端 | `features/ai-chat`、`pages/ai-chat`；分支 `migrate-ai-chat` | 2026-10-28 按用户要求做最小迁移：对话、流式回答、步骤、历史、结果区、GeoJSON 结果的地图；MVT 结果、点击弹窗等未迁移，接口都未联调，临时处理与待办见 [modules/ai-chat.md](modules/ai-chat.md)。`src/stores/ai.js` 是空文件，不迁移。当天用户验收通过，由 `66b06a7` 合入 main，合并后全部检查通过 |
| 文件管理 | `836f03b` | `src/views/resource-center/file-management.vue`、`src/views/resource-center/components/` 下的 `FileManagement*.vue`、`DeleteFileManagementDialog.vue`、`UploadFileManagementDialog.vue`、`DocxPreviewDialog.vue`；`src/mock/file-management-data.js`（分类树与业务类型标签，是写死的业务配置，不是 mockjs）；`src/api/resource/resource-api.js` 中的 `/file/*` | `features/file-management`、`pages/file-management`、`shared/query-form`、`shared/table` | 列表已完成（阶段三 3.3）；阶段六上传、下载进度与预览已接入并完成本地验证，真实后端及业务文件待验收；上传暂按用户确认仅判断 code |
| 地图内核 | `836f03b` | `src/components/CommonMap/`（二维：引擎、`MapService`、各 Manager、点选、测量、绘制）；`src/views/current-map-new/cesium/`（三维）、`src/views/current-map-new/composables/useEngineSwitch.js`（二三维切换与同步）；`src/libs/bus.js`（全局事件总线） | `libs/map-core`、`libs/utils`（Worker 通信层）；三维将来在 `libs/map-cesium` | 阶段四：按新设计（ADR 0020～0025）实现了地图会话（样式、相机）、MapLibre 适配器和 Worker 通信层，在 `/dev/map` 上验证；旧代码的分析见 [modules/map-core.md](modules/map-core.md) 附录。业务图层、点选、测量、绘制、三维还没有迁移（阶段五、六）。阶段四结束时 `master-demo` 仍是 `836f03b` |
| 现状底图与公共地图能力 | `836f03b` | `src/views/current-map-new/`（页面、图层面板、地图控制栏、图例、详情面板；`cesium/` 与 `composables/useEngineSwitch.js` 归三维阶段）；`src/components/CommonMap/`（`MapContainer`、`MapService` 与底图、边界、业务图层、测量、点选、绘制、符号与地类配色）；`src/assets/LayerManager.ts`；`src/services/map-tree/`（图层树接口、规范化、样式登记表、静态节点）；`src/stores/mapTree.js`；`src/components/toolbar/`（工具栏、区划定位面板）；`src/components/map/map-configs.js`；`src/api/resource/resource-map-api.js`；`src/views/current-map/utils/MapStaticBoundaryManager.js` | `libs/map-vue`、`shared/map`、`features/*`、`pages/current-map`（分层在 5A.1 的 ADR 中确定） | 5A 完成：map-vue（`provideMap`、样式绑定、`MapCanvas`、`useMap`、定位可视区域、失败提示）与现状底图的联调骨架，旧代码还没有迁移；底图、边界、工具在 5B，资源图层、面板、图例、点选在 5C，界面在 5D。5A 结束时 `master-demo` 仍是 `836f03b`。不迁移：接口失败时回退的本地快照 `src/assets/tree-data.ts`、三区三线的占位节点。5B.1 完成：底图（`BaseLayerManager`、`MapControlBar` 的底图部分、提交 `d768c66` 的天地图开关）迁到 `shared/map/basemap`，矢量、影像都用天地图（ADR 0031），内网部署用 `pnpm build:intranet`（ADR 0032）；不迁移 `static-nodes.js` 里的内网影像（`192.168.1.180:8080`）和没用到的 `osm-tiles` 数据源。5B.2 完成：省、市、县界（`BoundaryManager` 的静态边界、`MapStaticBoundaryManager`、`TiandituBoundaryLayer` 的画线部分、`MapControlBar` 的行政区部分）与默认视角（`MapViewManager.goToDefaultView`）迁到 `shared/map`（ADR 0033）；边界数据由转换脚本从 `public/static/geojson` 生成。区划定位、区划高亮、天地图行政区接口在 5B.5，区划裁剪在 5C.7。5B.3 完成：工具栏的工具切换（`components/toolbar/index.vue` 的分组与 `navigationMode`、`MapService.handleToolbarAction`、`SelectionInteractionController` 的模式）改为会话的工具模型（ADR 0034），工具栏外壳在 `shared/map/toolbar`；点选、框选在 5C.6，测距、测面在 5B.4。5B.4 完成：测距、测面、清除（`MeasureManager`、`MapDistanceMeasureManager`、`MapAreaMeasureManager` 和 `GeometryDrawManager` 中测量用到的部分）迁到 map-core 的 `MeasureStore` 与 `shared/map/measure`（ADR 0035）；距离和面积从 turf 的球面计算改为椭球面计算，单位格式和提示文案照旧；`GeometryDrawManager` 的通用绘制等阶段六的空间查询再看能否抽成通用的绘制工具。5B.5 完成：区划定位（`RegionLocatePanel.vue`、`MapService.selectRegion`、`BoundaryManager` 与 `MapRegionBoundaryManager` 的选区边界和定位）迁到 `shared/map/region`（ADR 0036）；区划目录由 `regionLabelPoints.ts` 转换，不用 `region.js`（8 个区县的代码写错）；边界只用本地的市界、县界。不迁移：天地图行政区接口（`TiandituBoundaryLayer` 的请求部分，本地数据完整时用不到）、选中区划的名称标签（效果一般，以后在 5D 重新设计）、`DEFAULT_FIT_BOUNDS_OPTIONS` 写死的 96 像素留白（改由登记的悬浮元素决定）。区划裁剪（`MapRegionClipManager`、`MapRegionLayerFilter`）在 5C.7；坐标定位在旧项目里只是占位按钮，新做在 5B.6。5B.6 完成：坐标定位与位置点是新功能（ADR 0037），没有旧代码可迁移，交互先在原型里和用户确认（长按 0.5 秒、"坐标定位点"、拾取后打开位置信息、至少 14 级、复制用规范的 `′″`、"清除"连同位置点、所在区划用县界判断、两个定位面板互斥）。5B 结束时 `master-demo` 仍是 `836f03b`。5C.1d 完成：资源树接口、目录、样式登记表（`services/map-tree/` 的规范化、`layer-style-registry.js`、`source-layer-exceptions.js`）与地类配色（`landuseClassification.js` 的编码表、历史名称表）迁到 `features/resource-map`，差异见"现状底图：资源图层的样式数据"。5C.1e 完成：显示状态、分组推导与校验（`DataTree.vue` 的勾选、`LayerManager.ts` 和 `BusinessLayerManager` 的建层部分）改为拥有者 `useResourceLayers` 与纯函数（ADR 0041）；现状底图先用临时的勾选列表联调，图层面板在 5C.2。5C.2 完成：图层面板（`LayerPanel.vue` 的目录树、勾选、搜索、透明度、排序、收起）迁到 `features/resource-map` 的 `ResourceLayerPanel`，差异见"现状底图：图层面板与旧页面的差异"。5C.3 完成：图层排序的持久化（`LayerPanel.vue` 的 `loadStoredLayerOrder`、`saveStoredLayerOrder`）改为 `shared/storage` 的偏好（ADR 0042）：存在 IndexedDB、按登录名区分，资源图层的勾选、透明度、顺序、年份和底图、边界都记住；旧的 localStorage 键不迁移（只有同级排序，和新的顺序模型对不上）。地类配色和符号的覆盖在 5C.5。5C.4 完成：只读图例（`MapLegendPanel`、`LanduseLegendSection`、`LayerLegendGroup`、`LayerLegendPreview` 的显示部分，`landuseClassification.js` 的表 A.1 分组与地类含义）迁到 `features/resource-map` 的 `ResourceLegend`（ADR 0043）；不迁移"当前出现的地类"统计（`requestPresence`、`discoverLanduseTypes`）和运行时的几何类型识别；调色、恢复默认在 5C.5。5C.5a 完成：统一符号的编辑（`LayerSymbolEditor`、`LayerSymbolStyleManager` 和 `layerSymbolModel.js` 中统一符号的部分，`MapLegendPanel` 的"全部恢复默认"）迁到 `features/resource-map` 的 `symbols.ts`、`useResourceSymbols`、`SymbolEditor`（ADR 0044），差异见"现状底图：符号编辑与旧页面的差异"。5C.5b 完成：分类样式（`LayerLegendGroup` 的样式方式与逐项编辑、`resourceSymbolModel.js` 的分类、`resourceSymbolPaint.js` 的 `combineValues`）迁到 `classification.ts`、`classifiedPaint` 和图例；不迁移按取值散列取色（`stableClassColor`，城镇村等用地在 5C.1d 已改为按取值顺序从配色板取色）和地类配色的首次迁移（`LanduseStyleManager`）。5C.5c 完成：面的填充方式、纹理颜色、描边宽度、描边线型（`fillPatternFactory.js`、`layerSymbolModel.js` 的面字段、`resourceSymbolPaint.js` 的三层画法、`LayerSymbolEditor` 与 `LayerSymbolPreview` 的面选项和花纹）迁到 `fill-patterns.ts`、`symbols.ts`、编辑器和图例（ADR 0045、0046）；纹理改用固定的 SDF 图片，不再按颜色现画位图；分类样式的纹理默认色加深，线型不同的取值按线型拆层，差异见"现状底图：符号编辑与旧页面的差异"。5C.6 开始时 `master-demo` 是 `ab607d7`，`components/CommonMap/selection/`、`views/current-map-new/`、`api/resource/` 与 `836f03b` 相比没有改动，基线仍记 `836f03b`；查询接口的实测见 ADR 0047。5C.6a-2 完成：识别与详情的查询（`selection/` 的分页范围查询、按主键取属性、"全世界范围 + 条件"取完整几何、识别顺序与候选排序，`FeatureDetailPanel.vue` 的标题和字段行）迁到 `features/resource-map` 的 `api.ts` 与 `feature-query.ts`；主键统一用 `guid`，不再按配置的字段、常见字段名或全部属性匹配；面只取包含点击位置的（旧项目 6 像素容差）；候选按"距离、从上到下"排序，面的距离都是 0；不迁移资源管理的字段配置接口（名称都是空的），地类的字段名用本地的中文名。5C.6a-3 完成选择的拥有者、点选工具、高亮和详情面板（`selection/` 的状态与高亮、`FeatureDetailPanel.vue` 的候选和详情），面板是联调骨架；实测见"现状底图：点选的实测"。5C.6b 完成框选（`SelectionInteractionController.js` 的拖动手势、`pickBox`），见"现状底图：框选的实测"。5C.7 完成区划裁剪（`boundary/MapRegionClipManager.js`、`MapRegionLayerFilter.js`，`BoundaryManager.applyRegionScope`，点选里的区划判断）：不迁移按属性过滤和运行时探测字段，改为按区划边界的遮罩、点选和框选按几何限定范围（ADR 0051），见"现状底图：区划裁剪的实测"。5C.8 完成年份（旧页面的 `YearSelectDialog`、新页面只有入口的"全部年份"）：每个资源各自选年份，另有批量设置（ADR 0052），见"现状底图：年份的验收"。5E 开始时 `master-demo` 是 `6b4799b`，上面的路径与 `836f03b` 相比没有改动 |
| 三维（现状底图的 Cesium 部分） | `6b4799b922efb2ed276cc28122fbe78527234b75` | `src/views/current-map-new/cesium/`（引擎、影像与 GeoJSON 叠加、本地 3D Tiles 与白膜、第一人称 / 第三人称漫游、导航网格与其 Worker、室内地图）、`src/views/current-map-new/composables/useEngineSwitch.js`（二三维切换与同步）、`src/views/current-map-new/components/LocalTilesetControls.vue`、`vite.config.js` 中复制 Cesium 静态资源的配置；模型数据 `public/SZ_3DT/`、`public/SZ_WhiteModel/` 在旧仓库里也不入库 | `libs/map-cesium`、`libs/map-vue` 的动态加载、`shared/map`；原型在 `pages/dev/map-3d` | 2026-10-26 重启：读完旧代码，用户确定本阶段的范围和取舍（见 [roadmap](roadmap.md)"三维阶段的范围与取舍"），交互原型 `/dev/map-3d` 当天确认（ADR 0078）。3D.1 完成（ADR 0079）：`CesiumEngine.js` 的相机换算（距离与缩放级、视场角、在目标点的东北天坐标系里解算方位和俯角）、`CesiumStyleMirror.js` 与 `XyzImageryProvider.js` 中栅格底图的镜像、`useEngineSwitch.js` 的切换与相机同步、`vite.config.js` 复制静态资源迁到 `libs/map-cesium`、map-vue 和 `vite.config.ts`；切换时的底图规则是新加的（三维默认影像、二维默认矢量）。3D.2 完成（ADR 0080）：`GeoJsonOverlayLayer.js` 的覆盖物镜像（世界外环收成方框、去掉相邻的重复点、测量画线只改坐标）迁到 `overlay-plan.ts` 和 `CesiumScene`，另按这一级的半个像素简化、重建时旧的留到新的画好；样式表达式改用 style-spec 求值，不迁移 `styleExpression.js`；三维测量直接用二维的测量工具；临时拖动、视点高度、点选提示和图例说明是新做的（原型确认）。不迁移覆盖物的 `symbol` 标注（现状底图的覆盖物没有用到）。3D.3 完成（ADR 0081）：`LocalTilesetPreview.js` 的索引整理（`prepareLocalTileset`）、瓦片集参数与头灯光照、钻地（`CesiumEngine.js` 的地表透明、土层与背景、退出时飞回地表），`WhiteModelLayer.js` 的效果切换（新效果首批瓦片到位前留着旧的、切走的只隐藏），`LocalTilesetControls.vue` 的加载与定位，迁到 `libs/map-cesium`（`prepare-tileset.ts`、`scene-tilesets.ts`、`scene-underground.ts`）、会话的三维内容和 `features/scene-models`；模型改由入库的静态清单 `public/3dt/manifest.json` 描述（数据仍不入库），三维时左侧换成模型面板（原型确认）；"已显示"不再等第一个瓦片可见，建好瓦片集就能定位；白膜也经过索引整理，没有内容、下面都是叶节点的节点保留自己的误差。3D.3 开始时 `master-demo` 仍是 `6b4799b`。3D.4a 路线漫游（ADR 0083）：旧项目没有路线漫游，是新做的；苏州站的三条路线用旧项目的 `navGrid.js` 离线算出导航网格后规划，用户确认。之后 `master-demo` 新增 `b4f3987`（2026-10-27，徐州模型），已同步（ADR 0084）：`XzGcModelLayer.js` 的加载、定位改由清单的 `xz-gc`（倾斜摄影，数据 `XZ_GC_3DT/` 从旧仓库复制、不入库）承担，钻地时隐藏它改为钻地时隐藏所有地面上的模型；`tools/osgb-to-3dtiles`（Python 的 OSGB 转 3D Tiles 工具）不迁移，转换在数据侧完成。3D.4b 导航网格（ADR 0085）：`navGrid.js`、`navGridWorker.js`、`indoorMap/levels.js` 迁到 `map-core/scene/nav`，规则和参数不变，在苏州站的数据上逐格比对一致；`labelComponents` 改名 `labelRegions`；瓦片改在主线程下载（报告进度），Worker 只解析和构建；`LocalTilesetPreview.getNavigation` 收集叶节点的做法改为纯函数 `navigationLeaves`；室内地图原来每层单色，改为按区域着色、同一区域按高度渐变，并按根节点局部系的方位角旋转保证正北朝上（用户 2026-10-27 选定）。3D.4c 第一人称步行（ADR 0086）：`FirstPersonRoam.js` 的第一人称部分迁到 map-core 的 `walker.ts`（行走、点击、脱困、出生点的规则，参数不变）和 map-cesium 的 `scene-walk.ts`（键鼠、深度拾取与遮挡、闪切、相机），`RoamTargetMarker.js` 迁到 `scene-walk-marker.ts`；`LocalTilesetPreview.getNavigation` 的缓存改由拥有者按模型缓存；进站不再分两段飞（新的钻地进入时地表已是半透明）；步行速度不再记在 localStorage，在几次步行之间沿用；`SZ_3DT_ROAM_SPAWN` 已在清单的 `spawn` 里；`setInteriorFog` 改为场景在步行时打开头灯着色器的 `uFog`。`RoamAvatar.js` 和第三人称在 3D.4d-2。3D.4d-1 室内地图（ADR 0087）：`indoorMap/IndoorMap.js`、`IndoorMinimap.js`、`IndoorMapView.js`、`mapDraw.js` 迁到 `features/scene-models` 的 `indoor-map/` 和 `IndoorMinimap`、`IndoorMapDialog` 组件；地图改为按区域着色、正北朝上（3D.4b），外观换成新的令牌和 `MxPanel`；小地图的档位不再记在 localStorage；完整地图的取景、缩放写成纯函数；打开期间的暂停、双击瞬移改由步行意图的 `paused`、`teleport` 表达。3D.4d-2 第三人称（ADR 0090）：`FirstPersonRoam.js` 的弹簧臂（`_updateArm`、`_armReach`）、转身（`_turnBody`）、点穿人物（`_seeThroughAvatar`）迁到 map-core 的 `third-person.ts`（参数不变），`RoamAvatar.js` 迁到 map-cesium 的 `scene-walk-avatar.ts`，步态的相位计算拆成纯 TS 的 `WalkCycle`；人物模型 `public/roam/Cesium_Man.glb` 从旧仓库复制入库（旧仓库也入库），补上署名文件；人称不再记在 localStorage，在几次步行之间沿用；人物模型改为第一次要显示时才加载；入口按用户要求暂不开放。不迁移：旧引擎挂在 `window` 上的 `cesiumViewer`、`cesiumEngine`；`XyzImageryProvider.js`（用 `<img>` 绕开 Cesium 默认的 Blob 加载，很可能是因为旧项目在 `main.js` 全局引入了 mockjs，它替换的 XHR 不支持 `responseType`；新项目不用 mockjs，改用 Cesium 的 `UrlTemplateImageryProvider`，浏览器测试和页面验证都正常）。本阶段不迁移 MVT：`MvtRasterLayer.js`、`MvtLabelLayer.js`、`MvtTileWorkerPool.js`、`mvtTileWorker.js`、`tileRenderer.js` 和样式镜像里矢量瓦片的部分。3D.5（预加载、页面缓存、生产冒烟）没有新迁移的代码；旧项目的三维不预加载，切到三维时才加载 Cesium。三维阶段完成（2026-10-27），总结见 [stages/stage-3d-cesium-and-roaming.md](stages/stage-3d-cesium-and-roaming.md) |
| 布局（顶部导航、用户菜单） | `836f03b` | `src/layout/components/TheHeader.vue`、`src/services/resource-application/roleService.js`（`getHeaderMenus`、`getRoleLabel`） | `app/layout` | 已完成导航与退出登录（阶段二 2.10）；消息按钮随系统管理与消息中心加入（ADR 0093，2026-10-28）；修改密码、修改头像待迁移对应功能时处理 |
| 城市国土空间监测指标 | `b4f39874293b4d01f77b66966a382e6e77a4bcbf`（yzt 基线 `0cfef2c`） | `src/views/space-monitoring-indicators/`（`index.vue`、`components/IndicatorTree.vue`、`LayerManagerPanel.vue`、`IndicatorLegend.vue`，`utils/indicatorLayerStyle.js`、`indicatorMvtManager.js`，`mockIndicatorLayers.js` 只用到区划中心）、`src/api/analysis/analysis-api.js`、`src/assets/images/layer/flag_icon.png` | `features/monitoring-indicators`、`pages/space-monitoring-indicators`；组件预览 `/dev/monitoring-indicators` | 2026-10-28 开始，分支 `migrate-space-monitoring-indicators`。`mock-data.js` 没有被引用，不迁移。预览当天经用户确认；接口核对见下文"城市国土空间监测指标：接口实测"，与旧页面的差异见"城市国土空间监测指标：与旧页面的差异"。合进 main `74b2fc0` 后全部检查通过，在真实后端上看过正式页面（[阶段笔记](stages/space-monitoring-indicators-migration.md)）；当天用户验收通过，快进合入本地 main。成果瓦片和开始计算待联调 |
| 城市国土空间监测基本统计 | `b4f39874293b4d01f77b66966a382e6e77a4bcbf`（yzt 基线 `b96499c`） | `src/views/space-monitoring-statistics/`（路由用的 `index.vue`、`composables/useStatisticsStatusPolling.js`、`useStatisticsTaskStatus.js`、`statistics-adapter.js`、`statistics-config.js`）、`src/api/statistics/statistics-api.js` 的前三个接口、`public/images/TongJi/` 的设计素材 | `features/monitoring-statistics`、`pages/space-monitoring-statistics`；组件预览 `/dev/monitoring-statistics`；宽屏收起侧栏是 `libs/ui` 的 `MxSplitLayout` 的新能力 | 2026-10-28 开始，分支 `migrate-space-monitoring-statistics`。不迁移：没挂路由的旧版 `SpaceMonitoringStatisticsPage.vue` 和只被它引用的 `components/` 下 6 个组件。预览当天经用户确认（ADR 0100）；同日在真实后端上只读看过正式页面，用户验收通过，快进合入本地 main（[阶段笔记](stages/space-monitoring-statistics-migration.md)）；开始统计的写操作待联调。之后用户给出两张把手的设计图，转成 2 倍尺寸的 WebP 接入（ADR 0101），验收通过后合入本地 main。接口核对见下文"城市国土空间监测基本统计：接口实测"，与旧页面的差异见"城市国土空间监测基本统计：与旧页面的差异" |
| 系统管理、消息中心 | `b4f3987`（yzt 基线 `6e2d606`） | `src/views/system-management/`、`src/views/resource-application/components/ApplicationListSection.vue`（管理员审核的部分）、`src/components/resource-application/`（`ResourceDetailDialog`、`StatusTag`、`MessageCenterPanel`、`MessageCard`、`NotificationBell`）、`src/services/resource-application/`（`applyApiService`、`messageService`、`resourceApplyService` 的状态文案）、`src/api/apply/`、`src/api/statistics/`（`statisticsPage`）、`src/api/message/`、`src/views/message-center/` | 原型 `pages/dev/system-management`、`pages/dev/message-center` | 2026-10-27 重新开始（上一版已由 `6dda705` 撤回，不沿用）；原型已确认（ADR 0092、0093）。已完成：资源审核、申请详情与审核、下载、统计报表（`features/data-application`、`features/statistics-report`、`pages/system-management`），消息的接口、查询、已读与弹框内容（`features/message-center`），顶栏的消息按钮与弹框（`app/layout` 的 `HeaderMessages`，顶栏断点重新测量过），开发页改为正式组件的样例，生产冒烟；ADR 改号为 0092、0093。2026-10-28 用户验收通过，由 `ddc2d6c` 合入本地 main（[阶段笔记](stages/system-message-migration.md)）；真实后端的写操作、下载和统计报表数据待联调。接口核对见下文"系统管理与消息中心：接口实测" |

## 城市国土空间监测基本统计：接口实测（2026-10-28）

浏览器面板里已登录的会话，经本机开发服务的 `/backend` 代理只读请求两个查询接口（都是 POST）；没有调用创建任务 `/statistics/create-table`，它的成功返回没有样本。

| 接口 | 实测 |
|---|---|
| 两个查询接口的结构 | 返回同一个结构：`dataVolume`、`status`、`tableInfoList`、五个数量、`base*Status`、`summary*Status`（省、市、区、县各一个）、`year`、`tableTypeList`、`levelList`、`progress`；各接口只填自己用到的，其余是 `null` |
| `POST /statistics/select-left-task`，`{ year }` | 只有八个 `base*Status`、`summary*Status` 有值，状态文字见到 `null`、"未处理"、"处理失败"。2023、2024 年全是 `null`；2025 年基本统计的省、区、县和汇总统计的省、市是"处理失败"，基本统计的市是"未处理"——但这个组合的状态接口里有 196 张处理成功，两个接口对不上 |
| `POST /statistics/select-task-status`，`{ year, tableType, level }` | `tableInfoList` 每行 `year`、`name`、`status`、`cause`、`completeTime`、`regionName`、`sort`（`null`）；行的状态只见"处理成功""未处理""处理失败"；`completeTime` 写成"2026-10-17  10:14:15"（两个空格）或 `null`。数量是数字，`progress` 是 0～100 的数，没有任务时是字符串 `"NaN"`；`status` 都是 `null` |
| 可选项 | `tableTypeList`、`levelList` 随每次查询返回，和传的报表、等级无关，只看年份：2025 年两种报表、四个等级；2026 年只有基本统计、省级和县级（但没有任务）；2023、2024 年都是空数组。年份传字符串或数字都可以 |
| 只按年份查 | 2025 年返回全年 9499 行、约 1 MB（还包括"城变"这类没开放的报表的行）；按报表、等级查时基本统计的区级 3087 行、约 350 KB |
| 数量 | 多个组合的 `processingNum` 是 1，但列表里没有"正在处理"的行，数量相加比总数多 1（如基本统计省级：总数 51、失败 1、处理中 1、未处理 50） |

后端的问题（不为它们调整方案）：两个接口的状态对不上；处理中的数量和列表不一致；没有任务时百分比是 `"NaN"`。按返回的显示，有"处理中"时轮询会一直继续，同旧页面。

当天在正式页面复看（只读，确认框点了取消）时：2026 年的总览变成基本统计的省级、县级"处理失败"，状态接口里这两个组合仍然一张表都没有，又一处对不上。2025 年基本统计的省、市、区级和汇总统计的省级处理中都是 1，页面停在这些组合时每 5 秒查一次、一直不停；提交前的确认框也因此提醒"包含正在处理的项目"。

## 城市国土空间监测基本统计：与旧页面的差异

用户 2026-10-28 在 `/dev/monitoring-statistics` 确认了布局和下面的取舍（ADR 0100）。

- 布局用分栏型：左栏 320、默认收起，宽屏也能收成窄条（`MxSplitLayout` 的新能力）；主区上面两列、下面统计表；窄屏时左栏进抽屉，主区更窄时排成一列、整体滚动
- 宽屏的收起把手和窄条仍是旧页面的两张把手图（用户给的 SVG 转成 2 倍尺寸的 WebP，ADR 0101），竖条上的名称从 20 号 `#008fff` 改为令牌的 16 号、主色；窄屏用默认的窄条
- 标题统一用 `MxTitle`，不再用 `public/images/TongJi` 的图片；完成度用 `ElProgress`，数量、状态用 Element 的图标
- 监控面板的状态筛选从标题行移到标题下面单独一行，窄时换行
- 切换年份不再单独"只按年份"查一次拿选项（全年约 1 MB），直接按条件查，条件不在返回的选项里再换成第一个可选的；条件切换不防抖
- 轮询改由查询库按间隔进行，规则同旧页面（5 秒；总览 30 秒；失败退避、连续 3 次停下；标签页隐藏时暂停）
- 提交后的跟踪去掉结果签名比较和"已查到结果但不能确认是本次的"提示；重新统计时如果没看到处理中，15 秒后提示"暂未查询到本次提交的统计任务"
- 提交前只逐个组合查状态，不再先查一次总览；确认框的列表用组件渲染，不拼 HTML 字符串
- 普通用户的"去下载"置灰，说明"数据下载页面迁移后可用"（旧页面跳到还没迁移的页面）

## 城市国土空间监测指标：接口实测（2026-10-28）

浏览器面板里已登录的会话，经本机开发服务的 `/backend` 代理请求；只读的 `tree/list`、`tree/out`、`progress`、`indicate`、瓦片和处理前验证 `verify`（POST，只检查是否已有结果），没有调用开始计算 `calculate`，它的成功返回没有样本。

| 接口 | 实测 |
|---|---|
| `GET /api/analysis/tree/list?type=&regionCode=&year=` | 两层（城市体检评估）或三层（综合分析指标）；节点都有 `dm`、`mc`、`jb`、`bz`、`sfjy`、`status`、`children`（叶子是空数组），没有 `id`。指标的 `bz` 是统计范围"城区"或"全域"，分类是 `null`。城市体检评估的指标另有 `result`、`reason`（没有时是空字符串），`status` 只见"未处理""已完成"；综合分析指标没有 `result`、`reason`，`status` 都是空字符串 |
| `sfjy` | 城市体检评估的指标是布尔 `false`；分类和综合分析指标的指标是字符串 `"false"`。旧页面用 `Boolean(sfjy)`，综合分析指标被全部禁用 |
| 空分类 | 综合分析指标里"福利设施普惠性"（`C02`）是没有下级的二级分类，`bz` 为 `null`；旧页面把它当成指标显示 |
| `GET /api/analysis/tree/out` | 结构同上，只有 `id`、`dm`、`mc`、`jb`、`bz`、`result`、`children`；指标的 `id` 是 32 位十六进制，给 `indicate` 用。同一个分类在顶层重复出现（南京 2025 年有 32 个顶层分类，去重后 5 个），指标不重复。这一年、这个范围没有成果时 `data` 是 `null`，综合分析指标是空数组 |
| 有成果的范围 | 只有 2025 年：南京、无锡、徐州、常州、苏州、南通、连云港、淮安、盐城各 31～32 个城市体检评估指标；扬州、镇江、泰州、宿迁、全省和区县都没有，综合分析指标都没有 |
| `POST /api/analysis/verify`，`{ year, regionCode, analysisCode }` | `data` 是布尔，所选指标里有一个已有结果就是 `true` |
| `GET /api/analysis/progress?year=&regionCode=&analysisCode=` | 没有这次计算时 `data` 是 `null`；有时是 `{ total, select, year, calculate_data: [{ code, name, result }], calculate, status, ratio }`，`result` 写成"分析结果:40.04%"，`status` 如"已处理完成"，`ratio` 是 0～100 的数。`total`、`select`、`year`、`calculate` 是说明文字，和指标行重复，不用 |
| `GET /api/analysis/indicate?id=` | `{ id, result, layers: [{ gdbName, chineseName, type }] }`；`result` 如"40.04%"，没有"分析结果:"前缀；`type` 只有 `POINT`、`LINE`、`POLYGON`（旧代码另读的 `geomType` 不存在）。区划范围是"城区范围面"（`cqjcfwa`）或"城市范围面"（`xzq`），没有旧代码判断的 `urban`；同一指标里图层名不重复。三个城市的 96 个成果都请求成功 |
| `GET /api/analysis/mvt/{id}/{gdbName}/{z}/{x}/{y}.pbf` | 三个城市的 96 个成果都返回 HTTP 200 加 JSON 信封 `code 40000 "目录不存在: D:\zykj\data\analysis\…"`，后端没有成果数据；不带 token 也是同样的返回，瓦片是否要鉴权没法确认 |

后端的问题（不为它们调整方案）：成果瓦片的目录不存在，地图上看不到任何指标图层，只能看到成果面板和定位；瓦片失败按数据源错误处理（ADR 0041），不影响页面。

## 城市国土空间监测指标：与旧页面的差异

用户 2026-10-28 在 `/dev/monitoring-indicators` 确认了布局和下面的取舍。

- 布局沿用现状底图的画布：左侧 320 宽的"监测指标"面板（标题栏切换"指标计算 / 指标展示"，可收成竖条），计算页签的进度在地图底部中间，展示页签的成果在右上，右下是视图控件和底图卡片
- 图例并进成果面板：每个子图层一行，复选框控制显隐，色块就是图例，点开取色，改过的可以恢复默认（ADR 0044 的取色规则）；改色不持久化，换指标就清掉
- 不迁移：只弹"开发中"的"设置"和"点击查看详情"，走不到的图层同步和 `/api/analysis/layer`，进度摘要里和表格重复的"已选指标""数据总量"；新加"监测范围"
- 底图用底图卡片（可以选无底图），代替"底图"复选框；行政区默认省、市、县界都显示；两者都不记偏好
- 地名注记和行政区边界压在指标图层上面，不被不透明的区划范围面盖住
- 页面不缓存，离开就停止查进度（旧页面也是）；回来时计算树上的状态标签就是各指标的进度
- 窄屏（小于 1200）时指标面板和底图、成果、进度只显示最后操作的一边，开始计算会把指标面板收成竖条（旧页面没有窄屏适配）
- 切到指标展示不会自动刷新展示树，刚算完的指标要点刷新（同旧页面）
- 监测范围用新项目的区划目录（ADR 0036），不用 `region.js`
- 按实测：`sfjy` 按真假值解析，综合分析指标不再被全部禁用；没有下级、没有统计范围的空分类不显示；进度结果去掉"分析结果:"前缀显示；成果的几何类型读 `type`，区划范围按"范围面"结尾的名称判断

## 系统管理与消息中心：接口实测（2026-10-27）

浏览器面板里已登录的管理员会话，经本机开发服务的 `/backend` 代理只读请求；审核、已读、全部已读、申请下载都没有调用。

旧代码里实际不用的：`ResourceAuditDialog`、`DownloadProgressDialog` 没有被引用；`downloadTaskService` 的任务全来自 `state.js` 的模拟数据，`attachRelatedTask` 对真实申请什么也不做；`resourceApplyService` 的提交、审核和 `messageService` 的 `push*` 只服务模拟流程；`/api/message/{id}` 详情、删除没有调用方。管理员文案"申核通过"是错别字。

| 接口 | 实测 |
|---|---|
| `POST /api/message/list`，传 `{}` | `data` 直接是数组，505 条、约 225 KB，按 `createTime` 倒序；`pageNum`、`pageSize` 被忽略；`isRead: 'false'` / `'true'` 的过滤有效（135 / 370 条）。没有未读数接口 |
| 消息字段 | 全部记录同一组键；`isRead` 只见字符串；`category` 为 `table` 497、`resource` 7、`approval` 1；`taskStatus` 只有 `pending`、`approved`、`rejected`、`null`；`priority` 全为 0；`createTime` 是本地时间字符串 |
| 消息与申请 | 没有 `applyId`，`taskId` 就是申请的 `apply_id`（三条用详情接口对上了）。"申请已过期"通知的 `taskStatus` 是 `rejected`，对应的申请却是审核通过、准备超时 |
| `POST /api/apply/list` | 标准分页，共 35 条；没有值的字段整个键都不出现（不是 `null`）。`status`、`taskStatus`、`applyName`（模糊）都生效。页码越界时改成最后一页并返回那一页（请求 99 页，返回 `pageNum` 2）；没有数据时原样返回请求的页码，`pages` 是 0 |
| 申请的状态 | `approved` 21、`pending` 1、`table` 13，没有 `rejected`；`storage_status` 只见 `timeout` 或没有，没有 `success`，下载无法用真实数据验证 |
| `status: 'table'` | 13 条是基本统计的任务，没有图层、区划和用途；其中一条的 `apply_id` 等于用户 ID，没有名称和时间 |
| 时间 | 申请的 `create_time`、`start_date`、`end_date` 是带 `+00:00` 的 ISO 串；消息的 `createTime` 是北京时间的字符串（同一条申请 03:29Z 对应消息里的 11:29），申请的时间也按北京时间显示 |
| `GET /api/apply/{id}` | 结构同列表行；ID 不存在时 `code 200`、`data: null` |
| `POST /statistics/page` | 0 条（但有 497 条报表通知），报表列表和下载契约没有真实样本；字段按旧页面读的写（`id`、`name`、`year`、`startTime`、`finishTime`、`status`），待联调核对 |
| `GET /statistics/download?id=不存在` | HTTP 200 加 JSON 信封 `code 40000 "任务不存在"` |

后端的问题（不为它们调整方案）：审批提醒正文是"nullnull于…"，申请人为空；待审核的申请没有 `user_name`，审核列表的申请人列显示"-"；消息列表不分页、没有未读数接口，未读角标只能取 `isRead: 'false'` 的整个列表；全部已读的接口没有参数，后端改当前账号的全部消息，做不到 ADR 0093 的"之后到达的新消息保持未读"；统计任务混在申请表里。

## 资源管理：附属服务、自助取数、下载申请（2026-10-27）

基线 `master-demo` 的 `b4f3987`；下面的旧路径和上表记的 `6b4799b` 相同，可以继续用 `git diff 6b4799b..master-demo` 查看新改动。

| 能力 | 旧路径 | 新位置 |
|---|---|---|
| 地图服务、数据接口 | `src/views/resource-management-new/components/LayerTable.vue`、`MapService*Dialog.vue`、`DataInterface*Dialog.vue`、`composables/useLayerServices.js` | `features/resource-management` 的 `layer-services.ts`、`store.ts`、`useLayerServices`、`ResourceServiceDialogs` |
| 自助取数 | `src/views/resource-center/components/qushu/`、`src/views/knowledge-graph-enterprise/`（`QushuGraphPanel.vue`、`data/data.json`、`utils/graphData.js`、`utils/graphExpandManager.js`、`utils/useEnterpriseGraph.js` 的布局部分）、`src/services/resource-center/qushuService.js` | `features/resource-management/extraction`、`useDataExtraction`、`DataExtractionDialog`、`KnowledgeGraphChart` |
| 下载申请 | `src/components/resource-application/ResourceApplyDialog.vue`、`src/services/resource-application/applyApiService.js` 的 `createApplication`、`src/api/apply/apply-api.js` | `application-form.ts`、`useDataApplication`、`DataApplicationDialog` |

与旧页面的差异：关系图改用 ECharts，名称在节点外、字号固定（ADR 0089）；两段搜索合成一次（结果相同）；"开始取数"同样没有接口。下载申请的图层对不上时留空、默认结束时间加一个月（用户 2026-10-27 确认），不再悄悄选学校点层。不迁移：独立知识图谱页的管理、展开、多选、导出、图例筛选；申请列表、审批与文件下载（属于申请列表和系统管理）。

## 资源管理：R5 与 UI 一致性修复（2026-10-21）

资源管理分支已快进同步 `ae65ef6`；UI 修复独立提交 `c2289f4`，统一目录操作显隐、公共删除确认、湿地 / 国家公园图标及列表分页（默认 20 条），保留 ADR 0076。旧代码基线仍为 `6b4799b922efb2ed276cc28122fbe78527234b75`，未处理旧工作区修改。

R5 按用户最新确认直接打开文件选择器，不增加导入弹窗或停止等待。复用 shared HTTP 上传能力，POST 单个 file、可选详情 year，不添加图层 ID；提供已知校验、防重复、编辑互斥、发送 / 处理状态、成功后列表 / 详情 / 年份刷新及会话保护。用户仅有 5.xlsx 样本，明确允许先沿用旧版成功 code 逻辑；未知 data 丢弃，不推断部分成功。模板样本已只读检查，未上传、未加入仓库；大小上限、年份要求、图层匹配、追加 / 覆盖、影响范围与响应仍需真实联调。

117 项相关单元测试、22 项固定接口产物冒烟、六尺寸布局、类型 / lint / 公网及内网构建通过。真实 multipart 字段与文件内容、100% 后等待服务端已在本机固定接口验证，不等于真实后端联调通过。变更与证据见 [资源管理模块](modules/resource-management.md) 末尾；UI 修复和 R5 分开提交，交原验收会话独立复测，不自行合入 main。上表 R1～R4 的等待描述保留为历史记录，本节是最新进度。

最终调整：R5 提交 `3c1472b` 后，导入入口精简为标题后的无图标 link「导入」，提示「支持 .xlsx、.xls」，启停开关去掉内部文字。本次 80 项资源管理单元测试、16 项资源管理生产冒烟、六尺寸实测、类型 / lint / 两种构建通过；按用户本轮条件指示，R1～R5 前端迁移阶段性验收收尾。真实后端未知契约继续保留为联调待办，合入前独立复测与 main 合入仍由用户协调。

## 文件管理：阶段六补完基线（2026-10-21）

- 新项目共同起点：`9023f3fcb37b80555e4595dcbcf6f508fc9a47fe`；分支 `codex/migrate-file-management`，使用独立受管理 worktree
- 本轮旧项目基线：`master-demo` 的 `6b4799b922efb2ed276cc28122fbe78527234b75`（2026-10-14）；阶段三的 `836f03b` 记录保留。对比两次基线，文件管理页面、相关组件、文件接口与分类配置无变化
- 读取提交内容，不使用旧工作目录未提交改动；旧仓库 `.claude/launch.json` 的删除与 `package.json` 的修改均未处理
- 已核对实际入口、权限、参数和类型；公共基础已实现，接口说明及待验证项见 [公共文件传输](modules/file-transfer.md)

| 核对项 | 结论 |
|---|---|
| 权限 | 旧角色表允许 admin、user 访问文件管理，页面未另设上传、查看、下载、删除的按钮权限；新路由仍允许所有已登录用户。资源管理及 Excel 导入入口仅管理员可访问；后端权限需实测，不能由前端推断 |
| 上传 | 真实调用来自 UploadFileManagementDialog 的原生 XHR，`POST /file/upload`；一次 FormData 重复追加 `files`，并传 `year`、叶子 `categoryId`、`tag`，备注非空时传 `remark`；没有类型、数量、大小限制 |
| 上传人 | 旧弹窗必填但未传给后端；列表使用 createdName。2026-10-21 用户确认新上传弹窗不展示“上传人”，不提交该字段，列表列保持现状 |
| 下载与预览 | FileManagementContent 用 fetch 请求 `GET /file/download?objectKey=…`，自行附带 token；声明的 `downloadFile`、`previewFile` 和 `uploadFileBatch` 没有被文件管理实际调用，`/file/preview` 不迁移为新的取流路径 |
| 预览格式 | DOCX 用 docx-preview 弹窗；PDF、PNG、JPG、JPEG、GIF、WebP、BMP、TXT 用 Blob 新标签页；其他格式没有查看入口，不扩展为全部 Office |
| 业务配置 | 15 个叶子分类、11 个业务标签留在 file-management；分类树、筛选、列表、分页和删除保留阶段三的新实现 |
| Excel 导入参照 | `views/resource-management-new/components/LayerDetailPanel.vue` → `api/resource-manage-service.js` → `resource-manage-api.js`；`POST /resource-management/layer/create-attribute-by-excel`，FormData 的 `file` 与可选 `year`，选择器接受 `.xlsx,.xls`；没有 layerId 参数，成功后刷新属性表 |

待真实接口核对：上传成功与失败的返回结构、批量上传是否可能部分成功、下载响应头/失败体与实际权限；不得把旧代码的兜底推断当成实测。2026-10-21 用户说明后端不可达，明确同意上传暂按“仅判断 code”实现：公共 HTTP 检查 `code === 200`，feature 丢弃未知 data，不报告成功数量或推断部分成功。该临时决定仅用于文件上传，后端恢复后再收紧 schema；未向真实后端提交测试文件。

本轮进展：公共基础独立提交 `d8cdf8ece9fb1db97a7ab3517a1b7b48bfe6e045`，包含 FormData 上传进度、二进制取流、文件名/MIME 与错误识别、取消和浏览器保存；119 项回归测试、4 项浏览器测试、类型检查、lint 与构建通过，详见 [公共文件传输](modules/file-transfer.md)。上传真实组件原型已提供 `/dev/file-management` 与本 worktree 的离线 HTML，首轮完成 7 个尺寸检查、6 项路由测试、内网构建及 4 项生产冒烟。用户要求蓝色标题竖条、关闭清空后接受原型，已调整并复用到正式上传；请求、防重复、进度、成功刷新及会话边界已接入，验证限制与记录见 [文件管理](modules/file-management.md)。未合并 main，未更改资源管理分支。

下载与预览交互原型（2026-10-21）：扩展 `/dev/file-management` 并导出离线 `file-transfer-preview.html`，提供独立下载进度/取消/重试及统一预览弹窗；支持范围沿用上表。原型完成 6 个尺寸、74 项相关测试及构建检查，随后用户接受统一容器并允许 docx-preview。

正式下载与预览（2026-10-21）：已复用公共取流并接入正式列表。下载按文件独立取消，预览用 LatestController，关闭/换目标/卸载/换会话释放内容，晚到结果不得保存或覆盖。DOCX 精确安装 0.4.1 并按需加载，PDF/图片/TXT 使用浏览器能力，未扩展 Office 格式，见 [ADR 0075](adr/0075-file-transfer-and-preview.md)。175 项单元/组件测试、2 项真实 DOCX 浏览器测试、4 项内网产物冒烟及类型检查、lint、公网/内网构建通过；5 个实际尺寸检查自建 DOCX/PDF/PNG/TXT、异常状态、长文件名、窄屏、缩放与弹窗关闭。修复窄屏操作列遮住文件名、旧图片 load 改写新图片尺寸、普通 HTTP 内网缺少 randomUUID 时读取失败。真实后端、复杂业务文件排版与其他图片编码仍待验收，具体限制见 [模块记录](modules/file-management.md)。

交互调整（2026-10-21，已确认并接入）：下载区默认收起且仅手动展开，状态与统一操作按钮同一行，文件类型紧跟文件名，DOCX 去掉适宽及滚动提示、缩小加减按钮，列表固定三格操作；页面“文档”文案已统一为“文件”。正式接入通过 116 项单元/组件测试、3 项浏览器测试、6 个实际尺寸检查及类型检查、lint、公网构建，见 [模块记录](modules/file-management.md)。状态与按钮字体不同造成的 2px 错位已修复：本会话仅在公共主题新增显式使用的 button-inline 字体样式，并在 /dev/theme 验证；共享传输、默认按钮主题及依赖未改。

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

**部分 12、13 级的地类图斑瓦片为空（2026-10-14，5C.5c-3 验收时发现）**

- 直接请求 `bgdc_dltb_2022`：徐州、沭阳、涟水、苏州附近的 12、13 级瓦片返回 200、`content-length: 0`，重复请求仍为空；14、15 级有数据（每块约 45～190 KB）；南京、淮安、盐城附近的 12、13 级有数据
- 停在 12、13 级时这些地方看不到地类图斑，放大到 14 级、缩小到 11 级就正常；和前端的样式无关（恢复默认符号后一样），待和后端确认

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
- 默认样式（10 色配色板、面 0.35 的半透明填充加同色描边、线宽和点半径的插值、默认透明度 0.9）与旧项目相同；标注还没有迁移（ADR 0041）。5D.2 把默认透明度改为 1（ADR 0053 第 6 节），已经存下的透明度保留原值

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

5C.2 讨论确定（2026-10-11），5D.2 重新设计界面后更新（2026-10-15，ADR 0053 第 6 节）：

| 方面 | 旧页面 | 新页面 |
|---|---|---|
| 排序 | 在树里同级排序（上移、下移、长按 320 ms 拖动），分类也能移动；叠放顺序是树展开后的顺序 | 目录树只负责浏览和勾选，同一分类下可以拖动调整展示顺序（单独记住，不影响叠放，搜索时不能拖）；"已勾选"区按叠放顺序列出勾选的资源，在这里拖动，可以跨分类；两处都只能按住手柄拖，手柄也能用上下方向键移动（SortableJS，ADR 0054）。2026-10-28 起两处都有上移、下移按钮，树里的手柄移到复选框前面（ADR 0096） |
| 透明度 | 勾选的资源在树里点开滑块，默认 0.9 | 在"已勾选"区点开不带刻度的滑块，显示百分比，默认 100% |
| 搜索 | 分类名称命中时只留下同样命中的子节点（子节点都不命中时显示空分类） | 分类名称命中时留下它的全部资源；勾选分类只作用于显示出来的资源（旧页面会连同被过滤掉的一起勾选） |
| 提示 | 没有 | 名称后面一个状态图标，只显示最严重的（配置错误 > 有瓦片加载失败 > 放大至第 N 级显示），悬停时列出全部（ADR 0041、0059） |
| 空分类 | 显示 | 不显示（真实数据里公共库、主题库下都是空分类） |
| 页签与年份 | "主节点""统计报表""分节点资源"三个页签，后两个只有"暂无数据"；年份下拉只是入口、不生效 | 三个页签放在标题后面，后两个仍是"暂无数据"的占位（5D.2）；年份在 5C.8，"批量设置年份"和搜索同一行，"已勾选"的年份在名称前面 |
| 几何图标 | 点、线、面三种 PNG | 点、线、面三个线性图标（Tabler Icons，5D.2）；"已勾选"不显示 |
| 宽度 | 370 | 320（面板型侧栏的档位，`page-layout.md`） |
| 目录与"已勾选"的高度 | 没有"已勾选"区 | 中间的分割线可以拖动（也能用上下方向键），位置记住；都放得下时面板按内容变矮，目录收起时多出的高度给"已勾选"（ADR 0060） |
| 收起 | 可以收起 | 收起后是左上角的竖条，收起状态记住；窄屏时和右侧面板只显示一边（ADR 0053 第 8 节） |
| 取消勾选 | 在树里取消 | 也可以点"已勾选"行末的 × |
| 排序的保存 | localStorage，按角色和用户 ID 区分，只存排序 | IndexedDB，按登录名区分；勾选、透明度、顺序、年份都记住，底图和边界也记住（5C.3，ADR 0042） |

## 现状底图：符号编辑与旧页面的差异

5C.5a、5C.5b（2026-10-12），界面在 5D 再设计：

| 方面 | 旧页面 | 新页面 |
|---|---|---|
| 保存 | localStorage，按角色和用户 ID 区分；首次加载时把更早的地类配色迁进来 | IndexedDB 的 `resource-symbols`，按登录名区分（ADR 0042）；旧的 localStorage 覆盖和"首次迁移旧配色"都不迁移 |
| 覆盖 | 只记和默认不同的字段，直接比较字符串 | 只记和默认不同的字段，颜色规范化成 `rgba(r, g, b, a)` 后比较和保存，自定义大小按步长取整 |
| 颜色选择器 | 自己写的 `SymbolColorPicker` | `ElColorPicker`（带透明度、预设色为配色板加黑白），不允许清空 |
| 拖动调色 | 实时预览，写入有防抖，停顿超过防抖就存下了没确认的颜色 | 拖动只是预览，不写入覆盖；确认时写入并保存；按 Esc、点外面时回到原来的颜色 |
| 自定义大小 | 输入框，`change` 时提交 | 回车或失焦时确认，不合法的值不提交，留在输入框里提示范围；和当前档位像素相同时不提交 |
| 恢复默认 | 单个图层、单个分组、分类项、全部（全部有确认框） | 单个取值、单个资源（连同样式方式）、全部（全部有确认框）；一个资源只有一种几何，旧页面的"分组"就是资源 |
| 样式方式 | 按几何分组保存，默认分类样式；选了统一样式也算改过 | 同旧页面，只记"统一样式"；两种方式的覆盖都保留 |
| 分类样式的取值 | 平铺列表，上方搜索框加分组下拉（三调工作分类、现状土地分类），每组只展开一个编辑器 | 按取值配色的直接列出；地类沿用 5C.4 的地类图例（现状分类 A.1、工作分类 A.2、全部，搜索，分组展开），点一个地类展开编辑器，同一时间只展开一个 |
| 分类的组合 | `combineValues`：缩放放在最外层，实线用 `[1, 0]` | 缩放放在最外层；所有取值相同的属性不生成 `match`，面的描边和填充同色时不设描边；线型不同的取值按线型拆成多个图层，每层的线型是常量、实线不设（`[1, 0]` 会让细实线变浅，线型从不设变成按取值时 MapLibre 6.12 报错，ADR 0046） |
| 面的选项 | 填充色、10 种填充方式、纹理颜色、描边色、描边宽度、描边线型；花纹选项是固定底色上的白色线条 | 同旧页面的字段；填充方式是下拉框，选项按当前的颜色画出这种方式的样子；无填充时不显示填充色（保留着，换回来时还是原来的颜色），有花纹时才显示纹理颜色；描边宽度清空输入框不算 0；分类样式的纹理颜色默认是取值颜色加深（旧页面是取值颜色本身，叠在不透明的同色填充上看不见，ADR 0046） |
| 图例的预览 | 画出线型、粗细 | 颜色和面的花纹（SVG，和地图上的 SDF 图片同一份形状数据）；5D.5 起也画出线宽、线型、点的大小和面的描边（按参考级别的实际像素，有上限） |

## 现状底图：点选的实测（2026-10-14，5C.6a-3）

在 `/current-map` 用真实后端验收点选（ADR 0047 第 10 节），视口 1158 × 862：

| 场景 | 结果 |
|---|---|
| 全省视图点地类图斑 | 后端识别（点几何）56 ms，唯一结果直接进入详情；属性 11 ms、完整几何 293 ms；定位到 17 级，高亮和瓦片里的图斑完全重合 |
| 17 级点地类图斑 | 用渲染要素，只发详情的两个请求，相机不动 |
| 上面勾选了稀疏的拆除未尽区，17 级点在没有它的地方 | 按第 2 节先查拆除未尽区（336 ms，0 条），之后才查地类图斑的详情 |
| 村级调查区和地类图斑重叠 | 选中上层的村级调查区 |
| 城市道路线、公用设施点 | 按 8、10 像素的容差点中，按 `guid` 查到属性和完整几何；两条道路在容差内时列出候选，进入详情后定位到整条线（右边避开面板），返回列表时回到原来的视角 |
| Esc、换成"移动"、取消勾选选中的资源 | 面板关闭，会话的选择清空 |
| 9 级点村级调查区界线 | 后端识别找到 9 条，但记录没有 `guid`，显示"这里没有可查询的要素" |

分页范围查询的结果带不带 `guid` 按数据集区分，不按前缀（南京东郊约 5 公里和南京市范围、每页 1 条，每个数据集用目录里最新的年份，在浏览器里用登录会话的 token 直接请求 `/api/query/scope/geojson/page`，看第一条记录有没有 `guid`）：

| | 带 `guid` | 不带 `guid` | 范围内没有数据，未知 |
|---|---|---|---|
| `bgdc_*` | `dltb`（2022）、`dltb_czc`（2021）、`czcdyd`（2022），目录里都只有这一个年份 | `ccwjq`、`cjdcq`、`cjdcqjx`、`gfbq`、`lmfw`、`lsyd`、`ttq`、`xzq`、`xzqjx` | `czkfbj`、`fjmsq`、`gddb`、`kfyq`、`pzwjstd`、`stbhhx`、`yjjbnttb`、`zrbhd` |
| `csxhjctb_*` | `hydl`（2025）、`lvll`（2025），2022～2024 年没有实测 | 其余有数据的 37 个（如 `lctl`、`lrdl`、`gyssp`、`xxp`、`hyda`、`czzza`） | `csnljsl`、`dltbbhl`、`dxkja`、`dxkjl`、`sdza`、`swhxcwydctba` |

`csxhjctb_cqnfwjza` 和 `szy_*`、`lcsh_*`、`gtkjgh_*` 的范围查询都返回"系统异常"。不带 `guid` 的数据集按 `guid` 查属性和完整几何仍然可以（村级调查区、城市道路、公用设施点已在面板里验证）。据此后端识别改为按数据集登记，二维 14 级以上以渲染要素为准（ADR 0048）。

其他发现：

- 非地类的资源没有统一的名称字段：村级调查区的名称在 `zldwmc`，副标题只有年份；城市现状数据用 `-9999` 表示没有值，名称和字段里会直接显示 `-9999`
- 面板在右列，直接点中的要素不移动相机，靠右的要素会被面板盖住
- 5D.6（2026-10-16）处理了上面两条：标题按资源取名称字段，`-9999`、`-999` 和空字符串算没有值、收在最后；直接点中的要素被面板挡住时，地图平移让它露出来（相机控制的 `reveal`）。见 roadmap 的 5D.6

按 ADR 0048 修改后复测（2026-10-14，5C.6a-4）：

| 场景 | 结果 |
|---|---|
| 9 级点村级调查区界线 | 不发识别请求，用渲染要素列出 12 条候选；选中后按 `guid` 查到属性和完整几何并定位 |
| 14.34 级，拆除未尽区或城镇村等用地（能后端识别）排在地类图斑上面，点在没有它们的地方 | 只发地类图斑详情的两个请求 |
| 13.94 级点乡村道路 | 后端识别（容差框，40 ms），唯一结果直接进入详情并定位 |
| 同一处水域线，14.05 级和 13.76 级各点一次 | 14.05 级用渲染要素列出 2 条，不发识别请求；13.76 级后端识别（338 ms）列出同样的 2 条 |

12、13 级瓦片为空的地方没有单独复现；地类图斑在 14 级以下一律后端识别，全省视图的点击已验证

## 现状底图：框选的实测（2026-10-14，5C.6b-2）

- 14 级框一片地类图斑：不发请求，列出地图上已画出的 18 个，会话选中 18 个，批量高亮跨瓦片画出完整轮廓
- 6.4 级框约 110 × 90 公里：框里有 14811 个渲染要素，但按 `guid` 去重只有 0 个（都不带 `guid`），估数没有拦下，后端统计 103.9 万个用了 16.2 s
- 地类图斑的瓦片在 14 级以下不带 `guid`（南京东郊整屏，1158 × 862）：

| 级别 | 渲染要素 | 带 `guid` | 聚合要素（`clustered`，带 `point_count`） |
|---|---|---|---|
| 8 | 190220 | 0 | 188464 |
| 9 | 200074 | 0 | 191711 |
| 10 | 170664 | 0 | 135250 |
| 11 | 92875 | 0 | 31042 |
| 12 | 33437 | 0 | 0 |
| 13 | 5587 | 0 | 0 |
| 14 | 972 | 972（829 个不同的） | 0 |

  低级别的瓦片只带 `bsm`、`dlbm`、`dlmc`（聚合要素另有 `clustered`、`point_count`）。ADR 0049 第 2 节"按 `guid` 去重估数"在 14 级以下数不出来；其他数据集低级别的瓦片带不带 `guid` 各不相同（村级调查区界线 9 级带）

按 ADR 0050 修改后复测（5C.6b-2b）：

| 场景 | 结果 |
|---|---|
| 6.4 级框约 110 × 90 公里的地类图斑 | 立刻提示"范围内约 909940 个要素，请缩小范围"，不发请求（后端统计的实际数量是 103.9 万） |
| 12 级框一小片地类图斑 | 估数不超限，后端出第一页和总数（360 ms，共 27 个） |
| 15 级框一小片地类图斑 | 不发请求，列出地图上已画出的 2 个 |

- 14 级以下后端查出的地类图斑没有批量高亮：批量高亮在瓦片上按 `guid` 过滤（ADR 0049 第 3 节），而 14 级以下的瓦片不带 `guid`，一个也匹配不到；ADR 0049 只预计了"可能有部分没有高亮"。讨论后接受只有列表，框选结果来自后端时面板提示"低级别下地图上可能看不到高亮，放大到 14 级以上可以看到"

### 验收与高亮更新的耗时（5C.6b-3，ADR 0049 第 5 节）

用合成的鼠标事件在可见的地图区域拖框，每 50 ms 数一次批量高亮图层里画出的 `guid`，从操作开始计时到数量稳定；同时记录主线程超过 50 ms 的长任务：

| 场景 | 结果 |
|---|---|
| 17 级框一片地类图斑 | 不发请求，列出 31 个，批量高亮 31 个，60 ms 画完 |
| 14 级苏州古城，框住可见的地图区域 | 不发请求，列出 1048 个，批量高亮 1048 个；松手后 117～158 ms 开始画，323～430 ms 画完；一个 64～67 ms 的长任务 |
| 同上，过滤条件补到 5000 项（合成：多出来的在瓦片上匹配不到） | 换过滤条件后 124 ms 画完，一个 56 ms 的长任务 |
| 追加 30 项（模拟加载更多） | 逐帧记录，高亮一帧都没有消失 |
| 有 1048 个或 5000 项高亮时缩放动画 | 帧间隔 p95 17 ms、最长 17 ms，和没有高亮时一样，没有超过 50 ms 的帧 |
| 进入详情、返回列表 | 详情里批量高亮收起；返回后 126 ms 开始画，460 ms 画完（含恢复视角的相机动画），没有长任务 |
| 12 级框一片 | 后端第一页 339 ms，共 435 个；加载更多 372 ms 列出 60 个，没有长任务；地图上没有批量高亮（瓦片不带 `guid`） |
| 10 级框可见的地图区域 | 678 ms 内提示"范围内约 188357 个要素，请缩小范围"，不发请求 |
| 框选后单击 | 框选的结果、会话的选择和批量高亮都清除，换成单击的结果 |

- 这个视口（1158 × 862）里 14 级可见区域的地类图斑最多约 1100 个（苏州古城 1084，无锡 724，南京新街口 561，常州 486），14 级以上实际框不到 5000 个；5000 项的过滤条件用合成的数据测
- 过滤条件里的 `guid` 必须不重复：测量时合成的数据有重复，MapLibre 报"Branch labels must be unique"，整个视图进入失败，下一版样式到来时恢复；拥有者按 `guid` 去重，不会出现
- 结论：过滤条件更新的代价可以接受，暂不需要 feature-state
- 验收中发现虚拟列表的行是响应式代理，点候选时拥有者按对象身份找不到它，已修复（按序号取列表里的原对象）

## 现状底图：区划裁剪的实测（2026-10-14，5C.7）

ADR 0051 的依据。瓦片直接请求 `/backend/api/tiles/<瓦片集>/{z}/{x}/{y}.pbf`，在浏览器里用 `@mapbox/vector-tile` 解码；查询用登录会话的 token 请求 `/api/query/scope/geojson/page`。

瓦片里能判断区划的字段（目录里 183 个瓦片集，8、11、12、14 级各取一张有要素的瓦片）：

| 数据集 | 字段 | 例外 |
|---|---|---|
| `bgdc_*` | `bsm`，各级都有，前 6 位是区县代码；地类图斑 8～11 级的聚合要素也带（代表要素的） | `bgdc_dltb_czc_2021` 14 级以下只有 `dlbm`、`qsxz`、`dlbm_20`；地类图斑、城镇村等用地 14 级起另有 `zldwdm`、`region_code` 等 |
| `csxhjctb_*` 2023 年起 | `intersect_region_code`：逗号分隔的区县代码，跨区县的要素有多个（如 `320102,320113,320104`） | 部分要素为空；`hydl_2025` 没有区划字段；`lvll_2025` 只有市级的 `region_code`（`320800`）；`lctl_2023` 11 级起没有 |
| `csxhjctb_*` 2022 年 | `areacode`（部分另有 `intersect_region_code`） | 6 个线状数据集（`hydl`、`lctl`、`llkl`、`lrdl`、`lrrl`、`lvll`）的 `areacode` 是 `320000`（全省） |
| `szy_*`、`lcsh_*`、`gtkjgh_*` | 瓦片返回"系统异常"，判断不了 | `bgdc_xzq_2024` 的瓦片返回"renderFields 非法: 面积" |

业务数据的区县代码和区划目录对照（全省 7 级地类图斑瓦片的 22.6 万个要素，`bsm` 前 6 位，对照 `shared/map/region` 目录的 95 个区县）：

- 数据里有、目录里没有：`320602`（857）、`320604`（920），2020 年合并为崇川区 `320613`，目录里的崇川区在数据里一个也没有；功能区 `320513`（苏州工业园区，473）、`320805`（284）、`320913`（461）、`321004`（164）、`321113`（448）、`321206`（248）；`329999`（115）
- 苏州工业园区（金鸡湖、园区东部）在县界里属吴中区，独墅湖属虎丘区，对应不到一个区县
- 按市（前 4 位）都对得上，`329999` 除外

后端的范围查询：

| 场景 | 结果 |
|---|---|
| 南京城区一个框，加 `xzqdm`（`320102`、`320100`、`320500`） | 总数都是 2729，和不加一样：参数被忽略 |
| 同一个框加 `conditions` | `"bsm" LIKE '320102%'` 837，`"zldwdm" LIKE '320102%'` 837，`"bsm" LIKE '320104%'` 1192；城市现状图斑 `"intersect_region_code" LIKE '%320102%'` 5（共 11） |
| 两个小框分别查、合成 `MultiPolygon` 查 | 147、32、179：接受 `MultiPolygon` |
| 带洞的 `Polygon` | 699（不带洞 805）：洞生效 |
| 几何的顶点数（坐标 6 位小数） | 100～200 个（地址 3.2～6.3 KB）正常；250 个（7.9 KB）返回 Tomcat 的 400；1000 个以上返回 431 |

- 边界数据：县界每个最多 278 个顶点（铜山区），中位数 87；市界最多约 1 万个（南京 9915，宿迁 9658，淮安 9636）
- 旧项目在 14 级探测到 `zldwdm` 后按它过滤，低级别的瓦片没有这个字段，要素会被全部过滤掉；在低级别探测时找不到字段，就一直用遮罩

### 验收（2026-10-15，5C.7c，ADR 0051 第 6 节）

在浏览器里用登录会话操作现状底图：用区划定位的拥有者选择区划，在画布上派发合成的鼠标事件单击、拖框；后端请求的几何从 Resource Timing 的地址里取出，用 `isValidPolygonal` 检查；总数用同一个框加 `conditions` 直接请求比较。只勾选了地类图斑（2022），结束后确认偏好没有变化。

| 场景 | 结果 |
|---|---|
| 选中玄武区 | 区划外的底图和地类图斑被盖住，地名注记、省界、红色轮廓在遮罩上面 |
| 玄武区，11 级，在区划里单击 / 在遮罩上单击 | 查后端用点击位置的点，选中乔木林地（`bsm` 320102…）；在遮罩上单击关闭结果，不发请求 |
| 玄武区，14.5 级，跨西边界框选 | 框里画出 379 个（玄武 115、秦淮 201、鼓楼 63），列出 117 个：玄武 114 个、秦淮 2 个、鼓楼 1 个；差的 4 个都在边界附近（县界只有 25 个顶点）。松手时的计算 21～26 ms，全省时 7～8 ms |
| 姑苏区，14 级，跨边界整屏框选 | 框里 1622 个，列出 929 个；松手时的计算 56～82 ms（第一次含预热），全省时 17～20 ms。拆开看：1815 条渲染记录取几何多 5～15 ms，逐个判断相交 26～32 ms，求交约 1 ms |
| 玄武区，12 级，跨边界框选 | 后端用求交范围（5 个坐标，框只切过县界的一条直边，有效）：548 个；框加 `"bsm" LIKE '320102%'` 541 个；整个框 2373 个 |
| 选中崇川区 | 地类图斑照常显示；和崇川区相交的 7316 个要素里 320602 有 4177 个、320604 有 2993 个，其余是边界附近邻区的；按代码 320613 过滤时一个也没有 |
| 选中吴中区 | 洞（金鸡湖、园区一带）被盖住，洞的中心点上遮罩有要素、地类图斑没有；14 级时视口里 320513（苏州工业园区）的 429 块图斑都在洞里。12 级这一带的瓦片为空（roadmap 已有的待办），区里区外都不画 |
| 南京市，12 级，跨东界框选 | 求交 21 个坐标（1.2 ms），第 0 档通过（0.2 ms）；发出的几何有效，和拥有者算的一致，地址 756 个字符；求交范围 373 个，框加 `"bsm" LIKE '3201%'` 290 个，整个框 12292 个（差的在边界附近：查询按相交，邻市挨着市界的图斑也算） |
| 南京市，12 级，跨北界框选 | 求交 482 个坐标（9.5 ms），¼ 像素简化到 90 个、有效（1.4 ms），地址 2601 个字符；北边是安徽，框里只有南京的图斑：整个框 17478 个，求交范围 17334 个，差的在边界附近（¼ 像素约 9 米的简化，以及市界和数据的出入） |
| 南通市，12 级，框整个在南通里 | 求交结果就是框（5 个坐标）：39899 个，整个框 39900 个（差 1 个来自坐标舍入）。这一带 12 级的瓦片为空，估数是 0，没有拦下约 4 万个的统计（ADR 0050 后果已写明） |
| 南通市，12 级，跨西界框选 | 求交 24 个坐标，第 0 档通过：3458 个；框加 `"bsm" LIKE '3206%'` 3344 个；整个框 22978 个 |

- "范围太复杂"在真实页面里没有遇到：地类图斑在 10 级整屏框选时先被估数拦下；其他能后端识别的数据集要勾选别的资源才能试，由单元测试覆盖
- 一次框选后列表从第 31 项开始显示（滚动位置 900），当时没能复现；原因和修复见下文"测试中发现的问题"第 2 条

## 现状底图：年份的验收（2026-10-15，5C.8c，ADR 0052 第 5 节）

在浏览器里用登录会话操作，南京城区 14 级。瓦片在 MapLibre 的 Worker 里请求，主线程的 Resource Timing 和浏览器面板的网络记录都看不到，改看会话样式里的瓦片地址和画出要素的属性（瓦片里的图层名带年份，换了年份还能画出要素，说明用的是新年份的瓦片）。临时勾选地类图斑变化面层（2022～2025）、水域线层（2022～2025）、城区内房屋建筑面层（2024、2025），结束后恢复偏好并刷新确认。

| 场景 | 结果 |
|---|---|
| 已勾选列表 | 地类图斑只显示 2022，另外三个是年份选择，选项新的在前（水域线层：2025、2024、2023、2022） |
| 界面上批量设置成 2023 | 34 个有 2023 年的资源都切过去（包括没勾选的，如城市道路、交通运输用地）；没有 2023 年的 6 个多年份资源（行政区、城区内房屋建筑面层等）保持 2025；瓦片地址换成 `_2023`，画出要素的 `sjnf` 是 2023（地类图斑变化面层这一带 2023 年 8 个、2025 年 48 个）；选择框回到"批量设置年份" |
| 图例 | 标题是"地类图斑 · 2022""城区内房屋建筑面层 · 2025""地类图斑变化面层 · 2023""水域线层 · 2023" |
| 已勾选行把水域线层改回 2025 | 只改它，其他仍是 2023；瓦片和 `sjnf` 是 2025；图例标题跟着变，展开的条目仍展开 |
| 再批量设置成 2023 | 水域线层又回到 2023 |
| 点选一块 2023 年的地类图斑变化面层 | 详情的属性和几何查询都用 `csxhjctb_dltbbha_2023`，面板显示 2023 |
| 刷新页面 | 34 个资源仍是 2023，水域线层 2023，城区内房屋建筑面层 2025，勾选和各行的年份都还原 |

- 恢复：批量设置成 2025（多年份资源的最新年份都是 2025），取消临时勾选的资源，重新勾选地类图斑；刷新后 78 个资源都是最新年份，只勾选地类图斑（2022，透明度 0.9），顺序同目录
- 面板宽 320 时"没有这一年的资源保持不变"放不下、被截掉，界面在 5D 定

## 现状底图：测试中发现的问题（2026-10-15，`stage-5c` 之后）

用户测试时提出 5 个问题和 2 项优化，都先写出复现的测试（问题 5 是浏览器测试）再修：

| 问题 | 原因 | 修复 |
|---|---|---|
| 后端识别的结果晚到，覆盖了用户随后发起的定位（默认视角、坐标定位） | 识别的相机操作在响应回来后才开始，等待期间用户的定位作废不了它 | 查后端之前就开始相机操作，后续沿用；从列表选择要素仍开始新的操作（ADR 0038、0039 的写法） |
| 连续框选保留上一轮列表的滚动位置（滚到 1200 后再框选，首个条目是第 32 项） | 单击、框选在同一轮调度里就出结果时面板不重新挂载，虚拟列表的滚动容器还是上一轮的 | 候选列表带身份 `id`：每轮识别一个新的，加载更多不变；面板在 `id` 变化时回到顶部 |
| 规划中的异常（如几何求交）没有进入失败和重试，上一轮的结果还能显示 | 先规划、后作废上一轮；规划抛错时直接抛到输入处理里 | 先作废上一轮（识别和加载更多）再规划；规划出错时显示失败，重试时用同样的输入重新规划 |
| 符号编辑器卸载后，没确认的颜色预览留在地图上 | 取色器随编辑器销毁，不会再报回确认的颜色 | 拥有者的 `clearPreview(target)` 只丢弃这个目标的预览；编辑器卸载、换了目标（按资源和取值比较）时调用，别的编辑器开始的新预览不动 |
| 切换填充方式时花纹先疏后密，持续约 300 毫秒 | MapLibre 的过渡机制，见下文"切换填充方式的闪烁" | 纹理图层的花纹不过渡 |

优化：

- 点选的规划遇到渲染要素的结果或范围太复杂时停下（同框选），同一几何类型的资源共用容差框、求交范围和整理过的几何，见下文"点选规划的耗时"
- 交互衔接补了测试：等待中的请求和别的操作交错（发起定位、规划出错、加载更多进行中开始新一轮），连续替换列表，拥有者还在而组件卸载或换了目标。`useFeaturePick` 暂不拆分

### 切换填充方式的闪烁

在浏览器测试里用真实的 MapLibre 和推导出的资源分组（数据换成内联 GeoJSON），在 `render` 事件里读回画布，逐帧数花纹的线条和覆盖率。当时后端返回 502，真实页面上的瓦片重新加载不了，没有用真实页面。

| 场景 | 结果 |
|---|---|
| 改填充色、纹理颜色（统一样式和分类样式，8.5～18.5 级，含源的最大级别 15 以上的放大瓦片） | 花纹不变；统一样式的颜色有 300 ms 的渐变，分类样式一步到位 |
| 统一样式切换花纹（斜线 → 反斜线、水平 → 紧凑网格），8.5、12.5、14.5、15.5、17.5 级 | 新瓦片到达后（约 20～80 ms）有约 280 ms 画出别的花纹（线条数减半，如 17 → 8），到 300 ms 才是新的花纹；各级别都有，不只高级别 |
| 分类样式切换花纹 | 瓦片重新加载完直接是新的花纹 |
| 均匀填充 → 花纹 | 纹理图层是新加的，瓦片加载完才出现，没有错误的帧 |

原因（MapLibre 6.12 的源码）：

- 改 `fill-pattern` 会重新加载这个数据源的瓦片（`StyleLayer.setPaintProperty` 对交叉淡入类属性返回需要重新布局），新瓦片的图集里只有新图片
- paint 属性默认有 300 ms 的过渡，改任何一个 paint 属性都会让这个图层的全部属性重新开始过渡；交叉淡入类属性的"插值"直接返回过渡前的值（`CrossFadedDataDrivenProperty.interpolate`），所以这 300 ms 里取的还是旧图片的 ID
- 绘制时在瓦片的图集里找不到旧图片（`updatePatternPositionsInProgram`），就不更新图集位置，用旧图集的坐标去采样新图集，画出的是别的图片
- 按要素取值的表达式不做过渡（`TransitioningPropertyValue` 遇到按要素取值的直接用新值），所以分类样式不受影响

修复：纹理图层设 `'fill-pattern-transition': { duration: 0, delay: 0 }`，只取消花纹的过渡，颜色的渐变不变。修复后每一帧要么是原来的花纹（瓦片重新加载完之前，约 20～80 ms），要么直接是新的花纹。这段时间是 Worker 重新解析瓦片、把新图片放进图集的耗时，要消除只能让图片 ID 不变、用 `updateImage` 原地换像素，违背 ADR 0045 的"图片只和形状有关"，不值得。回归测试在 `app/resource-layers.browser.test.ts`（去掉这一项时 20 帧里有 16 帧画错）。

### 点选规划的耗时

12 级在南京市界（约 1 万个顶点）北界附近单击：2 个能查后端的线资源，加若干个只用渲染要素的线、点资源；渲染要素为空，每个资源都要规划。30 次的中位数：

| 资源数 | 优化前 | 优化后 |
|---|---|---|
| 2 | 2.2 ms | 1.4 ms |
| 6 | 4.6 ms | 1.9 ms |
| 12 | 6.8 ms | 1.4 ms |
| 22 | 12.2 ms | 1.4 ms |

优化前每个线、点资源都要和市界求交一次（`bboxClip` 遍历全部顶点，约 0.5 ms），查后端的资源还各整理一次几何。没有加跨操作的缓存。

## 现状底图：地图浮层与旧页面的差异（2026-10-16，5D.7）

ADR 0055 改了这些和旧项目不同的地方：

- 测量的单位：旧项目距离固定用 km、两位小数，面积满 1 km² 用 km²、否则用 m² 两位小数；现在不到 1 km 用米、取整，不到 1 km² 用 m²、取整加千分位
- 测量的标签：测面的总面积放在形心正中（旧项目从形心向右排）；靠近画布右边的标签放到节点左边
- 鼠标旁的提示：画的过程中多了一行含鼠标所在点的长度或面积，操作说明加了"Esc 取消"；靠近画布边时翻到另一侧
- 选中区划：旧项目在区划中心放名称标签（ADR 0036 没有迁移），现在是地图上方的区划条，带"回到全省"
- 位置点（旧项目只有占位按钮，ADR 0037）：位置信息限制在没被面板挡住的区域里，带指向图钉的小三角

## 底图：天地图实测（2026-10-10）

5B.1 的依据（ADR 0031），从本机直接请求：

- 天地图 `vec`、`cva`、`img`、`cia`（`_w` 球面墨卡托）的有效级别是 1～18；0 级和 19 级也返回 200，内容是占位图（`img` 的 0 级和 19 级同为 4769 字节），所以数据源设 `minzoom: 1`、`maxzoom: 18`
- 返回头有 `Access-Control-Allow-Origin: *`、`Cache-Control: max-age=432000`（5 天）；key 不对时返回 418；不带 Referer 也能取到瓦片，这个 key 可能没有设域名白名单（待确认，见 roadmap）
- 旧项目的内网影像 `http://192.168.1.180:8080/tiles/{z}/{x}/{y}.jpg` 只有 1～9 级（10 级以上全部 404），9 级覆盖约 90.7～135.7°E、20～52.9°N；用户决定改用天地图影像，不迁移
- 旧项目提交 `d768c66` 的天地图开关：关闭时底图样式里不放天地图数据源，区划边界只用本地 GeoJSON、天地图行政区接口直接抛错；同一提交把现状底图的默认选择从"无底图"改回"矢量底图"。新项目用 `appConfig.tianditu`（关闭时为 `null`）和内网构建模式实现同样的语义，5B.2 的边界、5B.5 的区划定位沿用
- 旧项目的 `auth-service` 把 `t0`～`t7.tianditu.gov.cn` 排除在加 token 的范围之外：以后给瓦片请求加 token 时只给同源请求加，不能把登录 token 发给天地图
