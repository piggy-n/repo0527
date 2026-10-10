# 架构决策记录（ADR）

一个重要决策写一份 ADR，记录当时的背景、考虑过的方案和最终选择的理由。

- 文件名：`NNNN-简短标题.md`，编号递增，不复用
- 状态：提议中 → 已接受；以后被新决策替代时改为「已被 NNNN 取代」
- 接受后正文不再修改，只允许更新状态行

## 索引

| 编号 | 标题 | 状态 |
|---|---|---|
| [0001](0001-tsx-instead-of-sfc.md) | 组件使用 TSX，不使用 SFC | 已接受 |
| [0002](0002-map-libraries.md) | 二维地图用 MapLibre，Cesium 精确锁版本 | 已接受（大版本由 0019 确定） |
| [0003](0003-typescript-7-toolchain.md) | TypeScript 7 与工具链 | 已接受（`incremental` 一条已被 0009 取代） |
| [0004](0004-module-boundaries.md) | 模块边界与拆包预留 | 已接受 |
| [0005](0005-dependency-maintenance-and-ci.md) | 依赖维护与持续集成 | 已接受 |
| [0006](0006-lint-rules-and-boundaries.md) | lint 规则与依赖方向检查 | 已接受 |
| [0007](0007-vue-router-5-and-history-mode.md) | 路由使用 Vue Router 5 与 history 模式 | 已接受 |
| [0008](0008-same-origin-api-proxy.md) | 接口走同源的 /backend 代理 | 已接受 |
| [0009](0009-disable-incremental-typecheck.md) | 关闭 tsc 的增量检查 | 已接受 |
| [0010](0010-testing-with-vitest.md) | 测试使用 Vitest 与 jsdom | 已接受 |
| [0011](0011-http-client-axios-zod-msw.md) | HTTP 客户端：axios + zod，测试用 MSW 模拟接口 | 已接受 |
| [0012](0012-fonts-self-hosted-and-svg-title.md) | 字体：普惠体 3.0 自托管且不入库，系统名称用 SVG 轮廓 | 已接受（存放位置已被 0013 取代） |
| [0013](0013-fonts-in-public-dir.md) | 字体文件统一放在 apps/web/public/fonts/ | 已接受 |
| [0014](0014-icons-as-internal-package.md) | 图标做成第一个 workspace 包 @yzt/icons（内部包） | 已接受 |
| [0015](0015-login-session-and-permissions.md) | 登录与会话：会话存 localStorage，SM2 用 sm-crypto-v2，权限声明在路由上 | 已接受 |
| [0016](0016-ui-components-in-libs-ui.md) | 通用 UI 组件放在 libs/ui | 已接受 |
| [0017](0017-server-state-with-tanstack-query.md) | 接口数据用 TanStack Vue Query 管理 | 已接受 |
| [0018](0018-map-core-in-libs.md) | map-core 放在 libs/map-core | 已接受 |
| [0019](0019-maplibre-v6.md) | 二维地图用 MapLibre GL JS 6 | 已接受 |
| [0020](0020-map-session-state-as-source-of-truth.md) | 二三维关系：地图会话状态是唯一的真相源 | 已接受（选择状态的范围由 0022 修正，方案 B 的比较由 0024 修正） |
| [0021](0021-worker-strategy.md) | Worker 策略：二维不自建渲染 Worker，统一通信层与瓦片数据服务 | 已接受（第 5 条的表述由 0024 修正，第 3、4 条由 0025 补充） |
| [0022](0022-style-model-and-session-commits.md) | 样式模型与会话提交：分组推导、快照对比 | 已接受（第 4 条与第 5 条中 `failed` 的含义由 0026 修正） |
| [0023](0023-disposal-events-and-map-runtime.md) | 资源释放、事件与地图运行时装配 | 已接受 |
| [0024](0024-shared-view-interfaces.md) | 二三维共用的视图接口 | 已接受 |
| [0025](0025-worker-contract-and-tile-data-service.md) | Worker 通信契约与瓦片数据服务的约束 | 已接受 |
| [0026](0026-view-sync-failures.md) | 视图同步的失败处理：错误事件、加载失败与恢复 | 已接受（第 4 条的"不另加 API"由 0030 修正） |
| [0027](0027-map-capability-layers.md) | 地图能力的分层与页面组装 | 已接受 |
| [0028](0028-map-vue-context.md) | map-vue：会话与视图分开的地图上下文 | 已接受 |
| [0029](0029-map-overlay-padding.md) | 定位可视区域：悬浮元素登记、定位时现量现算 | 已接受 |
| [0030](0030-view-failure-as-data.md) | 视图失败的原因作为数据 | 已接受 |
| [0031](0031-basemap-tianditu-and-owner.md) | 底图：天地图的配置与底图的拥有者 | 已接受 |
| [0032](0032-intranet-build-mode.md) | 公网与内网两套构建命令：Vite 构建模式 | 已接受 |
| [0033](0033-boundaries-and-default-view.md) | 行政区边界与默认视角 | 已接受 |
| [0034](0034-interaction-tools.md) | 交互工具：视图输入、工具模型与工具栏 | 已接受 |
| [0035](0035-measurement.md) | 测量：椭球面计算、测量的状态与标签 | 已接受 |
| [0036](0036-region-locate.md) | 区划定位：本地区划目录、边界的加载与定位 | 已接受 |

## 模板

```markdown
# NNNN. 标题

- 状态：提议中
- 日期：YYYY-MM-DD

## 背景

## 候选方案

## 决定

## 后果
```
