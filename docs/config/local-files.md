# 未入库的本地文件（local/）

相关决策：ADR 0141（集中到 `local/`）、ADR 0013（字体）、ADR 0081（模型）、ADR 0165（服务器底图）

模型、原型、探查结果这些文件不入库，集中放在仓库根目录的 `local/`（`.gitignore` 的 `/local/`）。`apps/yzt/public/` 只放要发布的文件：构建时 Vite 会把它整个复制到产物。

## 目录

| 目录 | 内容 | 谁用 |
|---|---|---|
| `local/3dt/` | 三维模型数据，层级和服务器上相同：`<市>/3dtiles/<模型名>/`、`<市>/lcc2/<目录>/`（[3dt-manifest.md](3dt-manifest.md)"目录层级"），不含清单 | 开发服务器映射到 `/3dt/*`；线上由 nginx 提供（[deployment.md](../deployment.md)） |
| `local/basemap/` | 服务器底图（ArcGIS 紧凑缓存）的一部分，层级和地址相同：`<前缀>/_alllayers/L<级别>/R<行>C<列>.bundle` 和同名的 `.bundlx`，`<前缀>/` 对应服务器上缓存的 `Layers/`（下文"服务器底图"） | 开发服务器映射到 `/basemap/*`，缺的文件回 404；线上由 nginx 提供 |
| `local/design/` | 可以打开的交互原型，每个主题只留最新版 | 开发服务器映射到 `/design.local/*` |
| `local/design-src/` | 原型的构建脚本和检查截图 | 手动运行、查看，开发服务器不提供 |
| `local/probe/` | 后端探查结果：`resource-classes/` 是 `probe:resource-classes` 的默认输出，其他目录是用 `--out` 存下的某一轮 | [commands.md](../commands.md) |
| `local/measure/` | 实测数据：`map-load/`、`city-dashboard/` 是脚本的默认输出，`builds/` 放对比用的构建，用完删掉 | [modules/perf.md](../modules/perf.md)、[modules/city-dashboard.md](../modules/city-dashboard.md) |
| `local/measure-3d/` | 三维的性能实测，`measure:3d` 的默认输出，每次一个带时间的目录 | [modules/map-three.md](../modules/map-three.md)"性能验收" |
| `local/lcc2-plan/` | LCC2 扫描轨迹的平面图，`lcc2:register --plan lcc2-plan/<模型ID>.svg` 写在这里，随时能重新生成 | [3dt-manifest.md](3dt-manifest.md)"出生点和路线" |
| `local/scope-test-files/` | 自定义监测范围的验收文件，`scope-files:generate` 能重新生成 | [`tools/scope-test-files/说明.md`](../../apps/yzt/tools/scope-test-files/说明.md) |

不放在这里的：

| 位置 | 内容 | 原因 |
|---|---|---|
| `apps/yzt/public/fonts/` | 授权不能入库的字体（[design/fonts.md](../design/fonts.md)） | 构建输入，要复制进产物（ADR 0013） |
| `apps/yzt/public/3dt/manifest.json` | 模型清单 | 入库，随产物发布，格式由代码里的 zod 校验 |
| 每个检出自己的 `local/smoke-results/`、`local/file-transfer-results/` | Playwright 的输出和截图 | 每次运行先清空，所以不跟 `YZT_LOCAL_DIR`，多个 worktree 才不会互相删掉（2026-11-05 从 `apps/yzt/*-results.local/` 挪来） |
| `apps/yzt/.env.local` | 个人临时覆盖的环境变量 | Vite 的约定（[env.md](env.md)） |

## 指到别处

环境变量 `YZT_LOCAL_DIR` 代替默认的仓库根目录 `local/`，相对路径从仓库根目录算。开发服务器和工具脚本都经过 `tools/local-files/paths.ts` 的 `localPath`，新的工具也用它，不自己拼路径。

它只从进程的环境变量读，不写进 `.env`：工具脚本由 Node 直接运行，读不到 `.env`，写在 `.env.local` 里会只对开发服务器生效。

worktree 里没有这些文件。要看模型或原型时指回主目录（PowerShell）：

```powershell
$env:YZT_LOCAL_DIR = 'C:\work\repo0527\local'
pnpm --filter yzt dev
```

不设时 worktree 的 `local/` 是空的：`/3dt/manifest.json` 正常，加入的模型在三维里显示加载失败，内网配置探测不到服务器底图（只有静态和无底图），原型地址回退到单页应用。

工具脚本的默认输出同样跟着这个变量，所以 worktree 指回主目录后，实测和探查的结果也写进主目录。

## 模型从服务器取

本机没有某个模型的数据（经开区、新吴区只在服务器上）时，环境变量 `YZT_3DT_PROXY` 让开发服务器把 `/3dt/` 整个代理到那台服务器，清单和模型都从它取，`local/3dt/` 这时不再映射。它只在进程的环境变量里设，不写进 `.env`：工具脚本由 Node 直接运行，读不到 `.env`，写在 `.env.local` 里只对开发服务器生效（PowerShell）：

