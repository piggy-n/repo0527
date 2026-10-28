# 加载耗时的标记与实测（shared/perf）

对应目录：`apps/web/src/shared/perf/`（标记）、`apps/web/src/shared/map/useMapLoadMarks.ts`（地图页的标记）、`apps/web/tools/measure-map-load/`（实测脚本）

5E 的加载策略按"先实测、再定方案"（[map-core.md](map-core.md)"地图资源的加载策略"第 8 条）：先给"点击登录 → 地图第一次加载完成"打上标记，在不同网络下测出时间花在哪里，再决定要不要预加载、预加载什么。标记留在产物里，三维阶段和阶段七复测时直接用。

## 标记

用浏览器标准的 User Timing（`performance.mark` / `measure`）：DevTools 的 Performance 面板在 Timings 一栏直接显示，Playwright 也能读出来；不上报到后端。

`LoadTrace` 表示一段有先后步骤的加载过程：

```ts
const trace = new LoadTrace('login-to-map', ['session', 'runtime', 'page', 'view-ready', 'settled']);
trace.begin();          // 开始新的一轮：清掉上一轮的标记，记下 login-to-map:start
trace.mark('session');  // 记下 login-to-map:session，并量出从 start 到现在（measure 同名）
```

- 每个步骤在一轮里只记第一次；记到最后一个步骤时这一轮结束，之后再 `mark` 什么也不做
- 不在一轮里时什么也不记：刷新地图页时没有开始的标记，就不会留下一条没有起点的记录
- 步骤可以跳过（例如视图失败时停在 `page`），不检查先后顺序
- 标记出错时吞掉（例如别处清掉了开始的标记，`measure` 找不到它会抛错），不能影响登录和地图
- 时间线是构造参数（`Timeline`，只有 `mark`、`measure`、`clearMarks`、`clearMeasures`），默认是全局的 `performance`，测试时换成记录调用的对象

### 登录到地图（`loginToMap`）

| 步骤 | 时刻 | 在哪里记 |
|---|---|---|
| 开始 `start` | 校验通过、发出登录请求之前（校验不通过的点击不算） | `useLoginForm` |
| `session` | 登录接口成功返回；表单已经销毁时不记 | `useLoginForm` |
| `runtime` | 运行时和地图页分块都加载完、运行时设置好、Worker 池开始预热（ADR 0061 第 2 节；5E.1 时只等运行时） | `app/map-framework.ts` 的 `withMapRuntime` |
| `page` | 地图页开始创建（setup），页面分块已经加载 | `useMapLoadMarks` |
| `view-ready` | 视图就绪：样式加载完成（MapLibre 的 `style.load`），可以操作，瓦片可能还没到 | `useMapLoadMarks` |
| `settled` | 第一次画面稳定：没有动画，视野里的瓦片和省界都已画出（MapLibre 的 `idle`） | `useMapLoadMarks` |

步骤的清单是 `LOGIN_TO_MAP_STEPS`，实测脚本的 `STEPS` 和它一致（`tools/measure-map-load/report.test.ts` 保证）；加步骤时两边一起改。

### 切到三维（`switchTo3d`，3D.5a）

第一次切到三维时才加载 Cesium（ADR 0079 第 2 节），是否预加载按实测决定。每次点"三维"开始一轮：

| 步骤 | 时刻 | 在哪里记 |
|---|---|---|
| 开始 `start` | 点"三维"：上下文的 `dimension` 变成 `3d` 的同一刻（同步侦听） | `shared/map/useSwitchTo3dMarks` |
| `runtime` | 三维运行时（map-cesium 的分块，含 Cesium）加载完、设置好；之后再切换不加载，这一步不记 | `app/map-framework.ts` 的 `prepareMapRuntime` |
| `view-ready` | 三维视图就绪 | `useSwitchTo3dMarks` |
| `settled` | 三维第一次画面稳定（场景的 `settle`：相机停下、视野里的瓦片都已画出） | `useSwitchTo3dMarks` |

