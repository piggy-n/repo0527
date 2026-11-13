# 三维的设备档位（`scene-tier.json`）

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
| `high` | 高档：独显的显存 8 GB 以上、内存 16 GB 以上的机器（下面"高档的要求"） |

读不到文件、格式不对时按 `auto`，浏览器控制台有一条警告。二维稳定后预加载三维模块时一起读（带时间戳，不用缓存），不拖慢地图；仓库里的来源是 `apps/yzt/public/scene-tier.json`（`auto`），部署见 [deployment.md](../deployment.md)"三维的设备档位"。

## 各档的数值

| 档位 | 到多少不再加载 | 淘汰到 | 每帧上传 | 泼溅的总预算 |
|---|---|---|---|---|
| 低 | 1 GB | 0.5 GB | 16 MB | 300 万 |
| 标准 | 2 GB | 1 GB | 16 MB | 300 万 |
| 高 | 6 GB | 3 GB | 16 MB | 300 万 |

- 数值只写在 `apps/yzt/src/shared/config/scene-tier-options.ts` 一处（ADR 0155 第 1 节"app 的档位表"），`measure:3d --tier` 也按它；map-three 构造参数的默认值和标准档相同（测量工具、测试不给档位时用）。
- 2026-11-12 定（ADR 0155）；高档同日按 1920×1080 的补测从 4 GB 改为 6 GB（用户定）。标准档就是原来对所有设备一样的值。
- 依据：RTX 3060 Laptop GPU（6 GB 显存）、15 GB 内存的笔记本上经开区四个姿态（z16 俯视、倾斜，z16.5 俯视，z17 倾斜）。视口 1600×900 时 4 GB 整级清楚；1920×1080 时要 4.8～5.1 GB，4 GB 还有 17～50 块放宽一级，6 GB 全部整级清楚。要的缓存随画布的像素数增长，模型占满画面时接近成正比（1600×900 到 1920×1080，像素多 44%，z16 倾斜从 3.7 GB 到 5.1 GB，多 38%）；2560×1440 时 z16 倾斜要 6.7 GB，只比 1080p 多 31%（像素多 78%）：画面超出了模型的边缘，模型只占画面的 62%（1080p 时 80%），多出来的像素里没有模型。数据见 [map-three](../modules/map-three.md)"经开区补测的结果"。
- 上传和泼溅三档相同：每帧上传管的是帧时间，和显存大小无关；泼溅预算在集显上要不要降没有实测。

### 高档的要求

- 独显的显存 8 GB 以上，内存 16 GB 以上。依据（RTX 3060 Laptop、6 GB 显存、15 GB 内存）：1920×1080、6 GB 档专用显存最多用到 5.2 GB；GPU 进程（驱动）的私有内存峰值 5.8～8.5 GB，释放贴图不影响它；渲染进程释放贴图以后约 2 GB（2560×1440 下 6 GB、8 GB 档稳定时 1.9 GB、峰值 2.1～2.2 GB；1080p 没有测，不释放时是 5.1～7.2 GB）。两个进程加起来约 10 GB，所以要 16 GB 内存。释放后的这些数字是测量页旧的做法测的（`--release-images`：上传后马上关掉），产品的做法（记完账才关、只关提前传过的）还没在显卡机器上测（`docs/backlog.md`）。
- **不能超过显存：** 2560×1440、8 GB 档在 6 GB 显存上（z16 倾斜要 6.7 GB）：专用显存顶在 6.0 GB，共享 GPU 内存涨到 3.3 GB，驱动在换页，没丢 WebGL 上下文、页面也没崩。不释放贴图时明显卡顿（静止时每帧最长 342 毫秒，第一遍飞行 30 帧超过 100 毫秒）；释放以后基本不卡（各 1 帧），但整体慢，和同样顶满显存的 6 GB 档一样每帧约 90 毫秒（约 18 帧每秒），GPU 进程 10.7 GB。超过显存以后好坏看驱动和内存，只测过这一台；下面"自动降档"的两道保险都不会动作，坏的时候用户只看到卡。所以按显存给高档；屏幕比 1920×1080 大的机器要的缓存更多，显存也要更大。

