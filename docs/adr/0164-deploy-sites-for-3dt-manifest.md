# 0164. 三维模型清单按部署站点发布：一份全集，构建时用 YZT_SITE 去掉这台服务器缺的模型

- 状态：已接受（2026-11-17 用户确认：两台服务器都继续用，现在就做，站点记"缺哪些模型"，站点名用 IP 后两段）
- 日期：2026-11-17
- 补充：ADR 0081 第 1 节（清单仍在 `/3dt/manifest.json`，发布的是全集按站点去掉缺的模型）、ADR 0149 第 3 节（各服务器在 `/3dt/` 下按同一套目录层级提供模型）、ADR 0141（开发服务器设了站点时清单来自工作区）

## 背景

- 入库的清单 `public/3dt/manifest.json` 随产物原样发布，地址相对清单、不写服务器，开发和部署用同一份（docs/deployment.md）。它是按内网服务器 192.168.153.194 写的，那台缺一些数据（docs/backlog.md）。
- 2026-11-17 有了第二台内网服务器 192.168.15.111（Windows，nginx 1.24），数据齐全。用户：两台都继续用，希望维护几套服务器清单、打包时选，切换服务器时不用反复改清单。
- 清单里贵的数据只能有一份：LCC2 的 `placement`、`spawn`、`routes` 是 `lcc2:register` 配准出来的，`maximumScreenSpaceError` 要在显卡机器上测（docs/config/3dt-manifest.md）。几份完整清单会在服务器之间漂移，`catalog.test.ts` 也只管得住一份。
- 清单的格式由代码里的 zod 严格校验，跟着代码发布；放到服务器上单独维护，代码一改字段旧清单就整份不合法。
- 产物里没有站点名：清单是严格对象，不能加字段。

## 候选方案

| 问题 | 候选 | 选择与理由 |
|---|---|---|
| 几套清单怎么存 | 每台一份完整清单；一份全集 + 每台一个站点文件 | **全集 + 站点文件**：贵的数据只写在全集里；站点文件只有模型 ID，不能改路径、不能改模型的字段 |
| 站点记什么 | 有哪些模型（白名单）；缺哪些模型（排除表） | **缺哪些**（用户确认）：数据齐全的站点是空表；新模型默认每台都发布，某台忘了排除时面板显示加载失败、`site:check` 报 404，看得见，白名单漏加时模型悄悄不出现 |
| 在哪选 | 构建时；构建后用命令替换 `dist/3dt/manifest.json`；一份产物，各台的 nginx 指向自己那份；前端运行时按 ID 列表过滤 | **构建时**：名字写错在打包之前就失败，日志写明选了哪台；构建后替换要多一步，忘了就悄悄发布全集；nginx 选的话选择在仓库外、CI 测不到，漏配也看不出；运行时过滤要改应用代码、多一次请求 |
| 用什么选 | Vite 模式（每台一个 `.env.<站点>`）；`VITE_` 变量；进程环境变量 | **进程环境变量 `YZT_SITE`**，只在 `vite.config.ts` 里用 `process.env` 读：模式已经用来分公网和内网，每台一个模式要把 `.env.intranet` 抄几遍；`VITE_` 会进产物、要改应用；不经过 `loadEnv`，写在 `.env.local` 里不生效，忘了删的本地文件不会把构建悄悄绑到某台 |
| 站点文件的格式 | 每台一个 JSON；一个 TS 模块；一个 JSON 文件放全部站点 | **一个 JSON 文件 `tools/site/sites.json`**，格式由 zod 严格校验，缺的原因是必填的数据（`{ id, reason }`），构建日志和 `site:check` 里显示。TS 模块（能写注释、有类型检查）被插件导入就成了 `vite.config.ts` 的依赖，Vitest 5 改到配置的依赖时把全部测试都选上（`AffectedModulesResolver` 的 `dependsOnConfig`），每改一次 `missing` 都要跑全部单元测试和浏览器测试；插件用 fs 读 JSON 就没有这个问题，测试用 JSON import 读，改它时 `test:changed` 只选站点的测试。每台一个文件时测试要逐个导入，新加的文件选不中 |
| 站点名 | IP 后两段；按用途 | **IP 后两段**（用户确认）：`15-111`、`153-194` |