步骤的清单是 `SWITCH_TO_3D_STEPS`，实测脚本的 `SCENE_STEPS` 和它一致（`tools/measure-map-load/scene-report.test.ts` 保证）。切回二维、页面卸载时停止等待，这一轮停在已经记下的步骤；上下文的当前视图按种类取，切过去时三维视图还没挂上，`whenReady` 等的就是新挂上的三维视图。

### 画面稳定

视图就绪对应 MapLibre 的 `style.load`，这时瓦片还没到；用户看到完整的地图是在 `idle` 之后。所以：

- map-core 的视图加了 `settle` 事件：MapLibre 发出 `idle`、视图处于 `ready` 时触发；加载中、暂停时的 `idle` 不算（加载中样式还没生效，暂停时显示的是另一个视图）。不叫 `idle`，是因为 map-vue 里 `idle` 表示"还没有视图"
- map-vue 的上下文加了 `whenSettled(signal?)`，和 `whenReady` 一样绑定具体的视图：等到它下一次画面稳定；没有视图时等视图挂上；视图被卸下或替换、上下文释放时以 `AbortError` 结束，`signal` 中止时以它的原因结束
- libs 里不打标记（不读全局单例），`shared/map/useMapLoadMarks(map)` 在 `provideMap` 所在组件的 setup 里调用：不在一轮里时直接返回；否则记下 `page`，再依次等 `whenReady`、`whenSettled`，页面卸载时中止等待

真实的 MapLibre 上由浏览器测试确认：首次加载时 `settle` 在进入 `ready` 之后发出，那时初始样式的数据已经画出。

## 实测脚本

```bash
pnpm --filter @yzt/web measure:map-load
```

先 `vite build`，再用 `vite preview` 提供构建产物（接口按 `vite.config.ts` 的代理转发到后端），用 Playwright 打开登录页、登录、等到画面稳定，每档网络测几次取中位数。参数加在命令后面，例如 `pnpm --filter @yzt/web measure:map-load --runs 3 --profiles slow4g --label baseline`。

对比几种做法时，先把每种做法各自构建到一个目录（`vite build --outDir tools/measure-map-load/builds.local/<名称>`，`*.local` 不入库），再不经过构建直接运行脚本：

```bash
pnpm --filter @yzt/web exec node tools/measure-map-load/cli.ts --runs 3 --label variants --builds "baseline=tools/measure-map-load/builds.local/baseline,preload=tools/measure-map-load/builds.local/preload"
```

账号密码从环境变量读取，在自己的终端里设置（PowerShell 是 `$env:YZT_MEASURE_LOGIN_NAME = '...'`、`$env:YZT_MEASURE_PASSWORD = '...'`）：

| 环境变量 | 说明 |
|---|---|
| `YZT_MEASURE_LOGIN_NAME` | 登录用的账号 |
| `YZT_MEASURE_PASSWORD` | 密码；脚本只填进登录框，不打印、不写进结果文件 |

| 参数 | 默认 | 说明 |
|---|---|---|
| `--builds` | `dist=dist` | 要测的构建，写成 `名称=目录,名称=目录`（目录相对 `apps/web`）；有多份时每份各起一个 `vite preview`，每档网络的第 i 次依次测完所有构建再进入下一次（网络的波动平均分到每一份上），最后多输出一张对比表，第一份是参照 |
| `--runs` | 5 | 每档网络测几次 |
| `--profiles` | `none,fast4g,slow4g` | 网络：不限速、Fast 4G、Slow 4G |
| `--dwell` | 5000 | 登录页停留的毫秒数，模拟输入账号密码；预加载在这段时间里进行 |
| `--cpu` | 1 | CPU 降速倍数（`Emulation.setCPUThrottlingRate`） |
| `--channel` | `msedge` | `msedge`、`chrome` 或 `chromium`（Playwright 自带） |
| `--headless` | 不加 | 加上时无界面运行；默认有界面，用真实的 GPU 渲染 |
| `--label` | `run` | 结果文件名的前缀，如 `baseline`、`preload` |
| `--url` | — | 已经在运行的服务器；不给时由脚本启动 `vite preview`；不能和 `--builds` 一起用 |
| `--timeout` | 120000 | 每一次从点击登录到画面稳定最多等多久；切到三维的也等这么久 |
| `--scenario` | `login` | `login` 测登录到地图；`switch-3d` 测进了地图以后第一次切到三维（3D.5a） |
| `--stay` | 5000 | `switch-3d`：二维画面稳定以后停留多少毫秒再点"三维"，模拟先看一会儿二维；预加载在这段时间里进行 |
| `--mock-backend` | 不加 | 不连后端：在浏览器里拦下 `/backend` 的请求，登录给假的 token、资源目录为空，不用账号；配内网构建（不请求天地图）时整个实测不出本机，用来比较几种做法的相对差别 |

