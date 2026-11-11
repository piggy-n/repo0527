# 未入库的本地文件（local/）

相关决策：ADR 0141（集中到 `local/`）、ADR 0013（字体）、ADR 0081（模型）

模型、原型、探查结果这些文件不入库，集中放在仓库根目录的 `local/`（`.gitignore` 的 `/local/`）。`apps/yzt/public/` 只放要发布的文件：构建时 Vite 会把它整个复制到产物。

## 目录

| 目录 | 内容 | 谁用 |
|---|---|---|
| `local/3dt/` | 三维模型数据（`SZ_3DT/` 等，约 1.5 GB；LCC2 的楚王山1号 299 MB，层级见 [3dt-manifest.md](3dt-manifest.md)），不含清单 | 开发服务器映射到 `/3dt/*`；线上由 nginx 提供（[deployment.md](../deployment.md)） |
| `local/design/` | 可以打开的交互原型，每个主题只留最新版 | 开发服务器映射到 `/design.local/*` |
| `local/design-src/` | 原型的构建脚本和检查截图 | 手动运行、查看，开发服务器不提供 |
| `local/probe/` | 后端探查结果：`resource-classes/` 是 `probe:resource-classes` 的默认输出，其他目录是用 `--out` 存下的某一轮 | [commands.md](../commands.md) |
| `local/measure/` | 实测数据：`map-load/`、`city-dashboard/` 是脚本的默认输出，`builds/` 放对比用的构建，用完删掉 | [modules/perf.md](../modules/perf.md)、[modules/city-dashboard.md](../modules/city-dashboard.md) |
| `local/measure-3d/` | 三维两种引擎的性能对比，`measure:3d` 的默认输出，每次一个带时间的目录 | [modules/map-three.md](../modules/map-three.md)"性能验收" |
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

不设时 worktree 的 `local/` 是空的：`/3dt/manifest.json` 正常，模型在三维模型面板里显示加载失败，原型地址回退到单页应用。

工具脚本的默认输出同样跟着这个变量，所以 worktree 指回主目录后，实测和探查的结果也写进主目录。

## 模型从服务器取

本机没有某个模型的数据（JKQ、JKQ2 只在服务器上）时，环境变量 `YZT_3DT_PROXY` 让开发服务器把 `/3dt/` 整个代理到那台服务器，清单和模型都从它取，`local/3dt/` 这时不再映射。它只在进程的环境变量里设，不写进 `.env`：工具脚本由 Node 直接运行，读不到 `.env`，写在 `.env.local` 里只对开发服务器生效（PowerShell）：

```powershell
$env:YZT_3DT_PROXY = 'http://192.168.1.180:5173'
pnpm --filter yzt dev:intranet
```

测试服务器上提供 `/opt/front/3dt/` 的 nginx 在 5173 端口（`/etc/nginx/nginx.conf`，2026-11-11 确认）；80 端口是 nginx 的默认页，`:18010` 是后端，都没有 `/3dt/`。这个地址上有 LCC2 模型和 `XZ_GC_3DT`，没有 JKQ、JKQ2（2026-11-11 请求是 404）；要看经开区时写放着它们的服务器：`http://<服务器地址>:<nginx 提供 /3dt/ 的端口>`。

服务器的 `/3dt/manifest.json` 来自它的 `dist/`，要发布前端才更新，所以新加进清单的模型在发布之前看不到。开发服务器没有内置的办法替换清单（代理转发整个 `/3dt/`，`local/3dt/manifest.json` 这时也不生效）：用浏览器 DevTools 的 Local Overrides，或者一次性的 Playwright 脚本 `context.route('**/3dt/manifest.json', ...)` 换成入库的清单（写法见 `tools/smoke/scene-maplibre.spec.ts`）。

用途是在有显卡的机器上跑瓦片集的诊断页 `/dev/tileset-probe`（[modules/map-cesium.md](../modules/map-cesium.md)"诊断读数"）。`measure:3d` 和配准工具 `lcc2:register` 用同一个变量，从 `<它>/3dt/` 读模型（[commands.md](../commands.md)）。

## 开发服务器

`tools/local-files/vite-plugin.ts` 的 `localFilesPlugin` 用 [sirv](https://github.com/lukeed/sirv) 提供静态文件，`vite.config.ts` 里写映射：`/3dt` → `local/3dt`，`/design.local` → `local/design`。

- 地址和线上一致，清单里的 `tileset` 仍然写相对路径（[deployment.md](../deployment.md)）
- 排在 Vite 的中间件之前，原型的脚本和样式不经过转换，和放在 `public/` 时一样
- 放进新文件不用重启；目录地址（`/design.local/<主题>/`）打开目录里的 `index.html`，不用写全
- 目录里没有的文件交给后面的中间件，`/3dt/manifest.json` 就这样继续从 `public` 提供。所以 `local/3dt/` 里平时不放 `manifest.json`，否则会盖住入库的那份。例外是临时要看不入库的模型：ADR 0149 L.3 的彭城广场 LCC2 样例就是复制入库的清单再加一项，开发服务器和 `measure:3d` 都读它（[map-three.md](../modules/map-three.md)"泼溅的预算"）；用完删掉，入库的清单改了要重新生成
- 只在开发服务器上生效：`vite preview` 没有模型（产物里也没有），测试不读这些目录

构建由 `tools/build-output/vite-plugin.ts` 检查：产物里出现 `design.local` 或 `3dt/` 下清单以外的内容时构建失败（[vite-config.md](vite-config.md)"构建产物检查"）。

## 原型

- 新原型放 `local/design/<主题>/`，构建脚本和检查截图放 `local/design-src/<主题>/`。流程见 [design/ui-workflow.md](../design/ui-workflow.md)
- 每个主题只留最新版。确认的结论写进 ADR 和模块文档，不靠旧原型留存
- 从开发服务器打开：原型里 `../../fonts/`、`/fonts/` 这样的地址解析到 `public/fonts`。直接双击 HTML（`file://`）时字体找不到，退回后备字体
- 2026-11-04 之前的原型脚本写的是挪动前的相对路径（`../../src`、`public/design.local/...`），要重新运行时先改路径

## 修改时的检查清单

- 新增映射的地址：改 `vite.config.ts`，更新本文，并确认线上怎么提供（`docs/deployment.md`）
- 新增工具的默认输出：用 `localPath`，放进上面的目录划分，不新建 `*.local` 目录
- 改目录划分：同步本文和 `AGENTS.md` 的"目录结构"，并告诉用户挪动已有的文件（它们不入库，合入不会带过去）
