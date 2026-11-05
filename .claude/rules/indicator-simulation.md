---
paths:
  - "apps/web/src/features/indicator-simulation/**"
  - "apps/web/src/pages/indicator-simulation/**"
  - "apps/web/src/pages/dev/indicator-simulation/**"
---

# 城市国土空间监测指标AI计算

- 城市国土空间监测指标AI计算（原名指标智能推演，ADR 0105～0109）是新页面，不是迁移，全部用确定性的数据（市级标准值取 `indicatorValue`，页面不直接用 `mockIndicatorValue`；区县值由市值反推，ADR 0130）：界面上统一叫"计算""条件配置""自定义口径""调整条件"，不提 Excel，代码标识符沿用 simulation；参数按 Excel 的计算规则、按指标类型生效，除目标值外偏离标准口径就是"自定义口径"，不改指标的定义（例外是步行时长：名称、服务距离和结果一起变，都按参数得到，用 `indicatorName`、`indicatorShort`、`serviceMeters`，不直接读目录里的名称和距离，ADR 0125）；AI 计算指令和计算中的对话按规则解析、不接大模型，输入框的占位是完整示例、空着时 Tab 填入；引擎（`features/indicator-simulation/engine`）只管步骤状态与时间，时钟注入、测试用假时钟；推演流程图的节点状态、打字由 `flow/frame.ts` 从步骤进度计算，各步的时长按推理的话多少给，不另开计时器；结果展示是推演阶段的另一个视图（左侧推演结果、主区地图），地图画布第一次推演完成时创建；这一页不跟随系统的减少动画，开关只在 `motion.ts`；叙述、结果摘要、地图着色由纯函数从计算结果生成；结果展示只存用户选过的部分、总是看最新一版，其余推导；页面缓存期间推演暂停；自定义监测范围（ADR 0121）由 `useScopeEditor` 持有，在弹窗里上传、绘制、逐点编辑，读文件、整理和与区县求交用 `shared/map/area` 的 Worker（`createAreaAnalyzer`），覆盖分析随范围存进条件，计算和显示不重算；指令没写范围时不默认全省，停在条件配置标为待补充（由 `missingConditions` 推导，不另设状态），冲突要用户确认，开始、自动开始、重算都先过 `canRun`，回复和弹窗确定补齐后自动继续、条件库点选不自动开始，弹窗和结果地图用 `useCanvasHolder` 换手（ADR 0129）；弹窗打开时直接定位（`frame`），悬停只高亮 `covers[].geometry`，不能用的原因按类型写给用户、原话收进"查看原因"；覆盖方式写成占比，不用"全部 / 部分"标签，说法是"完整覆盖 / 部分覆盖"（ADR 0131）。见 `docs/modules/indicator-simulation.md`