`switch-3d` 每一次：新的浏览器上下文、限速、登录，等到 `login-to-map:settled`，停留 `--stay` 毫秒，读一次 JS 堆（CDP 的 `JSHeapUsedSize`，先回收），点"三维"，等到 `switch-to-3d:settled`，再读一次 JS 堆。输出的表：步骤；map-cesium 分块、Cesium 运行时文件（复制到产物 `cesium/` 的 Worker 脚本和资源）的完成时刻；停留期间和点了以后各下载了多少；JS 堆增加多少；二维停留期间的长任务（预加载执行脚本会不会卡住二维）。

两档限速取 Chrome DevTools 的预设（DevTools 按 0.9 折算吞吐量、放大延迟）：

| 档 | 下行 | 上行 | 延迟 |
|---|---|---|---|
| Fast 4G | 8.1 Mbps | 1.35 Mbps | 165 ms |
| Slow 4G | 1.44 Mbps | 675 kbps | 562.5 ms |

每一次实测：

1. 新的浏览器上下文：缓存、IndexedDB 都是空的，相当于第一次访问的新用户
2. CDP 设置限速（和 CPU 降速），打开 `/login`，等页面加载完，停留 `--dwell` 毫秒
3. 填入账号密码、点"登录"；等到 `login-to-map:settled` 出现，或者出现登录失败的提示（立即停止整个实测）、超时
4. 读出各步骤的 measure、全部完成的请求（Playwright 的 `requestfinished`：完成时刻、压缩后的大小）、长任务（页面最先执行的 `PerformanceObserver`）、画面稳定时还没下载完的请求

输出三张表（步骤、资源的完成时刻、登录页停留期间的长任务）和还没下载完的请求，原始数据写进 `tools/measure-map-load/results.local/<label>-<时间>.json`（`*.local` 不入库）。表里只取画面稳定了的几次；资源的完成时刻从开始量起，负数表示点登录之前已经下载完。

### 实测的前提（2026-10-16 核实）

- **不禁用缓存**：每次都是新的上下文，缓存为空，和第一次访问一样。起初按原则第 8 条禁用了缓存，试跑发现 MapLibre 的 4 个 Worker 各下载一次 Worker 脚本，Slow 4G 下画面稳定晚约 2 秒；真实的第一次访问里，后 3 个请求等第一个下载完后从缓存里取
- **限速对 Worker 的请求同样生效**：页面级 CDP 的 `Network.emulateNetworkConditions` 也作用于专用 Worker 里的 `fetch`（Edge 上下载 300 KB：主线程 2287 ms、Worker 2298 ms）。MapLibre 在 Worker 里下载省界和矢量瓦片，这一点不成立的话 Slow 4G 的数字会偏小
- **请求记录**：页面级 CDP 的网络事件里没有 Worker 自己发出的请求，所以用 Playwright 的请求事件（它能看到）；Worker 脚本本身的大小两边都取不到，表里只写完成时刻（按产物计算 gzip 后约 142 KB）
- **预览服务器和生产的差别**：文本资源都是 gzip，和生产相同；缓存头是 `no-cache` 加 ETag，同一次访问里重复的请求（4 个 Worker 的脚本）有一次 304 往返，生产给 `/assets/*` 设 `immutable` 后没有（阶段七）
- **浏览器**：本机没有安装 Chrome，Playwright 自带的完整 Chromium 启动失败（spawn UNKNOWN），无界面的 headless shell 用软件渲染，所以默认用 Windows 自带的 Edge 有界面运行
- CDP 的限速是给每个请求加延迟、限制总吞吐量，不模拟丢包和拥塞