```powershell
$env:YZT_3DT_PROXY = 'http://192.168.153.194:5173'
pnpm --filter yzt dev:intranet
```

服务器：

- 内网 Windows 服务器 `192.168.15.111`（2026-11-17 加入，本机连得到）：5173 端口的 nginx 1.24 提供前端（`D:\01Project\front\dist`）和 `/3dt/`。数据在 `D:\02Data\3dtiles\models\<市>\` 下，已经按"目录层级"整理，`/3dt/` 的 alias 指向它；清单里只有彭城广场的倾斜摄影还没拷过去（2026-11-17，`pnpm --filter yzt site:check 15-111` 可以看），另有 17 个只在这台上的模型（站点 `153-194` 记为缺）；
- 内网服务器 `192.168.153.194`（2026-11-11）：5173 端口的 nginx 提供前端（`/opt/front/dcjcxzt/`）和 `/3dt/`（`/opt/front/3dt/` 的 alias，不开 gzip），按"目录层级"放着清单里的全部模型，本机连不到；
- 测试服务器 `192.168.1.180`：提供 `/opt/front/3dt/` 的 nginx 也在 5173 端口（`/etc/nginx/nginx.conf`；80 端口是 nginx 的默认页，`:18010` 是后端，都没有 `/3dt/`）。目录还是原来平铺的，有 LCC2 模型和彭城广场的倾斜摄影（`XZ_GC_3DT`），没有经开区（请求是 404）。它的清单是旧路径，和它的目录对得上，页面上照样能看；`measure:3d` 的瓦片集场景按新的层级取，对它取不到，`lcc2:register` 的相对路径要写它的旧目录（如 `楚王山1号/lcc2-sog-result/楚王山1号.lcc2`）。

服务器的 `/3dt/manifest.json` 是部署时放上去的那份，要发布前端才更新，所以新加进清单的模型在发布之前看不到；服务器换了目录层级、清单还是旧路径时，模型都加载失败。要看工作区里的清单时，同时设部署站点 `YZT_SITE`（ADR 0164）：开发服务器用全集按这个站点去掉缺的模型回答 `/3dt/manifest.json`，这个中间件排在代理和 `local/3dt` 前面，每次请求重新读全集，模型照旧从服务器取：

```powershell
$env:YZT_3DT_PROXY = 'http://192.168.15.111:5173'
$env:YZT_SITE = '15-111'
pnpm --filter yzt dev:intranet
```

这时 `local/3dt/manifest.json` 也不生效。不设 `YZT_SITE` 时代理转发整个 `/3dt/`，清单是服务器上部署的那份。`measure:3d` 不认 `YZT_SITE`，设了代理时读服务器上部署的清单。

用途是在有显卡的机器上看、测服务器上的模型。`measure:3d` 和配准工具 `lcc2:register` 用同一个变量，从 `<它>/3dt/` 读模型（[commands.md](../commands.md)）。原来的瓦片集诊断页 `/dev/tileset-probe` 读的是 Cesium 的读数，随引擎删掉（ADR 0153）。

## 服务器底图

内网服务器随服务器提供的 ArcGIS 紧凑缓存（ADR 0165）。线上由 nginx 给每套一个前缀 `/basemap/<前缀>/`，指到那套缓存的 `Layers/`；前缀是 `imagery`（影像）、`standard`（标准）、`black`（黑色）、`night-blue`（极夜蓝）。本机放在 `local/basemap/`，层级和地址一样：

```
local/basemap/
└─ imagery/                        一套缓存的 Layers/，别的前缀同样
   └─ _alllayers/
      └─ L10/
         ├─ R0180C0300.bundlx      索引，整份读
         └─ R0180C0300.bundle      瓦片，按 Range 读
