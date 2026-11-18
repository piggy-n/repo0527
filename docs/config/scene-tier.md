# 三维的设备档位（`scene-tier.json`）

三维的瓦片缓存、每帧上传、高斯泼溅预算按设备分四档（ADR 0155；工作站档、auto 按显存定档、本浏览器的设定见 ADR 0166）。部署方在发布目录的 `scene-tier.json` 里选档，属于"运行时文件"（[overview.md](overview.md)）：替换文件、用户刷新页面就生效，不用重新构建。一个浏览器可以用地址栏的 `?scene-tier=` 自己设定档位，代替部署文件（下面"本浏览器的设定"）。

用哪一档按这个顺序定：本浏览器的设定，没有时是部署文件里的值；是 `auto` 的按显卡型号查显存（下面"auto"）；最后按崩溃、丢上下文降档（下面"自动降档"）。定下时控制台写一行（下面"控制台里定档的一行"）。

## 写法

```json
{ "tier": "auto" }
```

| 值 | 含义 |
|---|---|
| `auto` | 按显卡型号查显存定档（下面"auto"） |
| `low` | 低档 |
| `standard` | 标准档 |
| `high` | 高档：独显的显存 8 GB 以上、内存 16 GB 以上的机器（下面"高档的要求"） |
| `workstation` | 工作站档：独显的显存 16 GB 以上、内存 32 GB 以上、屏幕 1920×1080 的机器（下面"工作站档的要求"） |

读不到文件、格式不对时按 `auto` 定这次的档位，浏览器控制台有一条警告。这不当成部署方改了配置：这台设备记的降档照用（包括不能恢复的），也不检查、不删别的页面的崩溃标记（分不出它们是不是改配置以前的，留给下一个读到配置的页面）；这个页面自己的标记里配置记成 `null`，别的页面照样认。二维稳定后预加载三维模块时一起读（带时间戳，不用缓存），不拖慢地图；本浏览器有设定时不读。

仓库里的来源是 `apps/yzt/public/scene-tier.json`，现在是 `auto`（2026-11-17 起，ADR 0166：现场的 Quadro RTX 5000、RTX 4090 自动是工作站档，用户测试的 RTX 3060 Laptop 是标准档；2026-11-15 到这天是 `high`）。开发服务器也读这个文件，开发时同样是 `auto`。部署见 [deployment.md](../deployment.md)"三维的设备档位"。生产冒烟（`tools/smoke/scene.spec.ts`）只检查发布的文件是合法的档位，崩溃降档那条用拦截下来的 `auto` 走。

## 本浏览器的设定（地址栏的 `?scene-tier=`）

给一台机器用和部署不同的档位，比如测试的笔记本、auto 判错的机器、Firefox（独显读不到型号，按标准档）。没有界面，只用地址栏（ADR 0166 第 3 节）。

| 值 | 含义 |
|---|---|
| `default` | 清掉本浏览器的设定，回到部署文件；清掉了已有的设定时控制台写一行"地址栏的 scene-tier=default 清掉了本浏览器的设定（原来是 …），回到部署文件" |
| `auto`、`low`、`standard`、`high`、`workstation` | 记成本浏览器的设定，同 `scene-tier.json` 的写法；可以比部署文件高，也可以低 |

- **什么时候读：** 应用启动时读一次地址栏，在路由第一次导航之前，所以没登录时跳到登录页、登录后再进来也记得住。改了地址栏回车会重新加载页面，马上生效；页面里的跳转不读。只认小写；不认得的值（包括空的）在控制台警告一次，什么都不改。
- **一个页面只读一次：** 读到的设定（`app/scene-tier-setting.ts`）现状底图的地址和三维的档位共用，别的标签页后来改了设定，这个页面两边都不变，地址栏显示的就是它实际用的；刷新、新开的页面才按新的。地址栏回车以后再后退，回到的是回车以前的页面：浏览器重新加载那个地址时按它里面的值，等于又输入了一次（从往返缓存恢复时照旧按那个页面原来的设定）。
- **记在哪：** 设备级存储（[storage.md](../modules/storage.md)"设备级的同步存储"），localStorage 的 `yzt.device.scene-tier:setting`，只在这个浏览器里；换浏览器、清除站点数据就没了。有设定时不读部署文件。
- **现状底图的地址：** 总带着这个参数。进入（页面缓存时是重新激活）的导航里没有它、或者和设定不同时，路由改成这个页面读到的设定，没有设定时写 `default`；改的是这次导航的目标，push 还是 replace 沿用原来的导航，别的参数和 hash 保留。同一个页面里的历史记录都按同一个值写，后退、前进到它们不会再改写。守卫不能每次重新读存储：vue-router 在后退、前进时遇到守卫改写会另 push 一条，别的标签页改了设定以后，后退到旧值的记录会丢掉前进的记录，再后退又回到这一条，退不出去。显示 `default` 而不是实际的档位：书签、分享出去的链接不会把这台机器的档位定死在别的机器上。**有设定的浏览器分享出去的现状底图链接带着它的设定**，打开的浏览器也会记下；**反过来，没有设定的浏览器的链接带着 `default`，整页打开它会清掉对方浏览器的设定**（书签、旧标签页刷新同样）。分享前把这个参数去掉，不要改成 `default`。用户 2026-11-17 定保持这个设计，靠控制台那一行说明档位为什么变了。
- **改了设定就是改了配置：** 降档记录、崩溃标记按配置的档位记（有设定时是设定，没有时是部署文件的值），改了以后这台设备记的降档、别的页面改之前留下的标记都不算，重新开始（下面"崩溃标记"）。前后实际用的值一样时（比如部署文件是 `auto`，设定从没有改成 `auto`）不算改。

