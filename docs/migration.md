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
| 现状底图与公共地图能力 | `836f03b` | `src/views/current-map-new/`（页面、图层面板、地图控制栏、图例、详情面板；`cesium/` 与 `composables/useEngineSwitch.js` 归三维阶段）；`src/components/CommonMap/`（`MapContainer`、`MapService` 与底图、边界、业务图层、测量、点选、绘制、符号与地类配色）；`src/assets/LayerManager.ts`；`src/services/map-tree/`（图层树接口、规范化、样式登记表、静态节点）；`src/stores/mapTree.js`；`src/components/toolbar/`（工具栏、区划定位面板）；`src/components/map/map-configs.js`；`src/api/resource/resource-map-api.js`；`src/views/current-map/utils/MapStaticBoundaryManager.js` | `libs/map-vue`、`shared/map`、`features/*`、`pages/current-map`（分层在 5A.1 的 ADR 中确定） | 5A 完成：map-vue（`provideMap`、样式绑定、`MapCanvas`、`useMap`、定位可视区域、失败提示）与现状底图的联调骨架，旧代码还没有迁移；底图、边界、工具在 5B，资源图层、面板、图例、点选在 5C，界面在 5D。5A 结束时 `master-demo` 仍是 `836f03b`。不迁移：接口失败时回退的本地快照 `src/assets/tree-data.ts`、三区三线的占位节点。5B.1 完成：底图（`BaseLayerManager`、`MapControlBar` 的底图部分、提交 `d768c66` 的天地图开关）迁到 `shared/map/basemap`，矢量、影像都用天地图（ADR 0031），内网部署用 `pnpm build:intranet`（ADR 0032）；不迁移 `static-nodes.js` 里的内网影像（`192.168.1.180:8080`）和没用到的 `osm-tiles` 数据源。5B.2 完成：省、市、县界（`BoundaryManager` 的静态边界、`MapStaticBoundaryManager`、`TiandituBoundaryLayer` 的画线部分、`MapControlBar` 的行政区部分）与默认视角（`MapViewManager.goToDefaultView`）迁到 `shared/map`（ADR 0033）；边界数据由转换脚本从 `public/static/geojson` 生成。区划定位、区划高亮、天地图行政区接口在 5B.5，区划裁剪在 5C.7 |
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

## 底图：天地图实测（2026-10-10）

5B.1 的依据（ADR 0031），从本机直接请求：

- 天地图 `vec`、`cva`、`img`、`cia`（`_w` 球面墨卡托）的有效级别是 1～18；0 级和 19 级也返回 200，内容是占位图（`img` 的 0 级和 19 级同为 4769 字节），所以数据源设 `minzoom: 1`、`maxzoom: 18`
- 返回头有 `Access-Control-Allow-Origin: *`、`Cache-Control: max-age=432000`（5 天）；key 不对时返回 418；不带 Referer 也能取到瓦片，这个 key 可能没有设域名白名单（待确认，见 roadmap）
- 旧项目的内网影像 `http://192.168.1.180:8080/tiles/{z}/{x}/{y}.jpg` 只有 1～9 级（10 级以上全部 404），9 级覆盖约 90.7～135.7°E、20～52.9°N；用户决定改用天地图影像，不迁移
- 旧项目提交 `d768c66` 的天地图开关：关闭时底图样式里不放天地图数据源，区划边界只用本地 GeoJSON、天地图行政区接口直接抛错；同一提交把现状底图的默认选择从"无底图"改回"矢量底图"。新项目用 `appConfig.tianditu`（关闭时为 `null`）和内网构建模式实现同样的语义，5B.2 的边界、5B.5 的区划定位沿用
- 旧项目的 `auth-service` 把 `t0`～`t7.tianditu.gov.cn` 排除在加 token 的范围之外：以后给瓦片请求加 token 时只给同源请求加，不能把登录 token 发给天地图
