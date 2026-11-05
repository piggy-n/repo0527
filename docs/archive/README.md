# 归档

迁移期的过程记录，2026-11-04 起只查不改（ADR 0142）。现行规则看 `AGENTS.md` 和 `.claude/rules/`，待办看 [backlog](../backlog.md)，决策看 [ADR 总览](../adr/overview.md)。

| 文件 | 内容 | 什么时候来查 |
|---|---|---|
| [roadmap.md](roadmap.md) | 八个阶段的计划、每一步做了什么、与原计划不同的地方 | 想知道一项功能当时为什么这样做、分几步做 |
| [migration.md](migration.md) | 各模块的旧路径与基线，接口实测，瓦片与分类的探查，与旧页面的差异 | 联调时核对接口结构（代码注释里的"实测"多指向这里）；对比旧仓库的新改动 |
| [stages/](stages/) | 各阶段的总结、学习笔记和三次全面审查 | 想看知识点、设计理由和替代方案 |

这里面写的"当前""待办""下一步"都是当时的状态。还有效的待办已经提取到 backlog，以 backlog 为准。

对比旧仓库的改动，基线在 `migration.md` 开头的表格里：

```bash
cd C:\work\zhjsqdxin
git diff <基线>..master-demo -- <旧路径>
```

## 阅读顺序

想系统了解这个项目是怎么建起来的，按下面的顺序读阶段总结：

1. [阶段一：工程基础](stages/stage-1-engineering-foundation.md)
2. [阶段二：应用骨架、数据层与鉴权](stages/stage-2-app-skeleton-and-auth.md)
3. [阶段三：页面布局与第一个列表页](stages/stage-3-layout-and-first-list.md)
4. [阶段四：地图内核](stages/stage-4-map-core.md)
5. 阶段五：[5A 地图骨架](stages/stage-5a-map-skeleton.md)、[5B 公共地图能力](stages/stage-5b-public-map-capabilities.md)、[5C 现状底图业务](stages/stage-5c-current-map-business.md)、[5D 地图页界面](stages/stage-5d-map-ui.md)、[5E 加载策略、页面缓存与阶段五回顾](stages/stage-5e-wrap-up.md)、[阶段五验收与后续修复](stages/stage-5-acceptance-review.md)
6. [城市体检驾驶舱独立验收](stages/city-dashboard-acceptance.md)、[资源管理与文件管理联合验收](stages/resource-file-management-acceptance.md)
7. [阶段五之后的代码审查与整改](stages/post-5e-code-review.md)：写法和会话核对的统一做法
8. [main 分支的第二次全面审查与整改](stages/main-full-review.md)：写法指标、测试里取必需值的做法
9. [三维阶段：Cesium 三维、模型与漫游](stages/stage-3d-cesium-and-roaming.md)
10. [系统管理与消息的重新迁移](stages/system-message-migration.md)：Element 弹框的开关与过渡、同一个组件由真实数据和样例数据驱动
11. [现状底图的调整（2026-10-28）](stages/current-map-adjustments.md)：默认值记例外、两份顺序、没有 key 的兄弟节点怎样被重建
12. [城市国土空间监测指标的迁移](stages/space-monitoring-indicators-migration.md)：实测推翻旧代码的兜底假设、计算轮询按 ADR 0039 归类
13. [城市国土空间监测基本统计的迁移](stages/space-monitoring-statistics-migration.md)：轮询交给查询库、跟踪写成纯函数的状态机
14. [数据查询的迁移](stages/data-query-migration.md)：四个路由一个组件按专题加 key、通用的绘制工具
15. [城市国土空间监测指标AI计算](stages/indicator-simulation.md)：引擎只管状态和时间、动效从进度来
16. [阶段性迁移验收（2026-10-30）](stages/main-acceptance-review.md)：第三次全面审查，tag `acceptance-2026-10-30`
