# 0141. 未入库的本地文件集中到 local/

- 状态：已接受
- 日期：2026-11-04

## 背景

迁移基本完成，用户 2026-11-04 要求整理未入库的文件。它们散在多处，共约 7.5 GB：

| 位置 | 大小 | 用途 |
|---|---|---|
| `apps/web/tools/measure-map-load/builds.local` | 5.8 GB | 加载方式对比的旧构建 |
| `apps/web/public/3dt/`（除清单） | 1.5 GB | 三维模型数据 |
| `scope-test-files.local` | 64 MB | 自定义范围的手动测试文件 |
| `apps/web/public/design.local`、`apps/web/design.local` | 63 MB | 交互原型 |
| `apps/web/probe-*.local` | 23 MB | 后端探查结果 |
| `apps/web/tools/measure-map-load/results.local` | 不到 1 MB | 实测数据 |

带来的问题：

- `public/` 里的模型和原型每次构建都被 Vite 复制到 `dist/`，再由 `buildOutputPlugin` 删除；本机放着全部模型时构建多花约 30 秒（`vite-config.md`，2026-10-29 实测）。`builds.local` 的 5.8 GB 里，每份构建带着一份当时还没被清理的模型
- worktree 里没有这些文件，在 worktree 里看不了模型和原型
- 文档里 17 处引用 `design.local/city-dashboard`，这个目录在这台机器上已经不存在；同样失效的还有文件管理、资源管理、系统管理的预览和截图路径
- 各工具各写各的输出路径

用户已确认：`builds.local` 可以删；旧原型每个主题只留最新版；未来的地图项目放在这个仓库，不必为模型另设位置。

## 候选方案

| 问题 | 候选 | 选择与理由 |
|---|---|---|
| 放在哪里 | 只把模型移出 `public/`；仓库根目录的 `local/`；仓库外的目录 | 根目录 `local/`：只记一个位置，默认路径不用配置；放仓库外要每台机器配路径 |
| 怎么指到别处 | 写进 `.env`；环境变量；自动找主目录（读 worktree 的 `.git` 文件） | 环境变量 `YZT_LOCAL_DIR`：工具脚本由 Node 直接运行，读不到 `.env`，写在 `.env.local` 会只对开发服务器生效；自动查找是多一份逻辑，一个变量就够 |
| 目录怎么分 | 按工具分；按内容分 | 按内容：`3dt`、`design`、`design-src`、`probe`、`measure`、`scope-test-files`。`design` 和 `design-src` 分开，是因为原来的 `public/design.local` 和 `design.local` 有同名文件（`chart-palette/index.html`），而且只有前者需要从开发服务器打开 |
| 地址 | 换成 `/local/*`；不变 | 不变：`/3dt/*` 和线上 nginx 一致，清单写相对路径，开发和部署用同一份 |
| 开发服务器怎么提供 | 手写静态文件中间件；sirv；`server.fs.allow` 加 `/@fs/`；符号链接 | sirv：Vite 提供 `public/` 用的也是它，同一版本已在依赖树里（`@vitest/*`），MIME、中文路径、路径穿越都处理好了。手写要自己处理这些；`/@fs/` 换了地址，还要放开整个目录；符号链接在 Windows 上要权限，构建时也还是会复制 |
| 清单 | 移到 `local/`；留在 `public/` | 留在 `public/`：入库、随产物发布、格式由代码里的 zod 校验。sirv 找不到的文件交给后面的中间件，所以 `/3dt/manifest.json` 自然从 `public` 提供 |
| 构建插件 | 继续清理；只检查 | 只检查：`public/` 里不再有这些文件，清理和"输出目录不能和源码重叠"的保护一起去掉。放错了构建失败，比静默删掉更早暴露 |
| Playwright 的失败输出 | 放进 `local/`；留在各自的检出 | 留在 `apps/web/*-results.local/`：Playwright 每次运行先清空输出目录，多个 worktree 共用 `YZT_LOCAL_DIR` 时会互相删掉失败记录；它是一次性的，不需要集中 |
| 字体 | 一起移；留在 `public/fonts` | 留下：字体是构建输入，要复制进产物（ADR 0013） |
| 测试文件的生成脚本 | 原样入库 `.mjs`；转成 TS | 转成 TS：`apps/web/tools/` 约定是 Node 直接运行的 TS，这样也进入类型检查。生成结果和转换前逐个比对过 |

## 决定

1. 仓库根目录的 `local/` 被 git 忽略，放模型、原型、探查结果、实测数据和手动测试文件，划分见 `docs/config/local-files.md`。`YZT_LOCAL_DIR` 可以指到别处，开发服务器和工具脚本都经过 `tools/local-files/paths.ts` 的 `localPath`
2. `tools/local-files/vite-plugin.ts` 的 `localFilesPlugin` 用 sirv 把 `/3dt/*`、`/design.local/*` 映射到 `local/`，只在开发服务器上生效，测试不生效
3. `apps/web/public/` 只放要发布的文件。`buildOutputPlugin` 去掉清理，保留检查，错误信息写明该放到哪里
4. `probe:resource-classes`、`measure:map-load`、`tools/measure-city-dashboard` 的默认输出改到 `local/`
5. 生成自定义范围测试文件的脚本和说明入库到 `apps/web/tools/scope-test-files/`，生成的文件不入库
6. `.gitignore` 的 `README.md` 改成 `/README.md`（原来没带路径，以后新包的 README 都不会入库），去掉 `public/3dt` 的规则
7. 原型每个主题只留最新版，确认的结论写进 ADR 和模块文档
8. 现行文档改成符合实际；已不存在的预览和截图，在记录里写明没有保留。已接受的 ADR 不改，里面的 `public/design.local/<主题>` 对应现在的 `local/design/<主题>`，删掉的版本以 `docs/config/local-files.md` 和各模块文档为准

## 后果

- 构建不再复制模型和原型；Vite 的依赖扫描按 `**/*.html` 找入口，也不再碰到原型里的 HTML
- 新增一个开发依赖 sirv，版本和依赖树里已有的相同
- worktree 设一个环境变量就能看模型和原型，工具脚本的输出也跟着过去
- 文件不入库，合入代码不会带上它们：合入后要在主目录手动挪一次。挪动之前主目录的 `public/` 里还有模型和原型，构建会被产物检查拦下，开发服务器照常（`public` 仍能提供）
- `tools/measure-city-dashboard/lifecycle.ts` 依赖的预览已经不在，现在要给出预览地址才能运行，复测前要先做一个带"D3 预览工具"按钮的预览
- 2026-11-04 之前的原型构建脚本写的是挪动前的相对路径，要重新运行时先改路径
- 直接双击原型 HTML（`file://`）时 `../../fonts/` 找不到字体，退回后备字体；从开发服务器打开不受影响
