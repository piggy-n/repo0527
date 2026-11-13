# 三维的设备档位（`scene-tier.json`）

> **还没实现（2026-11-12）：** ADR 0155 已接受，发布目录里还没有这个文件，现在所有设备都按标准档（`three-scene-renderer.ts` 的默认值）。实现以后去掉这一段。

三维的瓦片缓存、每帧上传、高斯泼溅预算按设备分三档（ADR 0155）。部署方在发布目录的 `scene-tier.json` 里按现场的机器指定档位，属于"运行时文件"（[overview.md](overview.md)）：替换文件、用户刷新页面就生效，不用重新构建。

## 写法

```json
{ "tier": "auto" }
```

| 值 | 含义 |
|---|---|
| `auto` | 按显卡型号自动判断，只往下调（下面"auto"） |
| `low` | 低档 |
| `standard` | 标准档 |
| `high` | 高档：客户的机器有 16 GB 以上内存、独显时用 |

读不到文件、格式不对时按 `auto`。

## 各档的数值

| 档位 | 到多少不再加载 | 淘汰到 | 每帧上传 | 泼溅的总预算 |
|---|---|---|---|---|
| 低 | 1 GB | 0.5 GB | 16 MB | 300 万 |
| 标准 | 2 GB | 1 GB | 16 MB | 300 万 |
| 高 | 4 GB（待 1920×1080 的实测确认） | 2 GB | 16 MB | 300 万 |

- 2026-11-12 定（ADR 0155）。标准档就是原来对所有设备一样的值。
- 依据是 RTX 3060 Laptop GPU（6 GB 显存）、15 GB 内存的笔记本上经开区四个姿态的实测（视口 1600×900）：4 GB 整级清楚，6 GB 没有更多收益；浏览器的两个进程占的内存约是缓存的 3 倍。见 ADR 0155 的"实测"。
- 上传和泼溅三档相同：每帧上传管的是帧时间，和显存大小无关；泼溅预算在集显上要不要降没有实测。

## auto

只看 WebGL 报告的显卡型号，永远不自动给高：浏览器读不到内存和显存的大小（ADR 0155"浏览器能告诉页面什么"）。

| 显卡 | 档位 |
|---|---|
| 软件渲染（SwiftShader、llvmpipe、Microsoft Basic Render Driver） | 低 |
| 集显（下面"集显的名字"） | 低 |
| 独显、读不到型号 | 标准 |

### 集显的名字

Windows 上 Chrome、Edge 经 ANGLE 报"ANGLE (厂商, 驱动里的设备名 (0x设备号) Direct3D11 vs_5_0 ps_5_0, D3D11)"，按其中的设备名分（规则在 `tools/measure-3d/renderer-class.ts`，实现时搬进 app）：

| 设备名 | 分到 | 来源 |
|---|---|---|
| Intel 的：HD、UHD、Iris，Arc(TM) Graphics（Meteor Lake 起），Arc 140V / 130V（Lunar Lake），B390 / B370 这类集成的 Arc，Intel(R) Graphics | 集显 | HD、UHD、Iris 在浏览器里见过；Arc 140V 是驱动的设备名 "Intel(R) Arc(TM) 140V GPU (16GB)"（OpenGL 报的名字）；其余是按产品名推测的 |
| Intel 的独立 Arc：A310～A770、笔记本的 A370M 等，B570、B580，Arc Pro A 系列，Iris Xe MAX | 独显 | 按产品名推测 |
| AMD 的：不带型号的 Radeon(TM) Graphics，780M、890M 这类三位数加 M，8060S 这类四位数加 S，Radeon Vega 8 这类，老的 R7 Graphics | 集显 | Radeon(TM) Graphics 在浏览器里见过；其余按产品名推测 |
| AMD 的 Radeon RX、Radeon Pro（RX Vega 56 也是独显） | 独显 | 按产品名推测 |
| 高通 Adreno（Windows on ARM）、苹果 M 系列、ARM Mali | 集显 | 按产品名推测 |
| NVIDIA，和上面都认不出的 | 独显（标准档） | RTX 3060 Laptop GPU 在浏览器里见过 |

规则是"Intel 除了独显都算集显"：Intel 以后的集显不用补；AMD 的集显换了命名要补规则。有了典型的客户机器（`docs/backlog.md`）后在它的浏览器里读一次核对。

## 自动降档

- WebGL 上下文丢了：这次会话降一档。
- 上次打开三维时页面崩溃（标签页被浏览器杀掉）：下次打开降一档，并提示。每个页面用自己的 id 记标记、可见时每 10 秒更新，打开三维时问一次别的页面还开着没有，不回答的才算崩溃（ADR 0155 第 4 节）。降下来的档位记在这台设备上，提示里的"恢复原来的画质"清掉它，`scene-tier.json` 里的档位改了以后也重新从配置开始。
- 会误判成崩溃的：系统关机、结束浏览器、断电，前台的页面卡住 2 秒以上。
