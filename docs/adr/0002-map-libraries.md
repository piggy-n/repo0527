# 0002. 二维地图用 MapLibre，Cesium 精确锁版本

- 状态：已接受
- 日期：2026-09-29

## 背景

yzt 使用 mapbox-gl 3.23。核对 npm 包内的 `LICENSE.txt`：1.13.0 ~ 1.13.3 是 BSD-3-Clause，2.0 起是 Mapbox TOS，仅限配合 Mapbox 产品使用。
yzt 既没有配置 Mapbox token，也没有使用 Mapbox 的服务，和 v3 的许可条款不符。npm 上的 `license` 字段对所有版本都写成 `SEE LICENSE IN LICENSE.txt`，不能用来判断许可证。
地图依赖的选型原则是稳定、兼容优先，不追最新版。旧代码没有用到 v2/v3 独有的能力（地形、雾效、地球投影、Standard 样式、`setConfigProperty`）。

## 候选方案

1. mapbox-gl 1.13.3：真开源，API 与旧代码接近；功能在 2020 年冻结，不再维护，需要另装 `@types`
2. MapLibre GL JS：从 mapbox-gl 1.13 分叉，BSD-3，持续维护，用 TS 编写，自带类型
3. 继续用 mapbox-gl 3.x：改动最少，但需要单位有 Mapbox 商业授权

## 决定

- 二维地图用方案 2（MapLibre GL JS）。大版本到地图阶段再定：默认倾向 v5 的最后一版 5.24.0；v6 于 2026-07-22 发布，到时读完它的更新日志再评估
- Cesium 精确锁定版本（当前为 1.145.0，与 yzt 一致），不加 `^`。Cesium 每月发版，版本号一直是 1.x，但单个版本里也会删除已废弃的 API，并不遵守语义化版本

## 后果

- 好处：许可证合规；地图 API 有原生 TS 类型
- 代价：style-spec 相关代码要从 `mapbox-gl/dist/style-spec` 改为 `@maplibre/maplibre-gl-style-spec`
- 代价：无法使用 Mapbox v2 之后新增的能力，目前的业务用不到
- 代价：Cesium 不会自动获得补丁更新，需要定期主动评估升级
