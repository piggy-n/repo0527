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
| `runtime` | maplibre-gl 加载完成、地图运行时设置好 | 路由的 `withMapRuntime` |
| `page` | 地图页开始创建（setup），页面分块已经加载 | `useMapLoadMarks` |
| `view-ready` | 视图就绪：样式加载完成（MapLibre 的 `style.load`），可以操作，瓦片可能还没到 | `useMapLoadMarks` |
| `settled` | 第一次画面稳定：没有动画，视野里的瓦片和省界都已画出（MapLibre 的 `idle`） | `useMapLoadMarks` |

步骤的清单是 `LOGIN_TO_MAP_STEPS`，实测脚本的 `STEPS` 和它一致（`tools/measure-map-load/report.test.ts` 保证）；加步骤时两边一起改。

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

账号密码从环境变量读取，在自己的终端里设置（PowerShell 是 `$env:YZT_MEASURE_LOGIN_NAME = '...'`、`$env:YZT_MEASURE_PASSWORD = '...'`）：

| 环境变量 | 说明 |
|---|---|
| `YZT_MEASURE_LOGIN_NAME` | 登录用的账号 |
| `YZT_MEASURE_PASSWORD` | 密码；脚本只填进登录框，不打印、不写进结果文件 |

| 参数 | 默认 | 说明 |
|---|---|---|
| `--runs` | 5 | 每档网络测几次 |
| `--profiles` | `none,fast4g,slow4g` | 网络：不限速、Fast 4G、Slow 4G |
| `--dwell` | 5000 | 登录页停留的毫秒数，模拟输入账号密码；预加载在这段时间里进行 |
| `--cpu` | 1 | CPU 降速倍数（`Emulation.setCPUThrottlingRate`） |
| `--channel` | `msedge` | `msedge`、`chrome` 或 `chromium`（Playwright 自带） |
| `--headless` | 不加 | 加上时无界面运行；默认有界面，用真实的 GPU 渲染 |
| `--label` | `run` | 结果文件名的前缀，如 `baseline`、`preload` |
| `--url` | — | 已经在运行的服务器；不给时由脚本启动 `vite preview` |
| `--timeout` | 120000 | 每一次从点击登录到画面稳定最多等多久 |

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
- **请求记录**：页面级 CDP 的网络事件里没有 Worker 自己发出的请求，所以用 Playwright 的请求事件（它能看到）；Worker 脚本本身的大小两边都取不到，表里只写完成时刻
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
