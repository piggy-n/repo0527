# 0144. 应用改名 yzt，公共包前缀改为 @mx

- 状态：已接受
- 日期：2026-11-05
- 修改：ADR 0004、0014 和 0143 用的前缀 `@yzt/`，以及各 ADR 里的路径 `apps/web`

## 背景

拆包（ADR 0143）之后，公共包都叫 `@yzt/*`，应用叫 `@yzt/web`，放在 `apps/web`。以后别的地图项目也放在这个仓库的 `apps/` 下，导入 `@yzt/map-core` 读起来像是在用这个应用的内部代码。改名的范围只会越来越大，所以趁没有业务分支在改时一起做。

## 候选方案

| 问题 | 候选 | 选择与理由 |
|---|---|---|
| 应用的文件夹 | `apps/web`；`apps/yzt`；`apps/yzt_web` | `apps/yzt`：`apps/` 已经说明它是应用，以后有第二个端再加后缀。不用下划线，现有的包都是短横线 |
| 应用的包名 | `@yzt/web`；`@yzt/yzt`；`yzt` | `yzt`：应用不发布，也不被别的包依赖，不需要前缀 |
| 公共包的前缀 | 保留 `@yzt/`；`@mx/`；`@gis/`；`@repo/` | `@mx/`：和组件前缀 `Mx` 一致，不绑定业务。`@gis/` 不适合 `ui`、`theme`、`utils`；`@repo/` 只说明位置 |

`Mx` 沿用自旧项目的 `mx-*` 公共组件，含义没有记录，这里也不另外定义。

## 决定

- `apps/web` 改为 `apps/yzt`，`@yzt/web` 改为 `yzt`，`@yzt/*` 改为 `@mx/*`
- 其他带 yzt 的名字不变：IndexedDB 库名 `yzt-preferences`（改了用户已存的偏好会丢）、环境变量 `YZT_*`、命令 `yzt-icons`、Vite 插件名 `yzt:*`
- 已接受的 ADR 和 `docs/archive/` 是当时的记录，保留旧名字；现行文档、规则和配置都用新名字

## 后果

- 读旧 ADR 和归档时，`apps/web` 就是 `apps/yzt`，`@yzt/<name>` 就是 `@mx/<name>`，`@yzt/web` 就是 `yzt`
- 路径和前缀写错时有两处不会报错：`.claude/rules` 的 `paths` 匹配不到就不加载，`.oxlintrc.json` 的依赖方向匹配不到就不检查。这次改完都实测过；以后再搬目录要记得复查
- 仓库外写了 `apps/web/dist` 的部署脚本要跟着改