## 各档的数值

| 档位 | 到多少不再加载 | 淘汰到 | 每帧上传 | 泼溅的总预算 |
|---|---|---|---|---|
| 低 | 1 GB | 0.5 GB | 16 MB | 300 万 |
| 标准 | 2 GB | 1 GB | 16 MB | 300 万 |
| 高 | 6 GB | 3 GB | 16 MB | 300 万 |
| 工作站 | 12 GB | 9 GB | 16 MB | 300 万 |

- 数值只写在 `apps/yzt/src/shared/config/scene-tier-options.ts` 一处（ADR 0155 第 1 节"app 的档位表"），`measure:3d --tier` 也按它；map-three 构造参数的默认值和标准档相同（测量工具、测试不给档位时用）。
- 2026-11-12 定（ADR 0155）；高档同日按 1920×1080 的补测从 4 GB 改为 6 GB（用户定）。标准档就是原来对所有设备一样的值。工作站档 2026-11-17 定（ADR 0166），淘汰线不是上限的一半（下面"工作站档的要求"）。
- 依据：RTX 3060 Laptop GPU（6 GB 显存）、15 GB 内存的笔记本上经开区四个姿态（z16 俯视、倾斜，z16.5 俯视，z17 倾斜）。视口 1600×900 时 4 GB 整级清楚；1920×1080 时要 4.8～5.1 GB，4 GB 还有 17～50 块放宽一级，6 GB 全部整级清楚。要的缓存随画布的像素数增长，模型占满画面时接近成正比（1600×900 到 1920×1080，像素多 44%，z16 倾斜从 3.7 GB 到 5.1 GB，多 38%）；2560×1440 时 z16 倾斜要 6.7 GB，只比 1080p 多 31%（像素多 78%）：画面超出了模型的边缘，模型只占画面的 62%（1080p 时 80%），多出来的像素里没有模型。数据见 [map-three](../modules/map-three.md)"经开区补测的结果"。
- 上传和泼溅各档相同：每帧上传管的是帧时间，和显存大小无关；泼溅预算在集显上要不要降、在工作站上要不要升都没有实测。

### 高档的要求

- 独显的显存 8 GB 以上，内存 16 GB 以上。依据（RTX 3060 Laptop、6 GB 显存、15 GB 内存）：1920×1080、6 GB 档专用显存最多用到 5.2 GB；GPU 进程（驱动）的私有内存峰值 5.8～8.5 GB，释放贴图不影响它；渲染进程释放贴图以后约 2 GB（2560×1440 下 6 GB、8 GB 档稳定时 1.9 GB、峰值 2.1～2.2 GB；1080p 没有测，不释放时是 5.1～7.2 GB）。两个进程加起来约 10 GB，所以要 16 GB 内存。释放后的这些数字是测量页旧的做法测的（`--release-images`：上传后马上关掉），产品的做法（记完账才关、只关提前传过的）还没在显卡机器上测（`docs/backlog.md`）。
- **不能超过显存：** 2560×1440、8 GB 档在 6 GB 显存上（z16 倾斜要 6.7 GB）：专用显存顶在 6.0 GB，共享 GPU 内存涨到 3.3 GB，驱动在换页，没丢 WebGL 上下文、页面也没崩。不释放贴图时明显卡顿（静止时每帧最长 342 毫秒，第一遍飞行 30 帧超过 100 毫秒）；释放以后基本不卡（各 1 帧），但整体慢，和同样顶满显存的 6 GB 档一样每帧约 90 毫秒（约 18 帧每秒），GPU 进程 10.7 GB。超过显存以后好坏看驱动和内存，只测过这一台；下面"自动降档"的两道保险都不会动作，坏的时候用户只看到卡。所以按显存给高档；屏幕比 1920×1080 大的机器要的缓存更多，显存也要更大。

### 工作站档的要求