脚本本身用本地的假后端（登录返回假的 JWT、资源目录为空）试跑过，上面"禁用缓存"的问题就是这样发现的；试跑的其他发现和下面的基线一致。

## 基线（2026-10-16）

现在的做法（不预加载）：真实后端、真实天地图，新用户（没有偏好，没有勾选资源），Edge 有界面运行，登录页停留 5 秒，每档 5 次全部完成。每档 5 次之间画面稳定的时刻相差不到 0.4 秒（不限速 1110～1325 ms，Fast 4G 3308～3343 ms，Slow 4G 17249～17581 ms），5 次够用。原始数据 `results.local/baseline-2026-10-16T07-13-00.879Z.json`。

步骤（毫秒，从发出登录请求算起，中位数）：

| 网络 | 登录接口返回 | 地图运行时 | 地图页创建 | 视图就绪 | 画面稳定 |
|---|---|---|---|---|---|
| 不限速 | 54 | 104 | 172 | 258 | 1259 |
| Fast 4G | 233 | 1001 | 1421 | 1505 | 3327 |
| Slow 4G | 649 | 4386 | 6950 | 7051 | 17548 |

各段的耗时（后一步减前一步）：

| 段 | 不限速 | Fast 4G | Slow 4G |
|---|---|---|---|
| 登录请求 | 54 | 233 | 649 |
| 下载 maplibre-gl | 50 | 768 | 3737 |
| 下载地图页分块 | 68 | 420 | 2564 |
| 加载样式（到视图就绪） | 86 | 84 | 101 |
| 瓦片、Worker、省界（到画面稳定） | 1001 | 1822 | 10497 |

资源的完成时刻（毫秒，括号里是压缩后的大小）：

| 网络 | maplibre-gl | 地图页分块 | Worker 脚本 | 省界 | 资源目录 | 天地图瓦片（最后一张） | 开始后下载的总量 |
|---|---|---|---|---|---|---|---|
| 不限速 | 89（268 KB） | 125（155 KB） | 326 | 483（139 KB） | 192（24 KB） | 945（82 张，621 KB） | 6641 KB |
| Fast 4G | 988（268 KB） | 1376（155 KB） | 2447 | 3091（139 KB） | 1631（24 KB） | 3017（82 张，621 KB） | 6422 KB |
| Slow 4G | 4372（268 KB） | 6900（155 KB） | 14446 | 17444（139 KB） | 9645（24 KB） | 13829（82 张，621 KB） | 1289 KB |

画面稳定时还没下载完的请求：Fast 4G 是 SemiBold（5/5 次），Slow 4G 是 Regular 和 SemiBold（5/5 次）；不限速时没有。登录页停留期间没有长任务。

从数据看时间花在哪里：

- **两个分块是先后下载的**：`withMapRuntime` 先导入运行时、再加载页面，"下载 maplibre-gl"和"下载地图页分块"两段加起来占 Fast 4G 的 36%（1188 ms）、Slow 4G 的 36%（6301 ms）。预加载省的就是这两段，前提是登录页停留期间下得完
- **视图就绪之后最长**：最后到的是 Worker 里下载的省界，它要等 Worker 脚本下完才开始（Slow 4G 下 Worker 脚本 14.4 s、省界 17.4 s，瓦片在 13.8 s 已经下完）。Worker 脚本在创建地图时才开始下载，预热 Worker 池能把它挪到登录页上
- **字体在抢带宽**：普惠体按授权不能子集化（[design/fonts.md](../design/fonts.md)），两个字重各约 5.2 MB。Regular 在登录页开始下载，Fast 4G 下点登录时还没下完；SemiBold 在登录后开始下载。"开始后下载的总量"在不限速、Fast 4G 下大部分是字体。只有 maplibre-gl 一个请求时，Slow 4G 下 268 KB 约要 2.1 s（1.49 s 传输加一次往返），实测 3.7 s，Fast 4G 下约要 0.43 s，实测 0.77 s，差的部分基本是被字体分走的带宽。这只影响第一次访问，之后字体在缓存里
- **主线程**：每次有两个 100 ms 左右的长任务。一个在地图页创建前后（执行页面分块、setup 和第一次渲染，约 110 ms），一个在资源目录到达时（规范化目录，80～120 ms），两者都不在登录页上
- 登录接口本身很快（不限速 54 ms），限速时主要是往返的延迟；加载样式只要约 100 ms