## auto

只看 WebGL 报告的显卡型号，永远不自动给高：浏览器读不到内存和显存的大小（ADR 0155"浏览器能告诉页面什么"）。

| 显卡 | 档位 |
|---|---|
| 软件渲染（SwiftShader、llvmpipe、Microsoft Basic Render Driver） | 低 |
| 集显（下面"集显的名字"里的名单） | 低 |
| 名单以外的：独显、新的或认不出的型号、读不到型号 | 标准 |

### 集显的名字

Windows 上 Chrome、Edge 经 ANGLE 报"ANGLE (厂商, 驱动里的设备名 (0x设备号) Direct3D11 vs_5_0 ps_5_0, D3D11)"，按其中的设备名对名单（规则在 `apps/yzt/src/shared/map/scene-tier/renderer-class.ts`，`measure:3d` 也导入它）。名单以外的给标准：判成标准不比原来差，判成低会让 Arc Pro 这类专业卡吃亏，新的集显要补进名单。

| 设备名里有 | 分到 | 来源 |
|---|---|---|
| Intel 的 `HD Graphics`、`UHD Graphics` | 集显 | HD Graphics 在网上的 WebGL 报告里见过（"Intel(R) HD Graphics 4600"）；UHD 按产品名推测 |
| Intel 的 `Iris(R) Graphics`、`Iris(R) Xe Graphics`、`Iris(R) Plus Graphics`、`Iris(TM) Plus Graphics`（Kaby Lake 的 640、650，macOS 上也这样报）、`Iris(TM) Pro Graphics` | 集显 | 按产品名推测；Iris Xe MAX 是独显，不在名单里 |
| Intel 不带型号的 `Arc(TM) Graphics`、`Arc(TM) Pro Graphics`（Meteor Lake 起） | 集显 | 按产品名推测 |
| Intel 的 `Arc(TM) 140V`、`130V`（Lunar Lake），`140T`、`130T`（Arrow Lake） | 集显 | 140V 是驱动的设备名 "Intel(R) Arc(TM) 140V GPU (16GB)"（OpenGL 报的名字）；其余按产品名推测 |
| Intel 的 `Arc(TM) B390`、`B370`（Panther Lake 集成的 Arc） | 集显 | 按产品名推测 |
| 不带系列名的 `Intel(R) Graphics` | 集显 | 按产品名推测 |
| AMD 不带型号的 `Radeon(TM) Graphics` | 集显 | 网上的 WebGL 报告里见过 |
| AMD 的 `780M` 这类三位数加 M、`8060S` 这类四位数加 S、`Radeon Vega 8 Graphics`、`Radeon(TM) RX Vega 11 Graphics`（Ryzen 2400G、3400G、2700U、3700U 的集显）、`R7 Graphics` | 集显 | 按产品名推测 |
| 高通 Adreno（Windows on ARM）、苹果 M 系列、ARM Mali | 集显 | 按产品名推测 |
| 名单以外的：NVIDIA，独立的 Arc（A770、A370M、Pro A60M、Pro B60、B580），Iris Xe MAX，Radeon RX（独立的 RX Vega 56、64 报 "Radeon RX Vega"，后面不带 Graphics），Radeon Pro，认不出的 | 标准 | RTX 3060 Laptop GPU 在显卡机器上见过；其余按产品名推测 |

有了典型的客户机器（`docs/backlog.md`）后在它的浏览器里读一次核对。

## 自动降档

- WebGL 上下文丢了：这次会话降一档，不提示（画面重新加载一次，内容不变）。连续丢就一直降到低档。
- 上次打开三维时页面崩溃（标签页被浏览器杀掉）：下次打开三维时降一档，并提示，提示里能恢复原来的画质（下面"崩溃标记"）。