- 独显的显存 16 GB 以上，内存 32 GB 以上，屏幕 1920×1080。现场的机器是 Quadro RTX 5000（16 GB 显存）和 RTX 4090（24 GB），内存 200 GB 以上，都是 1920×1080（2026-11-17 用户确认，ADR 0166）。
- 上限 12 GB：16 GB 的卡还给 MapLibre、系统和别的程序留出几 GB。按两种机器里小的那个定，24 GB 的 RTX 4090 用不满。
- 淘汰到 9 GB，不是上限的一半：新吴区几个模型交界处的需求估计 z17 约 4 GB、z18 倾斜 5～6.8 GB（`docs/backlog.md`）。z17 转头、平移回来，9 GB 完全盖得住，不重新下载。z18 在用的就有 5～6.8 GB，视野外只能留约 2～4 GB：两个密的 z18 视角之间转一整圈，回到前一个视角时还会重新加载一部分。淘汰线要不要往上限提，等现场测了再定（`docs/backlog.md`）。
- **显存：** 专用显存约是在用的缓存加几百 MB。视野外的瓦片留到淘汰线才淘汰，1920×1080 下在用的需求最多约 7 GB，所以缓存平时停在 9 GB 附近，专用显存估计 9.5～10 GB。现场以"专用显存低于约 13 GB、共享 GPU 内存不涨"为过。
- **内存：** GPU 进程（驱动）的私有内存随缓存增长（6 GB 档峰值 5.8～8.5 GB），工作站档估计 14～21 GB；加上渲染进程（释放贴图以后约 2 GB）和系统，要 32 GB。
- **都是外推：** 开发机没有显卡，测试的笔记本只有 6 GB 显存，没在 16 GB 以上的显卡上测过。现场核对见 `docs/backlog.md`"上线前"。不过时改数值，或者用部署文件、本浏览器的设定改用 `high`。
- **弱的机器：** `auto` 按每台机器自己的显存定档，6 GB 显存的笔记本是标准档。只有部署文件写了 `workstation`、或者这个浏览器设成了 `workstation` 时，弱的机器才按 12 GB。6 GB 显存、15 GB 内存的 RTX 3060 Laptop 上缓存超过显存只实测到 6.7 GB（上面"不能超过显存"）：明显变慢（约 18 帧每秒），没丢上下文、没降档。12 GB 在它上面没有测；按上面的估算 GPU 进程加渲染进程超过它的内存，GPU 进程或标签页可能被杀，这时按下面"自动降档"降到高档。这样的机器不能用来判断工作站档的三维效果。

## auto

按 WebGL 报的显卡型号定档（ADR 0166 修改 ADR 0155 第 3 节）：浏览器读不到显存，但型号读得到，显存按型号查表。

| 显卡 | 档位 |
|---|---|
| 软件渲染（SwiftShader、llvmpipe、Microsoft Basic Render Driver） | 低 |
| 集显（下面"集显的名字"里的名单） | 低 |
| 独显，显存表里 16 GB 以上（名字里写了显存的按名字） | 工作站 |
| 独显，8 GB 以上、不到 16 GB | 高 |
| 独显，不到 8 GB | 标准 |
| 显存表里没有；读不到型号（浏览器不给，或者换成了代表型号） | 标准 |

- **内存：** 有 `navigator.deviceMemory`（GB，按 2 的幂取整）时按它压低：低于 8 最多标准档；16 最多高档（Chrome 147 起才报 16、32，16 是 12～24 GB 内存，不够工作站档的 32 GB）；8、32 不压（Chrome 147 以前最多报 8，分不出是封顶还是真的只有 8 GB）。只有 Chromium 内核在安全上下文（https、localhost）里有：Firefox、Safari 没有，内网的 http 下也没有，这时不压。只用在 auto，配置写了档位的不压。
- **拿不准时往低定：** 定高了只会慢（超过显存时驱动换页，ADR 0155 的两道降档保险都不动作），定低了只是不够清楚。所以同名几种显存记最小的，没确认的型号不列。
- **现场和测试的机器（按表推算，上线时核对）：** NVIDIA Quadro RTX 5000（16 GB）→ 工作站档；NVIDIA GeForce RTX 4090（24 GB）→ 工作站档；NVIDIA GeForce RTX 3060 Laptop GPU（6 GB）→ 标准档。
- **浏览器：** Windows 上 Chrome、Edge 经 ANGLE 报"ANGLE (厂商, 驱动里的设备名 (0x设备号) Direct3D11 vs_5_0 ps_5_0, D3D11)"，设备号有时没有，从中取设备名。拿不到调试扩展（`WEBGL_debug_renderer_info`）时读到的是 "WebKit WebGL"，Safari 只报 "Apple GPU"：都当读不到型号，给标准档。
- **Firefox：** 默认把型号换成代表型号（结尾是 ", or similar"，规则在 `SanitizeRenderer.cpp`），防指纹时只报 "Mozilla"，认不出时报 "Generic Renderer"。auto 先认软件渲染、集显，再看读不读得到型号，所以 Firefox 下：
  - Intel 的 HD、UHD、Iris 集显换成 "Intel(R) HD Graphics" 或 "Intel(R) HD Graphics 400"，高通、ARM、苹果换成 "Adreno (TM) …"、"Mali-…"、"Apple M1"：照样认得出是集显，低档。
  - NVIDIA 换成 GTX 980 这类老型号，所有 Arc（包括集成的）换成 A750，AMD 的独显和集显换成 "Radeon R9 200 Series"、"Radeon HD 3200 Graphics" 这类，还有 "Mozilla"、"Generic Renderer"：当读不到型号，标准档。