15 分钟后用同样的命令复测了一次（`baseline-2026-10-16T07-28-58.702Z.json`），画面稳定只差 14～32 ms，视图就绪最多差 69 ms，实测可以复现。

## 5E.2 的对比实验（2026-10-16）

6 份构建在同一轮里交替测量（`--builds`，每档 3 次，其余条件同基线），原始数据 `results.local/variants-2026-10-16T07-57-43.314Z.json`。除了基线，每份都是一处本地改动，构建后还原，不提交：

| 构建 | 改动 |
|---|---|
| baseline | 当时的 `main` |
| preload | 进入登录页后，浏览器空闲时（`requestIdleCallback`，超时 2 秒）导入路由用的同一个加载函数：运行时和地图页分块 |
| prewarm | 在 preload 上，`setupMapRuntime` 设置好 Worker 后调用 MapLibre 的 `prewarm()` |
| parallel | 不预加载，`withMapRuntime` 同时导入运行时和页面 |
| no-polyclip | 求交换成空实现（新用户不选区划，走不到它），地图页分块 155 KB → 140 KB（压缩前 497 KB → 455 KB） |
| no-fonts | 产物里删掉两个 woff2，字体请求 404，用后备字体 |

画面稳定（毫秒，中位数，括号里是和 baseline 的差）：

| 构建 | 不限速 | Fast 4G | Slow 4G |
|---|---|---|---|
| baseline | 1241 | 3328 | 17533 |
| preload | 1123（-118） | 2374（-953） | 13983（-3550） |
| prewarm | 1110（-131） | 2244（-1084） | 11797（-5736） |
| parallel | 1192（-49） | 3193（-135） | 16065（-1468） |
| no-polyclip | 1175（-66） | 3326（-2） | 17394（-138） |
| no-fonts | 1193（-48） | 2993（-335） | 11829（-5704） |

视图就绪（毫秒，中位数）：

| 构建 | 不限速 | Fast 4G | Slow 4G |
|---|---|---|---|
| baseline | 315 | 1521 | 7021 |
| preload | 204（-111） | 344（-1177） | 3496（-3525） |
| prewarm | 215（-100） | 347（-1174） | 4323（-2698） |
| parallel | 272（-43） | 1337（-183） | 5566（-1455） |
| no-polyclip | 290（-25） | 1528（+7） | 6888（-132） |
| no-fonts | 309（-6） | 1245（-276） | 4692（-2329） |

所有构建在登录页停留期间都没有长任务：预加载在登录页上执行 maplibre-gl 和地图页分块，没有超过 50 ms 的任务。

预加载的资源什么时候下载完（毫秒，从发出登录请求算起，负数是点登录之前）：

| 构建 | 网络 | maplibre-gl | 地图页分块 | Worker 脚本 | 省界 |
|---|---|---|---|---|---|
| preload | Fast 4G | -3925 | -3383 | 1557 | 2224 |
| preload | Slow 4G | 813 | 3337 | 10875 | 13875 |
| prewarm | Fast 4G | -3913 | -3216 | -3152 | 1555 |
| prewarm | Slow 4G | 802 | 4168 | 4063 | 11671 |

看到的：

- **预加载**：Fast 4G 下点登录时两个分块早已下完，视图就绪从 1.5 s 变成 0.34 s，登录后几乎马上看到地图。Slow 4G 下 5 秒的停留不够（还在和 Regular 字体分带宽），maplibre-gl 在点登录后 0.8 s、地图页分块 3.3 s 才下完，仍然比基线早了 3.5 s
- **预热 Worker 池**：Worker 脚本也在登录页下载，省界不再等它。Fast 4G 在预加载的基础上又快 130 ms，Slow 4G 快 2.2 s；但 Slow 4G 下视图就绪比只预加载晚 0.8 s：Worker 脚本和地图页分块在登录页上抢带宽
- **两个分块同时下载**：不预加载时 Fast 4G 快 135 ms、Slow 4G 快 1.5 s（省掉一次往返和串行的等待）。预加载本身也经过同一个加载函数，Slow 4G 下停留期间没下完时，同时下载同样有用
- **求交库**：去掉它 Fast 4G 只差 2 ms、Slow 4G 差 138 ms（15 KB 在 Slow 4G 下约 85 ms 的传输），不值得为它把区划范围改成异步的
- **字体**：不加载字体时 Slow 4G 快 5.7 s，和预热 Worker 池的收益相当；Fast 4G 快 335 ms，不限速只快 48 ms。字体只在第一次访问时下载，之后在缓存里