```

- 数据是数据方的，不入库、不放 `public/`，产物里出现就构建失败（下文"开发服务器"的最后一段）
- 一套全部有 38～91 GB，本机只拷要看的：L07～L11 每套只有几个 bundle，可以整级拷；更深的级别只拷要看的地方。页面探测一套有没有，读的是南京那块 z10 瓦片所在的 `L10/R0180C0300`，没拷它的那套页面上不出现。`conf.xml`、`conf.cdi` 页面不读，可以不拷
- 拷贝不用目录联接（junction）：删 worktree 时曾经顺着联接删掉主目录的模型
- 缺的文件回 404，不回落到 `index.html`，和线上 nginx 一样：读取器靠 404 认"这一块没有"（MapLibre 改用上一级放大），探测靠它认"这台没有这套底图"
- sirv 只认单段 Range，`bytes=0-0` 会回整个文件、`bytes=-n` 被当成 0～n；读取器的 Range 起点都在 bundle 的头和占位区之后，碰不到。开发时的响应是 `Cache-Control: no-store`、不带 ETag
- 只有内网配置（`dev:intranet`）探测服务器底图，公网的 `dev` 不探测，放了文件也不显示

本机不拷数据时，环境变量 `YZT_BASEMAP_PROXY` 让开发服务器把 `/basemap/` 整个代理到一台服务器，`local/basemap/` 这时不再映射。和 `YZT_3DT_PROXY` 一样只在进程的环境变量里设（[env.md](env.md)"不放进 `.env` 的变量"），两个常常一起设（PowerShell）：

```powershell
$env:YZT_BASEMAP_PROXY = 'http://192.168.15.111:5173'
pnpm --filter yzt dev:intranet
```

- Range 请求头、206 和 `Content-Range` 原样转发，缺的文件和没配的前缀照样是服务器回的 404（2026-11-17 对 15.111 验证过，[vite-config.md](vite-config.md)"代理"）
- 15.111 上 4 套都配了（ADR 0165 第 5 节）
- `vite preview` 也沿用这条代理；没设时 preview 不映射 `local/basemap/`，`/basemap/*` 回落到 `index.html`，探测把它当成没有。冒烟用例不依赖这两种：公共夹具 `fixtures.ts` 让 `/basemap/` 一律回 404，`server-basemap.spec.ts` 自己 route `/basemap/**` 提供生成的缓存（ADR 0165 第 6 节）

## 开发服务器

`tools/local-files/vite-plugin.ts` 的 `localFilesPlugin` 用 [sirv](https://github.com/lukeed/sirv) 提供静态文件，`vite.config.ts` 里写映射：`/3dt` → `local/3dt`，`/basemap` → `local/basemap`，`/design.local` → `local/design`；设了 `YZT_3DT_PROXY`、`YZT_BASEMAP_PROXY` 时对应的那条不映射，改走代理。

- 地址和线上一致，清单里的 `tileset` 仍然写相对路径（[deployment.md](../deployment.md)）
- 排在 Vite 的中间件之前，原型的脚本和样式不经过转换，和放在 `public/` 时一样
- 放进新文件不用重启；目录地址（`/design.local/<主题>/`）打开目录里的 `index.html`，不用写全
- `/basemap` 写成 `{ directory, fallthrough: false }`：缺的文件由 sirv 直接回 404，不交给后面的中间件。交出去的话，Vite 的单页回落会把 `Accept` 带 `*/*` 的请求（`fetch` 默认就带）改写成 `index.html` 并回 200
- 只写目录的映射（`/3dt`、`/design.local`）：目录里没有的文件交给后面的中间件，缺的模型文件、原型地址拿到的是单页应用的 `index.html`（200）。`/3dt/manifest.json` 就这样继续从 `public` 提供。所以 `local/3dt/` 里平时不放 `manifest.json`，否则会盖住入库的那份。例外是临时要看不入库的模型：复制入库的清单再加一项，开发服务器和 `measure:3d` 都读它（ADR 0149 L.3 的彭城广场 LCC2 样例原来这样做，2026-11-11 进了入库的清单）；用完删掉，入库的清单改了要重新生成
- 目录映射只在开发服务器上生效：`vite preview` 不映射 `local/3dt`、`local/basemap`（产物里也没有），测试不读这些目录；设了 `YZT_3DT_PROXY`、`YZT_BASEMAP_PROXY` 时 preview 照样走代理（见上文"模型从服务器取""服务器底图"）

构建由 `tools/build-output/vite-plugin.ts` 检查：产物里出现 `design.local`、`3dt/` 下清单以外的内容、顶层的 `basemap/` 目录或任何 `.bundle`、`.bundlx` 文件时构建失败（[vite-config.md](vite-config.md)"构建产物检查"）。

## 原型

- 新原型放 `local/design/<主题>/`，构建脚本和检查截图放 `local/design-src/<主题>/`。流程见 [design/ui-workflow.md](../design/ui-workflow.md)
- 每个主题只留最新版。确认的结论写进 ADR 和模块文档，不靠旧原型留存
- 从开发服务器打开：原型里 `../../fonts/`、`/fonts/` 这样的地址解析到 `public/fonts`。直接双击 HTML（`file://`）时字体找不到，退回后备字体
- 2026-11-04 之前的原型脚本写的是挪动前的相对路径（`../../src`、`public/design.local/...`），要重新运行时先改路径

## 修改时的检查清单

- 新增映射的地址：改 `vite.config.ts`，更新本文，并确认线上怎么提供（`docs/deployment.md`）
- 新增工具的默认输出：用 `localPath`，放进上面的目录划分，不新建 `*.local` 目录
- 改目录划分：同步本文和 `AGENTS.md` 的"目录结构"，并告诉用户挪动已有的文件（它们不入库，合入不会带过去）