崩溃降档的提示在地图区域上方，样式同"地图样式加载失败"的横条（[shared-map](../modules/shared-map.md)"地图状态的提示"），只在三维里显示；一个页面只提示一次，关掉不再出，降下来的档位留在这台设备上。文字和按钮 2026-11-13 用户定（第二行的说明是按 ADR 第 4 节"注明恢复后又崩溃过"补的，待用户确认）：

| 情况 | 提示 | 按钮 |
|---|---|---|
| 崩溃后降档 | 三维画质已调低：上次打开三维时页面崩溃了。 | 恢复原来的画质、知道了 |
| 用户恢复过画质，以后的页面又崩 | 三维画质已调低：上次打开三维时页面崩溃了，恢复后又崩溃过。 | 恢复原来的画质、知道了 |
| 恢复了画质的页面又崩，不能再恢复 | 三维画质已调低：恢复后又崩溃过。如需恢复，请联系管理员调整配置。 | 知道了 |

## 崩溃标记

ADR 0155 第 4 节定的是"按页面的标记、打开三维时确认留下标记的页面还在不在、可以恢复"，这里是做法（2026-11-13 实现）。标记和降档记录经 `shared/storage` 的设备级同步存储（[storage.md](../modules/storage.md)"设备级的同步存储"）写进 localStorage。

