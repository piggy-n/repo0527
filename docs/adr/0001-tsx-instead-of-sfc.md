# 0001. 组件使用 TSX，不使用 SFC

- 状态：已接受
- 日期：2026-09-29

## 背景

旧项目全部是 `<script setup>` 的 SFC，逻辑和模板混在一起，单个文件最长 4780 行，测试只能靠 `vm` 加手动编译 SFC 绕着测。
本次重构的目标之一是系统学习 TypeScript，希望类型检查覆盖到组件的每一处。
仓库使用 TypeScript 7，它不再提供传统的编译器 JS API，而 `.vue` 文件的类型检查依赖 vue-tsc，vue-tsc 又依赖这套 API（见 0003）。

## 候选方案

1. SFC + `<script setup lang="ts">`：Vue 官方主推，文档和生态最全；类型检查依赖 vue-tsc
2. `defineComponent` + TSX：逻辑和视图都是 TS，可以直接用 `tsc` 检查
3. 两种混用：按组件的复杂度选择

## 决定

选方案 2，全部组件用 TSX，不出现 `.vue` 文件。
不选方案 3，是因为只要存在一个 `.vue` 文件，就需要维护 vue-tsc 这条工具链，还要约定两套写法。

## 后果

- 好处：`tsc` 能直接检查全部代码；视图可以像普通函数一样拆分和组合
- 好处：强迫逻辑离开视图文件，更容易放进 composable 或类里单独测试
- 代价：没有 scoped style，改用 CSS Modules（`*.module.scss`）
- 代价：模板编译器的一部分优化（静态提升、patch flags）在 JSX 下会变弱
- 代价：官方文档和社区示例以 SFC 为主，需要自己换算成 TSX；Element Plus 的插槽在 TSX 中要写成对象形式
- 代价：Vue 正在推进的 Vapor 模式以 SFC 模板为主要目标，以后要用它需要重新评估
