# 数据查询（features/data-query）

对应目录：`apps/web/src/features/data-query/`、`apps/web/src/pages/data-query/`；决策见 [ADR 0104](../adr/0104-data-query-migration.md)，迁移记录见 [migration.md](../migration.md)"数据查询"。

查询统计菜单下的四个页面共用 `DataQueryPage`，专题由路由的 `props` 给出（`topic`）。实测页 `/dev/data-query` 挂真实页面、请求真实接口（查询接口不校验登录）。

## 结构

```
topics.ts            四个专题：标题、图层（表名、几何类型、瓦片图层名、条件字段、结果列）、自然语言的示例和规则
layer-fields.ts      条件字段：地类编码表只写一份，学校、医疗机构的点层和面层共用一套字段
conditions.ts        条件拼 SQL、高级查询的 SQL 解析、自然语言的规则匹配（纯函数）
api.ts / queries.ts  结果的一页、命中的要素、导出；QueryRequest 描述一次查询
result-layers.ts     预览（query-preview）和结果（query-result）的样式分组（纯函数）
composables/
  useDataQuery       编排：页签、提交、重置、预览分组；创建下面这些拥有者
  useAttributeForm   属性查询的表单（自然语言也回填到这里）
  useSpatialForm     空间查询的图层和范围；范围来自 shared/map/draw 的绘制工具或上传的 shp
  useAdvancedForm    高级查询：点击插入、可以直接改的 SQL
  useNaturalLanguage 模拟解析：等 2 秒、按规则匹配；作废表示成结果，不抛错
  useQueryResult     最后一次提交的查询：结果表（usePagedList）、命中的要素、定位、第一个结果
  useQueryExport     导出最后一次成功的查询
components/          查询面板（外壳、查询方式的按钮组和四种方式的表单）、结果面板、导出按钮、提示文案
```

## 规则

- 一次查询是一个 `QueryRequest`：属性类（属性、自然语言、高级查询，`origin` 区分）按行政区划和条件；`geometry` 是画的范围（整理过的 GeoJSON 字符串和外包框）；`shp` 带上传的文件和每次选文件加 1 的 `fileId`（File 序列化后是空对象，查询缓存按 `fileId` 区分）
- 提交时结果表回到第 1 页，同一个查询再提交时重新请求（`usePagedList` 的规则）；翻页只保留同一次查询的上一页，换了查询不保留（列不同）
- 提示由面板给出：`submit()` 返回结果对象（不能查询的原因、画完没选图层、没有识别、被作废），每次查询的第一个结果（`outcome`）报空间查询画了几个、自然语言查询成功；结果表的加载失败由表格的 `TableLoadError` 显示，不弹全局提示
- 定位在下一次渲染之后：结果面板这时已挂上，`useMapOverlay` 登记的悬浮元素都能量到。属性类定位到行政区划（全省用江苏的范围），画的范围按外包框放大一倍，shp 等命中的要素到了按它们的范围；最大 14 级
- 面板与结果的排布（ADR 0112，参考旧页面）：标题下面是查询方式的按钮组（`radio-group-block`）；"添加查询条件""显示 SQL 语句"是整行的描边按钮；底栏查询在前、重置在后，各占一半。查询面板和结果在同一列，结果从左边开始，有结果时面板让出结果的高度、表单在面板内滚动，结果最大化时面板不显示
- 2026-10-30（ADR 0119）：高级查询暂时隐藏，按钮组只有属性查询、空间查询、自然语言查询（`SHOWN_QUERY_TABS` 过滤，`QUERY_TABS`、表单、提交、导出的逻辑都保留）；地图控制和底图卡移到右上角（一行，底图卡在控制左边、顶部对齐），结果横跨整页、不再给底图卡让位，最大化时从控制下面开始
- 页签切换：属性查询和自然语言查询共用结果，其余切换清掉结果；离开空间查询时结束绘制、清掉画的范围；离开自然语言查询时作废正在进行的解析
- 选图层时，地图上还有上一次的结果就提示重新查询（同旧页面）；属性查询选图层时加上默认的条件，行政区划回到全省

## 测试

- 纯函数：`conditions.test.ts`、`topics.test.ts`（配置自检：字段不重复、初始值在选项里、自然语言的规则指向存在的图层）、`result-layers.test.ts`
- 接口：`api.test.ts`（MSW；带 File 的 FormData 检查交给公共层的内容，不在 jsdom 里解析 multipart）
- 编排：`composables/useDataQuery.test.ts`（页签切换、各页签的提交检查、画完直接查询、高级查询的后备区划、自然语言的解析与作废）
- 面板：`components/QueryPanel.test.tsx`
- 真实引擎：`app/data-query-layers.browser.test.ts`（结果的点、面和画的范围在 MapLibre 上画得出来）
- 生产冒烟：`tools/smoke/data-query.spec.ts`，本地固定接口（查询成功时没有信封，照真实返回）。属性查询：预览瓦片是全省、不带条件，查询后结果表、条数、带条件的结果瓦片，导出 Excel 的请求体和下载的文件名；空间查询：在真实引擎上拖框，画完直接查询、报命中数，发给后端的是闭合矩形；从顶栏切专题：整页重建（条件、结果不带过去，原来的画布已移除），建设中的专题没有查询方式的按钮组
