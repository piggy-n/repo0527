# 三维模型清单（`apps/yzt/public/3dt/manifest.json`）

三维模型面板列出哪些模型、在哪个市、是什么、数据在哪（ADR 0081）。随产物发布到 `dist/3dt/manifest.json`，部署时可以直接替换（[overview.md](overview.md)"运行时文件"）。格式由 `features/scene-models/api.ts` 的 zod 校验，严格对象：多写、写错位置的字段都让整份清单不合法，面板显示加载失败。

模型数据不入库，也不进构建产物（ADR 0083、0141）：本机放在 `local/3dt/`，服务器上由 nginx 在 `/3dt/` 下提供或转发（[local-files.md](local-files.md)、[deployment.md](../deployment.md)）。

## 共有的字段

| 字段 | 说明 |
|---|---|
| `id` | 模型 ID，整份清单不重复；也是三维内容里瓦片集（白膜是 `模型ID/效果ID`）、高斯泼溅的 ID |
| `name` | 面板上显示的名称 |
| `cityCode` | 市的区划代码，必须在区划目录里；市名取自目录 |
| `kind` | `oblique` 倾斜摄影、`white` 白膜、`indoor` 室内、`splat` 高斯泼溅 |
| `underground` | 地下的模型：漫游时抬高、用头灯（ADR 0097、0147 第 4 节） |

## 瓦片集模型（`oblique`、`white`、`indoor`）

| 字段 | 说明 |
|---|---|
| `tileset` | `oblique`、`indoor`：`tileset.json` 的地址，相对清单 |
| `effects` | `white`：`[{ id, label, tileset }]`，第一种是默认效果 |
| `maximumScreenSpaceError` | 可选，屏幕误差上限（正数）；不写用引擎的默认值 8，只给放不下的模型写（[map-cesium.md](../modules/map-cesium.md)） |
| `spawn` | 可选，步行的出生点 `{ lng, lat, height, heading }`：脚下地板的椭球高，朝向是正北为 0、顺时针的度数 |
| `routes` | 可选，预置的漫游路线 `[{ id, name, path }]`，`path` 是脚下地板的 `[经度, 纬度, 椭球高]`，至少两个点 |

## 高斯泼溅（`splat`，ADR 0149）

只有 `maplibre` 引擎能显示（能力声明 `splats`）；`cesium` 下面板不列出这类模型。第一版只显示和拾取，不写 `spawn`、`routes`、`maximumScreenSpaceError`。

| 字段 | 说明 |
|---|---|
| `lcc2` | `.lcc2` 索引的地址，相对清单；数据文件的路径由库按索引的地址解析。文件名有中文时按 URL 编码写（`encodeURIComponent` 每一段） |
| `placement` | 配准后的摆放 `{ lng, lat, height, heading }`，不用索引里的 `epsg`、`offset`（ADR 0149 第 4 节） |

`placement` 的口径：

- LCC2 的局部系是网格的东、北、上（Z 向上，米），原点放在 (`lng`, `lat`, `height`)；
- `height` 是椭球高，和其他模型的高度同一个口径；
- `heading` 是局部 x 轴从正东逆时针转的角度（度），包括子午线收敛角；中央经线以东是负的；
- 比例不存：3 度带内投影的比例误差每 100 米最多约 2.4 厘米。

**目录层级**（用户 2026-11-09 定）：所有模型平铺在 `3dt/` 下，LCC2 参照楚王山1号：

```
3dt/<模型名>/lcc2-sog-result/<模型名>.lcc2
                             data/3dgs/*.sog
                             data/mesh/*.ply、*.btree
                             info/attrs.json、poses.json、media/
```

## 现有模型的说明

| ID | 数据 | 说明 |
|---|---|---|
| `sz-station`、`sz-white` | 苏州星海广场站和周边白模 | 路线、出生点按站内地板实测（[map-three.md](../modules/map-three.md)"测试"） |
| `xz-gc` | 徐州彭城广场倾斜摄影 | 高程基准没查清，见 backlog"徐州倾斜摄影和地面的高度关系" |
| `wx-jkq`、`wx-jkq2` | 无锡经开区倾斜摄影 | 只在服务器上，本机用 `YZT_3DT_PROXY` |
| `xz-cws1` | 徐州楚王山1号（LCC2，2334 万个高斯，6 级） | **未配准**：L.1 按索引的 `offset`（EPSG:4548）原样换算，原点 117.0623886°E、34.2699335°N，高度直接取 `offset` 的 z 59.74 米，`heading` 是子午线收敛角 −0.035°。换算用一次性的脚本（proj4 不进运行时）。L.2 的配准工具算出最终值后替换（ADR 0149 第 4、9 节） |

## 修改时的检查清单

- `pnpm --filter yzt test:unit src/features/scene-models`：入库的清单要通过校验，测试里列着全部模型的 ID 和市
- 新的 LCC2 模型：按上面的层级放数据，`lcc2` 按 URL 编码，`placement` 用配准工具的结果；还没配准的在上表里注明
- 新加字段时同步改 `api.ts` 的 schema、`catalog.ts`，和这篇文档