- **键：** 每个页面一个键：前缀加页面 id，各写各的，没有跨页面的"读、改、写"（一份 `{ id: … }` 的 JSON 会互相覆盖：A 读到 {A, B}、B 正常离开写成 {A}、A 再写回 {A, B}，B 下次就被当成崩溃）。键是 `yzt.device.scene-tier:page:<页面 id>`，值是这个页面现在的档位、当时配置里的档位（`scene-tier.json` 的值），和这个页面是不是恢复过画质（`{ tier, configured, restored }`）。页面 id 每次打开、刷新都新生成，不存 sessionStorage：重新加载崩溃的标签页时是一个新的页面，才认得出旧的那个。内网走 HTTP，不是安全上下文，没有 `crypto.randomUUID`，用 `crypto.getRandomValues` 生成。
- **什么时候写、删：** 档位高于低、三维开着、页面可见时写（打开三维、恢复了画质、重新可见），档位变了就改写（丢上下文降了一档也要改：不改的话按 high 打开、降到 standard 以后被杀，下一个页面按 high 的下一档降，正好是刚崩过的 standard）；切回二维、离开地图页（被缓存的地图页停用时视图暂停，模型层撤下）、隐藏（`visibilitychange`）、`pagehide`、`freeze`、档位降到低时删自己的，`resume`、`pageshow`、重新可见时写回。不存时间：判断还在不在不看时间，崩溃后最常见的是马上点"重新加载"，那个标记的时间最新。
- **确认还在不在：** 要写标记的页面先开一个很小的 Worker，Worker 听 BroadcastChannel，替页面回答"我还在"；Worker 回报就绪以后才写标记，不然刚写上就被问到会答不上。页面主线程忙着加载三维时 Worker 照样马上回答，页面崩溃时 Worker 跟着没了，所以"忙"和"死"分得开。打开三维时有别的页面的键才问，等到它们都回答或者 2 秒，没回答的算崩溃。键里的配置档位和现在的 `scene-tier.json` 不同的旧标记不算，直接删掉：部署方改了配置以后重新开始，不能被改之前留下的标记绕过。
- **键被误删了补回来：** 内存紧张、系统换页时（正是这份 ADR 针对的情况）Worker 也可能 2 秒内答不上，检查的页面会把一个活着的页面当成崩溃、删掉它的键。所以检查的页面删键以后广播一次"删了谁的"，被删的页面的主线程也听着这个频道，闲下来收到时补写。删键之后一定有这条广播，不另外经 Worker 转告询问（ADR 写的是两条路，实现只用这一条）。这一次误判照样降了一档（能恢复），补写以后它真崩了还能发现。
- **等不等：** 没有别的页面的键时不等；有的话先等完，再按结果的档位创建渲染器。二维稳定后空闲时预加载 map-three（[map-overview](../modules/map-overview.md)）只下载模块、读 `scene-tier.json`，不问别的页面：问是"打开三维"的一部分，在二维时发现崩溃，这个页面可能一直不开三维，提示就没人看见。所以没有下载可以藏这段等待；别的页面还开着时几毫秒就答完，只有真的崩溃了才等满 2 秒。检查出错时按读到的配置和记的降档照常创建渲染器，不让三维因为检查打不开。Web Locks 能让浏览器自己判断页面还在不在，但只在安全上下文里有，内网的 HTTP 用不了。
- **降档和去重：** 降到"崩溃页面当时的档位（它的键里存的）的下一档"和这台设备已经记的上限里更低的那个，不是在现在的基础上再降一档：两个页面同时发现同一次崩溃，结果一样，不会从高直接降到低。已经记的上限在确认崩溃以后重新读：同时发现这次崩溃的页面可能刚写过。确认崩溃后马上删掉它的键；两个页面同时检查时可能各提示一次。
- **设备记的降档：** 键是 `yzt.device.scene-tier:record`，记上限、能不能恢复、用户恢复过没有（提示里注明"恢复后又崩溃过"用），和当时配置里的档位（`{ configured, cap, restorable, restoredBefore }`）；崩溃时的档位不另外记，上限就是按它算的。`scene-tier.json` 的档位变了就清掉，重新从配置开始。
- **恢复：** 提示里的"恢复原来的画质"立即生效（渲染器改预算），清掉上限，并按升上去的档位改写标记、记上"这个页面恢复过"（不写的话再崩发现不了）。崩溃的页面恢复过（键里有记），说明恢复了马上又崩，降档记成不能恢复，提示里不再给"恢复"：只能部署方改配置，或者清掉浏览器的站点数据。以后的页面再崩（重新打开、刷新以后，包括关机、断电这类误判）照样给"恢复"，提示里注明"恢复后又崩溃过"：一次误判不会让这台设备永久降档。
- **会误判成崩溃的：** 系统关机、结束浏览器、断电（几个页面的标记一起留下，按一次崩溃算）；内存紧张、系统换页时 Worker 2 秒内没答上（键会补回来，见上）。后台被节流、冻结、丢弃的标签页不算：隐藏时没有标记。

## 代码在哪

| 文件 | 内容 |
|---|---|
| `apps/yzt/public/scene-tier.json` | 发布的默认配置（`auto`） |
| `apps/yzt/src/shared/config/scene-tier-options.ts` | 三档的数值，只写常量（测量工具也导入） |
| `apps/yzt/src/shared/config/scene-tier-file.ts` | 读、校验 `scene-tier.json` |
| `apps/yzt/src/shared/map/scene-tier/renderer-class.ts` | 按显卡的名字分软件渲染、集显，`auto` 的档位 |
| `apps/yzt/src/shared/map/scene-tier/crash-markers.ts` | 标记和降档记录的读写、问别的页面还在不在 |
| `apps/yzt/src/shared/map/scene-tier/scene-tier-ping.worker.ts` | 替页面回答"还在"的 Worker（处理函数在 `scene-tier-ping-handlers.ts`） |
| `apps/yzt/src/shared/map/scene-tier/scene-tier.ts` | 预算来源 `SceneTierSource`（map-core 的 `SceneBudgetSource`）：档位、降档、标记、提示的状态 |
| `apps/yzt/src/app/map-runtime-provider.ts` | 一个页面建一个预算来源，注入的三维引擎打开三维前等它准备好；预加载只读配置 |
| `apps/yzt/src/shared/map/MapStatusNotice.tsx` | 降档的提示 |