- **Brave：** 防指纹也会改掉名字（没有核对过改成什么）。认不出的名字按"显存表里没有"给标准档，这时引号里不是型号。要在这些浏览器里用别的档位，用本浏览器的设定。
- **集显加独显的笔记本：** Chrome 可能报集显，那就是低档；在 Windows 设置 → 系统 → 显示 → 图形里把浏览器设成"高性能"（没有验证）。

### 显存表

`apps/yzt/src/shared/map/scene-tier/gpu-memory.ts`，只有数据（驱动里的设备名、显存 GB）和按名字查的函数。2026-11-17 共 267 行：

| 组 | 行数 | 标准（不到 8 GB） | 高（8～16 GB） | 工作站（16 GB 以上） |
|---|---|---|---|---|
| GeForce 台式（含 GTX 10、16，TITAN，MX） | 56 | 15 | 28 | 13 |
| GeForce 笔记本（Laptop GPU，RTX 2050） | 19 | 5 | 10 | 4 |
| NVIDIA 专业卡（Quadro、T、RTX A、Ada、RTX PRO Blackwell，台式和笔记本） | 71 | 28 | 11 | 32 |
| AMD Radeon（RX 9000～RX 470，台式和 M、S，Radeon PRO） | 98 | 30 | 42 | 26 |
| Intel Arc（A、B，Pro） | 23 | 8 | 10 | 5 |

- **名字：** 照 Windows 驱动里的设备名写，去掉开头的厂商（`NVIDIA `、`AMD `、`Intel(R) `）。比较时两边都去掉 `(TM)`、`(R)`、开头的厂商、末尾的 ` with Max-Q Design`（图灵以前的笔记本，显存和不带的一样）、末尾的 ` Graphics`、` Series`，`3050Ti` 这样连着写的补上空格，不分大小写，空白合并。**整个名字相等才算**，不按前缀、不按包含：很多台式卡的名字是笔记本卡的前缀，显存和档位不同。
- **同名几种显存记最小的：** GeForce RTX 5060 Ti（8/16）、4060 Ti（8/16）、3080（10/12）、3060（12/8）、3050（8/6）、2060（6/12）、GTX 1060（笔记本 3/6）、1050，RTX 3080 Laptop GPU（8/16）、5070 Laptop GPU（8/12）、3050 Laptop GPU（4/6），T500、Quadro P520、P2000（台式 5、笔记本 4），Arc A770（8/16）、A530M（4～8），Radeon RX 9060 XT（8/16）、9050、6500 XT、5500 XT、RX 580/570/480/470（4/8）。
- **台式和笔记本分开：** 安培起 NVIDIA 的笔记本带 ` Laptop GPU`（专业卡是 `RTX 5000 Ada Generation Laptop GPU`、`RTX PRO 5000 Blackwell Generation Laptop GPU`）：RTX 3060 8 GB 和 RTX 3060 Laptop GPU 6 GB、RTX 4080 16 GB 和 Laptop 12 GB、RTX A4000 16 GB 和 Laptop 8 GB、RTX 4000 Ada Generation 20 GB 和 Laptop 12 GB。帕斯卡、图灵的笔记本和台式同名，显存相同或更小、档位不变的才列。AMD 的 RX 6800（16）、6800M（12）、6800S（8）是三张卡。
- **名字里写了显存的按名字：** "GTX 1060 6GB"、"RTX 3050 6GB Laptop GPU"、"RTX A1000 6GB Laptop GPU"、"RTX A2000 12GB"、"T1000 8GB"、"RTX PRO 5000 72GB Blackwell"、"Radeon PRO W7800 48GB"，表里不用列。"RX 580 2048SP" 的 2048SP 是流处理器数，不是显存。Lunar Lake 的集显 "Arc(TM) 140V GPU (16GB)" 里是共享的内存：集显先分出去，不按它。
- **不列的：** 一个名字对应几张卡的（单写 "RTX 4000"、"RTX 5000"、"RTX 6000"）；同名有没确认显存的版本的（Quadro P5000、P4000，笔记本同名）；双芯的 Radeon Pro Duo（两代显存不同）；没确认的：RTX 5090 D 的 32 GB（按 D v2 的 24 GB 记，都是工作站档）、RTX 3050 OEM、RTX 3050 A Laptop GPU、TITAN V、Quadro P3000、RTX 2000E Ada、RTX 5880 Ada、RTX A4000H、RTX 6000D、各种 "Embedded GPU"、RX 6750 GRE、RX 7650 GRE、Arc A580E、A750E、Iris Xe MAX、GeForce MX 200～500。没列的按标准档。
- **还没核对的：** Quadro RTX、RTX A、Ada、Blackwell 专业卡在 Windows 上报的名字没在真机上见过，按惯例写的（Windows 上带 "NVIDIA "，如 "NVIDIA Quadro RTX 5000"）；AMD 的 RX 9060 XT 8 GB 和 16 GB 在驱动里是不是同名；Lunar Lake 的 "(16GB)" 是不是 Windows 上的设备名；Optimus 笔记本上 Chrome 选哪块卡。现场核对见 `docs/backlog.md`"上线前"。