## ADR 0061 实现后的复测（2026-10-16）

5 份构建交替测量，每档 3 次，原始数据 `results.local/final-2026-10-16T08-32-19.918Z.json`：基线、上一轮实验里的 prewarm（运行时加载完就预热）、按 ADR 0061 实现的 final（两个分块同时加载，都到了再预热），以及 final 上的两种字体时机（实验用的本地改动，构建后还原）：`final-defer-semibold` 去掉 600 的 `@font-face`，画面稳定后用 `FontFace` 加载；`final-defer-fonts` 两个字重都这样推迟。

画面稳定（毫秒，中位数，括号里是和 baseline 的差）：

| 构建 | 不限速 | Fast 4G | Slow 4G |
|---|---|---|---|
| baseline | 1243 | 3591 | 17574 |
| prewarm | 1059（-185） | 2209（-1382） | 11778（-5795） |
| final | 1126（-118） | 2223（-1368） | 12493（-5080） |
| final-defer-semibold | 1095（-149） | 2160（-1431） | 10934（-6640） |
| final-defer-fonts | 1060（-183） | 2158（-1433） | 7412（-10162） |

视图就绪（毫秒，中位数）：

| 构建 | 不限速 | Fast 4G | Slow 4G |
|---|---|---|---|
| baseline | 313 | 1509 | 7064 |
| prewarm | 185（-128） | 338（-1171） | 4336（-2728） |
| final | 192（-121） | 366（-1143） | 2039（-5024） |
| final-defer-semibold | 163（-150） | 353（-1156） | 2072（-4991） |
| final-defer-fonts | 173（-139） | 381（-1127） | 789（-6275） |

Slow 4G 下的资源（毫秒，从发出登录请求算起）：

| 构建 | maplibre-gl | 地图页分块 | Worker 脚本 | 天地图瓦片（最后一张） | 省界 |
|---|---|---|---|---|---|
| prewarm | 804 | 4178 | 4059 | 11105 | 11692 |
| final | 1896 | 795 | 9376 | 8842 | 12390 |
| final-defer-fonts | 390 | -1311 | 5586 | 6733 | 7312 |

所有构建在登录页停留期间都没有长任务。final 的地图页分块变成 123 KB（gzip）：两个分块同时导入后，打包把一部分模块拆进了共享的分块，总量不变。

- **final 对照 ADR 0061 的验收标准**：Fast 4G 的画面稳定 2223 ms，和 prewarm 的 2209 ms 相当；Slow 4G 的视图就绪 2039 ms，比只预加载（约 3.5 s）和 prewarm（4336 ms）都早。Slow 4G 的画面稳定 12493 ms，比 prewarm 慢 0.7 s，没达到"不差于约 11.8 s"：Worker 脚本推迟到两个分块之后才下载，省界跟着晚到；但天地图瓦片早了 2.3 s 画完，看得见的底图先到，只有省界的线晚了
- **字体的时机**：推迟 SemiBold 在 Slow 4G 下快 1.6 s，两个字重都推迟快 5.1 s（视图就绪 0.8 s，Regular 不再和预加载抢带宽）；Fast 4G、不限速只快几十毫秒
- **用户的决定**：保留 final（看得见的底图先到，Slow 4G 的画面稳定没达到 ADR 0061 的验收标准，记在这里）；字体不推迟（[ADR 0062](../adr/0062-font-loading-not-deferred.md)：收益只在慢网络的第一次访问，代价每次访问都有）

## 3D.5a 切到三维的实测（2026-10-27，ADR 0091）