## 决定

### 1. 全集和站点

- `public/3dt/manifest.json` 仍是唯一的模型目录（全集），位置、格式、zod schema、应用代码、`catalog.test.ts`、`lcc2:register` 都不变。
- `tools/site/sites.json`：键是站点名（小写字母、数字、连字符），值是 `{ label, origin?, missing: [{ id, reason }] }`。`id` 是这台服务器上没有数据的模型，必须在全集里、不能重复；`reason` 必填；数据补齐后连这一项删掉。格式由 `tools/site/sites.ts` 的 zod 严格校验。
- 规则：同一个 ID 在每台服务器上是同一份数据，数据方重新导出时换一个 ID、或者所有服务器一起换；每台服务器在同源的 `/3dt/` 下按 docs/config/3dt-manifest.md 的"目录层级"提供同一套地址，磁盘上放在哪里由各自 nginx 的 `alias` 决定；不支持按服务器改路径（测试服务器 192.168.1.180 的平铺目录要先整理才能有站点）。

### 2. 构建和开发服务器

- `tools/site/vite-plugin.ts` 的 `sitePlugin(process.env.YZT_SITE)`，排在 `localFiles`、`buildOutputPlugin` 前面，测试和 `vite preview` 里不启用；每次用到时用 fs 重新读全集和站点。
- 设了站点：`configResolved` 校验站点和缺的 ID（写错时打包之前就失败），日志写一行站点、模型数和缺的原因；`writeBundle` 把全集去掉缺的模型、写到产物的 `3dt/manifest.json`（Vite 8 在 `renderStart` 复制 public，写入在它之后）；`closeBundle` 再读一遍，被覆盖回全集时失败。站点不缺模型时写进去的就是全集的原文。
- 没设：不改清单，日志写一行"发布全集"。CI、`pnpm build`、`pnpm build:intranet` 的产物不变。
- 开发服务器设了站点时，插件在 `configureServer` 里直接注册中间件回答清单，排在代理（`YZT_3DT_PROXY`）、`local/3dt` 和 public 之前：清单来自工作区、每次请求重新组合，模型照旧从本地或服务器取。这补上了"开发服务器没有内置的办法替换清单"（docs/config/local-files.md）。

### 3. 核对

- `pnpm --filter yzt site:check <站点>`（`tools/site/cli.ts`，只读）：服务器上的清单是不是这个站点的组合（不是时说出它等于全集、别的站点还是都不是，列出多出、少了、字段不同的模型）；每个模型的入口能取到、不是回退的网页；每个能取到的 LCC2 的第一个数据块按 docs/deployment.md 的验收发两段 Range。`--suggest` 探测全集，打印这台缺的模型（入口 404 或回退成网页的，别的状态码、连不上的另列为没法判断）。
- 测试：`compose.test.ts`、`sites.test.ts`（站点文件的格式；每个站点都写对了、留下的模型和全集里的一模一样，用 JSON import 读入库的清单和站点）、`vite-plugin.test.ts`、`check.test.ts`（本地 HTTP 服务模拟 404、回退网页、不支持 Range、ETag 变化、连不上）。

## 后果

- 一份产物只适合一台服务器，每台各构建一次：`$env:YZT_SITE='15-111'; pnpm build:intranet`。PowerShell 里 `$env:` 设的变量在整个窗口里一直有效，构建完要清掉（docs/commands.md）。
- 产物里看不出是哪个站点的构建，靠构建日志和 `site:check` 认。
- 加模型时多一步：数据不在某台服务器上，就在那个站点的 `missing` 里加一项，写上原因。
- `tools/` 的测试用 JSON import 读入库的清单和站点：`moduleResolution: bundler` 下默认允许，`tsconfig.node.json` 不用改。
- 以后按站点取值的其他运行时文件（内网的影像底图、设备档位）可以加在站点里，由同一个插件生成；内网要不要影像底图是另一个产品决定，另写 ADR。
