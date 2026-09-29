# 架构决策记录（ADR）

一个重要决策写一份 ADR，记录当时的背景、考虑过的方案和最终选择的理由。

- 文件名：`NNNN-简短标题.md`，编号递增，不复用
- 状态：提议中 → 已接受；以后被新决策替代时改为「已被 NNNN 取代」
- 接受后正文不再修改，只允许更新状态行

## 索引

| 编号 | 标题 | 状态 |
|---|---|---|
| [0001](0001-tsx-instead-of-sfc.md) | 组件使用 TSX，不使用 SFC | 已接受 |
| [0002](0002-map-libraries.md) | 二维地图用 MapLibre，Cesium 精确锁版本 | 已接受 |
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