**怎样补一行：** 在那台机器的 Chrome 或 Edge 里打开现状底图、切到三维，看控制台定档的那一行（"显存表里没有「…」"里是取出的设备名），或者在 `chrome://gpu` 看 `GL_RENDERER`；引号里要是真实的显卡型号（和设备管理器 → 显示适配器里的名字一致）才补，"浏览器不给显卡型号「…」"的、防指纹改过的名字不补；到厂商的规格页查显存，有几种的记最小的；去掉厂商，加到 `gpu-memory.ts` 对应的组里（笔记本另写一行）；在 `gpu-memory.test.ts` 或 `auto-tier.test.ts` 加一例；写不准的不加。

**来源**（2026-11-17 查的；TechPowerUp 有机器人验证，没有用）：

| 内容 | 来源 |
|---|---|
| GeForce 台式、笔记本 | nvidia.com 的 [台式对比](https://www.nvidia.com/en-us/geforce/graphics-cards/compare/)、[笔记本对比](https://www.nvidia.com/en-us/geforce/laptops/compare/)、[50 系笔记本](https://www.nvidia.com/en-us/geforce/laptops/50-series/)、[30 系笔记本](https://www.nvidia.com/en-us/geforce/laptops/30-series/)，国内版（RTX 4090 D、5090 D v2）见 [nvidia.cn 的对比](https://www.nvidia.cn/geforce/graphics-cards/compare/) |
| GTX 10、16，RTX 20（NVIDIA 已撤下页面） | 维基百科 [GeForce 10 series](https://en.wikipedia.org/wiki/GeForce_10_series)、[GTX 16 series](https://en.wikipedia.org/wiki/GeForce_GTX_16_series)、[RTX 20 series](https://en.wikipedia.org/wiki/GeForce_RTX_20_series) |
| NVIDIA 专业卡 | [专业台式卡](https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/)、[专业笔记本对比](https://www.nvidia.com/en-us/products/workstations/professional-laptops/compare/)、[以前的 Quadro 台式卡](https://www.nvidia.com/en-us/products/workstations/previous-quadro-desktop-gpus/)、[Quadro 台式规格](https://www.nvidia.com/en-in/drivers/quadro-desktop-gpu-specs/)；移动专业卡的产品单页（[2024](https://images.nvidia.com/aem-dam/en-zz/Solutions/design-visualization/documents/proviz-rtx-mobile-line-card.pdf)、[2021](https://www.nvidia.com/content/dam/en-zz/ja/Solutions/design-visualization/documents/nvidia-rtx-line-card-for-mobile-workstation-jp.pdf)、[2019](https://www.nvidia.com/content/dam/en-zz/Solutions/design-visualization/documents/quadro-mobile-pro-graphics-line-card-us-r1-hr.pdf)） |
| NVIDIA 驱动里的名字、设备号 | [Linux 驱动 620.70.06 支持的芯片](https://download.nvidia.com/XFree86/Linux-x86_64/620.70.06/README/supportedchips.html)，[pci.ids](https://pci-ids.ucw.cz/v2.2/pci.ids)（2026.11.16） |
| AMD | [显卡规格](https://www.amd.com/en/products/specifications/graphics.html)、[专业显卡规格](https://www.amd.com/en/products/specifications/professional-graphics.html)；RX 5500 XT 的 4 GB 见 AMD 的发布稿 |
| Intel | ark 的 [Arc 独显](https://www.intel.com/content/www/us/en/ark/products/series/227960/intel-arc-dedicated-graphics-family.html)、[Arc Pro](https://www.intel.com/content/www/us/en/ark/products/series/241359/intel-arc-pro-dedicated-graphics-family.html)，B580、B570、Pro B50、B60、B65、B70、A530M 的规格页 |
| ANGLE 的写法 | ANGLE 源码 `Renderer11.cpp`（getRendererDescription）、`Display.cpp`（generateRendererString）；网上见过的真实写法：Mozilla 的 [bug 1916271](https://bugzilla.mozilla.org/show_bug.cgi?id=1916271)、[castle.io 的文章](https://castle.io/blog/the-role-of-webgl-renderer-in-browser-fingerprinting)、Steam 硬件调查 |
| Firefox 换型号 | Firefox 源码 `SanitizeRenderer.cpp`、`ClientWebGLContext.cpp`，首选项 `webgl.sanitize-unmasked-renderer` |
| `navigator.deviceMemory` | [Chrome 147 的发布说明](https://developer.chrome.com/release-notes/147)、MDN、W3C Device Memory |

### 集显的名字

按其中的设备名对名单（规则在 `apps/yzt/src/shared/map/scene-tier/renderer-class.ts`，`measure:3d` 也导入它）。名单以外的当独显，去查显存表：判成低会让 Arc Pro 这类专业卡吃亏，新的集显要补进名单。

| 设备名里有 | 分到 | 来源 |
|---|---|---|
| Intel 的 `HD Graphics`、`UHD Graphics` | 集显 | HD Graphics 在网上的 WebGL 报告里见过（"Intel(R) HD Graphics 4600"）；UHD 按产品名推测 |
| Intel 的 `Iris(R) Graphics`、`Iris(R) Xe Graphics`、`Iris(R) Plus Graphics`、`Iris(TM) Plus Graphics`（Kaby Lake 的 640、650，macOS 上也这样报）、`Iris(TM) Pro Graphics` | 集显 | 按产品名推测；Iris Xe MAX 是独显，不在名单里 |
| Intel 不带型号的 `Arc(TM) Graphics`、`Arc(TM) Pro Graphics`（Meteor Lake 起） | 集显 | 按产品名推测 |
| Intel 的 `Arc(TM) 140V`、`130V`（Lunar Lake），`140T`、`130T`（Arrow Lake） | 集显 | 140V 是驱动的设备名 "Intel(R) Arc(TM) 140V GPU (16GB)"（OpenGL 报的名字）；其余按产品名推测 |
| Intel 的 `Arc(TM) B390`、`B370`（Panther Lake 集成的 Arc） | 集显 | 按产品名推测 |
| 不带系列名的 `Intel(R) Graphics` | 集显 | 按产品名推测 |
| AMD 不带型号的 `Radeon(TM) Graphics`、`Radeon (TM) Graphics`（带空格）、`Radeon Graphics` | 集显 | 网上的 WebGL 报告里见过前两种（带空格的见 castle.io 的文章、Steam 硬件调查） |
| AMD 的 `780M` 这类三位数加 M、`8060S` 这类四位数加 S、`Radeon Vega 8 Graphics`、`Radeon(TM) RX Vega 11 Graphics`（Ryzen 2400G、3400G、2700U、3700U 的集显）、`R7 Graphics` | 集显 | 按产品名推测 |
| 高通 Adreno（Windows on ARM）、苹果 M 系列、ARM Mali | 集显 | 按产品名推测 |
| 名单以外的：NVIDIA，独立的 Arc（A770、A370M、Pro A60M、Pro B60、B580），Iris Xe MAX，Radeon RX（独立的 RX Vega 56、64 报 "Radeon RX Vega"，后面不带 Graphics；老驱动的 "Radeon (TM) RX 480 Graphics" 带 RX），Radeon Pro，认不出的 | 独显，查显存表 | RTX 3060 Laptop GPU 在显卡机器上见过；其余按产品名推测 |

有了典型的客户机器（`docs/backlog.md`）后在它的浏览器里读一次核对。NVIDIA 的 RTX Spark N1X 这类 ARM 芯片的显卡和内存共用，不在名单里，也不在显存表里，按标准档。

## 控制台里定档的一行

第一次打开三维、定下档位时，控制台（开发者工具 → Console，过滤 `[scene-tier]`）写一行，现场按它核对：

| 情况 | 例子 |
|---|---|
| 部署文件写 `auto`，查到显存 | `[scene-tier] 三维档位：工作站档（auto：NVIDIA Quadro RTX 5000，16 GB）` |
| 内存压低了 | `[scene-tier] 三维档位：高档（auto：NVIDIA GeForce RTX 4090，24 GB；内存 16 GB，最多高档）` |
| 表里没有、读不到型号、集显、软件渲染 | `[scene-tier] 三维档位：标准档（auto：显存表里没有「NVIDIA GeForce GTX 980」）`；`浏览器不给显卡型号「…」`；`集显「Intel(R) UHD Graphics 620」`；`软件渲染「…」` |
| 部署文件写了档位 | `[scene-tier] 三维档位：工作站档（部署文件）` |
| 本浏览器的设定 | `[scene-tier] 三维档位：高档（本浏览器设定）`；设定是 `auto` 时 `（本浏览器设定 auto：…）` |
| 读不到部署文件 | `[scene-tier] 三维档位：标准档（读不到部署文件，按 auto：…）` |
| 这台设备崩溃后降过档 | `[scene-tier] 三维档位：高档（部署文件；这台设备崩溃后降过档，原来是工作站档）` |

一个页面只写一次；之后丢上下文降档不再写。

## 自动降档

- WebGL 上下文丢了：这次会话降一档，不提示（画面重新加载一次，内容不变）。连续丢就一直降到低档。
- 上次打开三维时页面崩溃（标签页被浏览器杀掉）：下次打开三维时降一档，并提示，提示里能恢复原来的画质（下面"崩溃标记"）。
- 都按档位的顺序一次降一档（工作站 → 高 → 标准 → 低），不跳档。没记降档时不封顶，配置写的哪一档、auto 定的哪一档就用哪一档：代码里最高的一档取档位表的最后一个，不写死档位名。

崩溃降档的提示在地图区域上方，样式同"地图样式加载失败"的横条（[shared-map](../modules/shared-map.md)"地图状态的提示"），只在三维里显示；一个页面只提示一次，关掉不再出，降下来的档位留在这台设备上。文字和按钮 2026-11-13 用户定，三条统一说法，句末不加句号：

| 情况 | 提示 | 按钮 |
|---|---|---|
| 崩溃后降档 | 三维画质已自动降低：上次进入三维模式时页面发生崩溃 | 恢复原来的画质、知道了 |
| 用户恢复过画质，以后的页面又崩 | 三维画质已自动降低：上次进入三维模式时页面发生崩溃，恢复后再次出现崩溃 | 恢复原来的画质、知道了 |
| 恢复了画质的页面又崩，不能再恢复 | 三维画质已自动降低：恢复后页面再次发生崩溃。如需恢复，请联系管理员调整配置 | 知道了 |

## 崩溃标记

ADR 0155 第 4 节定的是"按页面的标记、打开三维时确认留下标记的页面还在不在、可以恢复"，这里是做法（2026-11-13 实现）。标记和降档记录经 `shared/storage` 的设备级同步存储（[storage.md](../modules/storage.md)"设备级的同步存储"）写进 localStorage。下面说的"配置的档位"是本浏览器的设定，没有设定时是 `scene-tier.json` 的值（ADR 0166）。

- **键：** 每个页面一个键：前缀加页面 id，各写各的，没有跨页面的"读、改、写"（一份 `{ id: … }` 的 JSON 会互相覆盖：A 读到 {A, B}、B 正常离开写成 {A}、A 再写回 {A, B}，B 下次就被当成崩溃）。键是 `yzt.device.scene-tier:page:<页面 id>`，值是这个页面现在的档位、当时配置的档位，和这个页面是不是恢复过画质（`{ tier, configured, restored }`；没有设定、也没读到 `scene-tier.json` 的页面 `configured` 是 `null`）。页面 id 每次打开、刷新都新生成，不存 sessionStorage：重新加载崩溃的标签页时是一个新的页面，才认得出旧的那个。内网走 HTTP，不是安全上下文，没有 `crypto.randomUUID`，用 `crypto.getRandomValues` 生成。
- **什么时候写、删：** 档位高于低、三维开着、页面可见时写（打开三维、恢复了画质、重新可见），档位变了就改写（丢上下文降了一档也要改：不改的话按 high 打开、降到 standard 以后被杀，下一个页面按 high 的下一档降，正好是刚崩过的 standard）；切回二维、离开地图页（被缓存的地图页停用时视图暂停，模型层撤下）、隐藏（`visibilitychange`）、`pagehide`、`freeze`、档位降到低时删自己的，`resume`、`pageshow`、重新可见时写回。不存时间：判断还在不在不看时间，崩溃后最常见的是马上点"重新加载"，那个标记的时间最新。
- **确认还在不在：** 要写标记的页面先开一个很小的 Worker，Worker 听 BroadcastChannel，替页面回答"我还在"；Worker 回报就绪以后才写标记，不然刚写上就被问到会答不上。页面主线程忙着加载三维时 Worker 照样马上回答，页面崩溃时 Worker 跟着没了，所以"忙"和"死"分得开。打开三维时有别的页面的键才问，等到它们都回答或者 2 秒，没回答、超时后再读一次键还在的算崩溃；等的时候键没了的不算（那个页面正常关闭、刷新时删了自己的，或者同时检查的页面已经认定并删了）。键里配置的档位和现在的不同的旧标记不算，直接删掉：部署方改了配置、用户改了本浏览器的设定以后重新开始，不能被改之前留下的标记绕过；`null`（那个页面没读到配置）的照样算。自己没读到配置的页面不问、不删。
- **键被误删了补回来：** 内存紧张、系统换页时（正是这份 ADR 针对的情况）Worker 也可能 2 秒内答不上，检查的页面会把一个活着的页面当成崩溃、删掉它的键。所以检查的页面删键以后广播一次"删了谁的"，被删的页面的主线程也听着这个频道，闲下来收到时补写。删键之后一定有这条广播，不另外经 Worker 转告询问（ADR 写的是两条路，实现只用这一条）。这一次误判照样降了一档（能恢复），补写以后它真崩了还能发现。
- **等不等：** 没有别的页面的键时不等；有的话先等完，再按结果的档位创建渲染器。二维稳定后空闲时预加载 map-three（[map-overview](../modules/map-overview.md)）只下载模块、读配置（本浏览器的设定或 `scene-tier.json`），不问别的页面：问是"打开三维"的一部分，在二维时发现崩溃，这个页面可能一直不开三维，提示就没人看见。所以没有下载可以藏这段等待；别的页面还开着时几毫秒就答完，只有真的崩溃了才等满 2 秒。检查出错时按读到的配置和记的降档照常创建渲染器，不让三维因为检查打不开。Web Locks 能让浏览器自己判断页面还在不在，但只在安全上下文里有，内网的 HTTP 用不了。
- **降档和去重：** 降到"崩溃页面当时的档位（它的键里存的）的下一档"和这台设备已经记的上限里更低的那个，不是在现在的基础上再降一档：两个页面同时发现同一次崩溃，结果一样，不会从高直接降到低。已经记的上限在确认崩溃以后重新读：同时发现这次崩溃的页面可能刚写过。确认崩溃后马上删掉它的键。两个页面同时检查时，先认定的那个删键、记降档、提示；晚到的再读键时已经没了，不算这次发现的崩溃，但没发现崩溃时也重新读记的降档，按先认定的页面刚写的上限降，不再提示。各页面的 localStorage 跨进程同步，可能有先后：晚到的页面看到键已经删了、还没看到新的记录时，这一次按没降的档位运行、也不提示，记录已经写下，下一个页面照用；两个页面都还看到键时，可能各提示一次。
- **设备记的降档：** 键是 `yzt.device.scene-tier:record`，记上限、能不能恢复、用户恢复过没有（提示里注明"恢复后又崩溃过"用），和当时配置的档位（`{ configured, cap, restorable, restoredBefore }`）；崩溃时的档位不另外记，上限就是按它算的。配置的档位变了（改了 `scene-tier.json`，或者改了、清掉了本浏览器的设定）就清掉，重新从配置开始；没有设定、又读不到 `scene-tier.json` 时不算变了，不清。
- **恢复：** 提示里的"恢复原来的画质"立即生效（渲染器改预算），清掉上限，并按升上去的档位改写标记、记上"这个页面恢复过"（不写的话再崩发现不了）。崩溃的页面恢复过（键里有记），说明恢复了马上又崩，降档记成不能恢复，提示里不再给"恢复"：只能部署方改配置、用本浏览器的设定换一个档位，或者在那台机器的浏览器里只删 localStorage 的 `yzt.device.scene-tier:record` 这一个键（开发者工具 → Application → Local Storage → 这个站点）。不要用"清除站点数据"：它会一起删掉偏好的 IndexedDB（`yzt-preferences`：这个浏览器里所有账号的底图、注记、边界、资源图层、图层里的三维模型和图层顺序、面板设置，以及按 ADR 0154 只存在这个浏览器里、还没导出的图例样式）、本浏览器的设定和登录会话。以后的页面再崩（重新打开、刷新以后，包括关机、断电这类误判）照样给"恢复"，提示里注明"恢复后又崩溃过"：一次误判不会让这台设备永久降档。
- **会误判成崩溃的：** 系统关机、结束浏览器、断电（几个页面的标记一起留下，按一次崩溃算）；内存紧张、系统换页时 Worker 2 秒内没答上（键会补回来，见上）。后台被节流、冻结、丢弃的标签页不算：隐藏时没有标记。

## 代码在哪

| 文件 | 内容 |
|---|---|
| `apps/yzt/public/scene-tier.json` | 发布的配置（现在是 `auto`） |
| `apps/yzt/src/shared/config/scene-tier-options.ts` | 档位的顺序、中文名和各档的数值，只写常量（测量工具也导入） |
| `apps/yzt/src/shared/config/scene-tier-file.ts` | 读、校验 `scene-tier.json` |
| `apps/yzt/src/shared/map/scene-tier/renderer-class.ts` | 按显卡的名字分软件渲染、集显（测量工具也导入） |
| `apps/yzt/src/shared/map/scene-tier/gpu-memory.ts` | 显存表，从渲染器的名字取设备名、查显存 |
| `apps/yzt/src/shared/map/scene-tier/auto-tier.ts` | `auto` 的档位和依据：软件渲染、集显，按显存定档，按内存压低 |
| `apps/yzt/src/shared/map/scene-tier/browser-setting.ts` | 本浏览器的设定：读地址栏、存取、地址栏该显示的值 |
| `apps/yzt/src/app/scene-tier-setting.ts` | 这个页面用的设定：启动时读一次地址栏，现状底图的地址和三维共用 |
| `apps/yzt/src/app/router/scene-tier-query.ts` | 现状底图的导航带上这个页面的设定（`?scene-tier=`） |
| `apps/yzt/src/shared/map/scene-tier/crash-markers.ts` | 标记和降档记录的读写、问别的页面还在不在 |
| `apps/yzt/src/shared/map/scene-tier/scene-tier-ping.worker.ts` | 替页面回答"还在"的 Worker（处理函数在 `scene-tier-ping-handlers.ts`） |
| `apps/yzt/src/shared/map/scene-tier/scene-tier.ts` | 预算来源 `SceneTierSource`（map-core 的 `SceneBudgetSource`）：配置的档位、auto、降档、标记、提示的状态，控制台里定档的一行 |
| `apps/yzt/src/app/map-runtime-provider.ts` | 一个页面建一个预算来源，注入的三维引擎打开三维前等它准备好；预加载只读配置 |
| `apps/yzt/src/shared/map/MapStatusNotice.tsx` | 降档的提示 |