内网构建（不请求天地图，三维没有影像）、`--mock-backend`、无界面 Edge（`--headless`）、登录页停留 2 秒、二维稳定后停留 5 秒（`--stay 5000`），三份构建交替测量，每档 3 次取中位数，原始数据 `results.local/switch3d-2026-10-28T05-07-17.316Z.json`。除了 baseline，每份都是对地图页的一处本地改动，构建后还原，不提交：

| 构建 | 改动 |
|---|---|
| baseline | 当时的 `main`：第一次切到三维时才加载 |
| idle | 二维第一次画面稳定后，`requestIdleCallback`（超时 2 秒）调用注入的运行时加载函数加载三维运行时 |
| idle-warm | 在 idle 上，运行时加载完再 `fetch` 第一次切换会用到的 14 个 Cesium 文件（Worker 脚本和资源），看预取它们的上限 |

三维画面稳定（毫秒，从点"三维"算起，括号里是和 baseline 的差）：

| 构建 | 不限速 | Fast 4G | Slow 4G |
|---|---|---|---|
| baseline | 2271 | 8861 | 49400 |
| idle | 2221（-50） | 7457（-1404） | 44896（-4503） |
| idle-warm | 2089（-182） | 7258（-1603） | 47702（-1698） |

三维运行时（毫秒）：

| 构建 | 不限速 | Fast 4G | Slow 4G |
|---|---|---|---|
| baseline | 168 | 3436 | 18256 |
| idle | 21 | 13 | 13187 |
| idle-warm | 13 | 12 | 13182 |

baseline 的资源（毫秒，从点"三维"算起；括号里是压缩后的大小）：

| 网络 | map-cesium 分块 | Cesium 文件（最后一个） | 点了以后下载 | JS 堆增加 |
|---|---|---|---|---|
| 不限速 | 110（1029 KB） | 1465（64 次请求） | 3407 KB | 13.4 MB |
| Fast 4G | 3373（1029 KB） | 8482（64 次请求） | 13893 KB | 13.5 MB |
| Slow 4G | 18188（1029 KB） | 48859（64 次请求） | 3407 KB | 13.8 MB |

看到的：

- **预加载运行时**：分块在停留期间下完时，点了以后运行时 13 ms 就可用，Fast 4G 的三维画面稳定快 1.4 s；Slow 4G 下 5 秒不够下完，提前开始仍快 4.5 s。二维停留期间三份构建都没有长任务，idle 停留期间多下载约 1 MB；JS 堆的增加从 13.4 MB 变成 8.6 MB（约 5 MB 是 Cesium 的模块，预加载以后二维期间就占着）
- **预取 Cesium 的文件**：只多快约 0.2 s，Slow 4G 抢带宽反而更慢；不做
- **剩下的时间**：不限速时视图就绪（约 0.2 s）到画面稳定约 2 s，是 Cesium 的启动、建 Worker 和第一次绘制（软件渲染）；Fast 4G 下"点了以后下载"里有两个各约 5 MB 的正文字体（登录后还没下完，三维画面稳定时 SemiBold 仍在下载）。第一次切换取 14 种 Cesium 文件，每个 Worker 各取一遍，共 64 次请求；预览服务器给 `no-cache`，每次都要往返
- **三维覆盖物又下载了一次省界**（139 KB）：二维在 Worker 里下载过，生产给 `assets/` 配长缓存后从缓存取
- 第一轮实测里 Slow 4G 的一次卡住了 9 分钟：Playwright 的操作默认不限时，点"三维"一直在等；之后给页面操作设了 `--timeout`，点不了时这一次不算并留下截图，重测没有再出现

实现后（`CesiumCanvas` 在二维稳定后调用 `MAP_RUNTIME_PRELOAD`，app 空闲时加载）和 baseline 交替复测，不限速、Fast 4G 各 3 次：

| 构建 | 不限速 | Fast 4G |
|---|---|---|
| baseline | 3045 | 8876 |
| preload | 3052（+7） | 7504（-1372） |

三维运行时 Fast 4G 从 3464 ms 变成 12 ms，停留期间下载约 1 MB、没有长任务，和 idle 一致（这一轮不限速的画面稳定两份都在 3 s 左右，比上一轮慢约 0.8 s，是机器的波动）。
