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
| [0003](0003-typescript-7-toolchain.md) | TypeScript 7 与工具链 | 已接受 |
| [0004](0004-module-boundaries.md) | 模块边界与拆包预留 | 已接受 |
| [0005](0005-dependency-maintenance-and-ci.md) | 依赖维护与持续集成 | 已接受 |
| [0006](0006-lint-rules-and-boundaries.md) | lint 规则与依赖方向检查 | 已接受 |

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
