# map-cesium：已移除

Cesium 引擎（`packages/map-cesium`、map-vue 的 `CesiumCanvas`、`VITE_MAP_3D_ENGINE=cesium`）于 2026-11-11 从 main 移除，三维只用 MapLibre + Three.js（[ADR 0153](../adr/0153-remove-cesium-engine.md)，[map-three.md](map-three.md)）。

代码和这份文档的完整版在注释标签 `cesium-engine-2026-11`（main 的 `16789827`）：

```bash
git show cesium-engine-2026-11:docs/modules/map-cesium.md
git checkout cesium-engine-2026-11 -- packages/map-cesium
```

完整版里还有用的：

- "瓦片集的显存预算"：屏幕误差上限默认 8 的理由（2026-11-09 用户看过 JKQ 的显卡复测后决定，ADR 0081 的状态行），经开区两个模型在 Cesium 下的实测；
- "第三人称（ADR 0090）"：人物模型的挂法、步态和透视，MapLibre 引擎下以后做第三人称时参考；
- 各节的相机、覆盖物镜像、路线和步行：MapLibre 引擎的漫游从这里移植（[map-three.md](map-three.md)"漫游"）。

人物模型 `apps/yzt/public/roam/Cesium_Man.glb` 没有删，来源和许可见同目录的 `CREDITS.txt`。
