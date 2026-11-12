---
paths:
  - "apps/yzt/src/features/resource-map/**"
  - "apps/yzt/src/pages/current-map/**"
  - "apps/yzt/src/pages/dev/{resources,map-ui}/**"
  - "apps/yzt/src/app/resource-layers*"
  - "apps/yzt/tools/probe-resource-classes/**"
  - "apps/yzt/tools/symbol-defaults/**"
---

# 现状底图的资源图层

- 资源的年份是按 `code` 的显示状态：单个资源用拥有者的 `setYear`，批量用 `setYearForAll`（有这一年的资源不论是否勾选都切过去），不另存"当前年份"；拥有者记下的最后一次批量设置的年份（`batchYear`）只给选择框回显，不参与推导，也不代替各资源的年份（ADR 0116）；界面条目的身份、名称和符号按 `code`，年份作为单独的字段显示（ADR 0052）
- 资源按属性分类按 ADR 0123：取值、名称、颜色写在 `features/resource-map/class-dictionaries.ts`，`style-registry.ts` 按 `code` 登记字段和字典，一个资源一行；取值是符号覆盖的键，改名称不影响已保存的覆盖。图例和地图都只用资源实际有的类别，地类规则用 `only` 列出（ADR 0124），不只在图例里过滤。新的分类先用 `probe:resource-classes` 探查、人工确认，前端不统计瓦片（ADR 0043）
- 资源的最小显示级别按 ADR 0132、0137：层级写在 `features/resource-map/resource-min-zooms.json`，是单张瓦片 6 MB 的实测结果（`probe:resource-classes --tile-cost`，换后端环境或重新切片后重测），脚本的 `ZOOM_FLOORS` 和它一致；这个文件构建时带上一份，同时复制到发布目录，部署时换它、刷新页面就生效，读不到或不合法时用带上的那份，确定的值要同步回仓库（`docs/deployment.md`）；村级调查区、界线、路面范围第一次请求很慢，定 8 级，不按实测放开（ADR 0136）；数据源和图层用同一个级别，只给图层设时瓦片失败会一路请求更低的级别。`VITE_RESOURCE_MIN_ZOOM_ENABLED=false` 时不限制、不读文件，只用于排查和应急；提示、瓦片请求和点选都从目录的 `resource.minzoom` 取值，不单独读开关
- 发布的默认符号按 ADR 0154：`features/resource-map/resource-symbol-defaults.json` 叠加在算出的默认符号上，用户的覆盖再叠加在它上面；只由 `symbols:import` 写入（控制台片段导出、导入、提交，步骤见 `docs/modules/storage.md`），不手改。不能改偏好的版本号和 `storedSymbolsSchema` 的格式，否则别人存下的样式会被当作没存过、下次改动时整条覆盖；样式方式的推导和整理用资源的默认方式（`defaultSymbolMode`），拥有者保存、恢复、预览时都要传。其他测试里这份数据换成空的（`src/test-setup.ts`），断言按代码算出的默认符号；导出文件含登录名，只放 `local/`
- 现状底图已确认的界面细节（已选择图层区域、透明度浮层、图例的浏览与编辑、功能容器与标签、底图 Popover、地图 Tooltip、区划定位、标题栏底色）记在 `docs/design/current-map-reference.md` 的"已确认的界面细节"，改这些界面前先读，用户确认新的调整后同步更新那里
