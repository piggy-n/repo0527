# 0017. 接口数据用 TanStack Vue Query 管理

- 状态：已接受
- 日期：2026-10-08

## 背景

阶段三要做第一个列表页（文件管理）。一个列表页至少要处理：

- 加载中、出错、空列表三种状态
- 切换分类、翻页、改筛选条件时取消上一个请求，避免晚到的旧结果覆盖新结果
- 删除之后刷新列表
- 来回切换分类时先显示上次的数据
- 退出或换账号时清掉上一个账号的数据（会话结束的统一处理，见 [modules/auth.md](../modules/auth.md)）

旧项目每个页面自己维护 `loading`、`tableData`、`currentPage`，自己决定什么时候重新请求，没有处理请求竞态。新项目的 `shared/http` 已经支持 `AbortSignal` 和统一的错误模型（ADR 0011），但重试、去重、缓存当时留到阶段三再决定。AGENTS.md 的目录约定里也为每个 feature 预留了 `queries.ts`。

## 候选方案

| | A. TanStack Vue Query | B. 现有 `http` + 每页的组合式函数 | C. VueUse 的 `useAsyncState` |
|---|---|---|---|
| 加载、出错状态 | 自带 | 自己写 | 自带 |
| 参数变化时取消旧请求、丢弃晚到的结果 | 自带：`queryFn` 收到 `signal`，key 变化或组件卸载时取消 | 每页照 `useLoginForm` 的写法重复一遍 | 没有 |
| 缓存（切回时先显示旧数据，后台刷新） | 自带，以 query key 区分 | 要自己写一个简化版 | 没有 |
| 变更后刷新 | `invalidateQueries` 按 key 失效 | 手动再调一次 | 手动 |
| 翻页时保留上一页数据 | `placeholderData: keepPreviousData` | 自己处理 | 自己处理 |
| 会话结束清数据 | `queryClient.clear()` | 每个 feature 各自清理 | 各自清理 |
| 代价 | 新依赖和新概念（query key、`staleTime`、`gcTime`） | 不加依赖，但每个列表页都要重复处理竞态和缓存 | 只解决最简单的部分 |

## 决定

选方案 A，`@tanstack/vue-query` 5.x。

全局配置（`app/query-client.ts`）：

| 配置 | 值 | 原因 |
|---|---|---|
| `retry` | `false`（默认重试 3 次） | `shared/http` 每次请求失败都会弹全局提示，重试会让一次失败提示多次；内网系统重试的价值不大 |
| `refetchOnWindowFocus` | `false`（默认切回标签页时刷新） | 管理类列表不需要；也避免后端出错时切回标签页突然弹出提示 |
| `staleTime` | 默认 0 | 切回某个分类时先显示缓存，同时在后台重新请求，数据总是新的 |

用法约定：

- 接口函数仍写在 `features/<域>/api.ts`，用 `shared/http`；`queryFn` 把 TanStack 传入的 `signal` 交给接口函数
- query、mutation 写在 `features/<域>/queries.ts`，组件不直接拼 query key
- 接口数据由 TanStack 的缓存持有，不放进 Pinia，组件里也不另存一份（AGENTS.md 的 Pinia 约定"接口数据不放进 store"）

## 后果

- 好处：竞态、缓存、失效、加载状态由成熟的库处理，各列表页不再重复实现
- 好处：会话结束时清缓存有了统一入口（阶段三处理"会话结束的统一处理"时使用）
- 代价：生产构建的入口包 gzip 后增加约 8.5 KB（315.03 KB → 342.77 KB，gzip 107.76 KB → 116.21 KB，已测）
- 代价：引入 `vue-demi`（兼容 Vue 2/3 的垫片），它的安装脚本不执行（见 [config/pnpm-workspace.md](../config/pnpm-workspace.md)）；`@vue/devtools-api` 6.x 只在开发环境使用，生产构建中搜不到它的代码（已查）
- 风险：以后需要失败重试时，要把查询的错误提示从 `shared/http` 挪到 `QueryCache` 的 `onError`，只在最终失败时提示一次
- 测试：用到 `useQuery` 的组件，挂载时要提供 `QueryClient`；每个用例用新的 `QueryClient`，避免缓存在用例之间残留
