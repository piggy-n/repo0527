# 0032. 公网与内网两套构建命令：Vite 构建模式

- 状态：已接受
- 日期：2026-10-10
- 补充 ADR 0031 的待定事项"公网和内网各用一套构建、部署命令"

## 背景

系统有两种部署环境：能访问公网的，地图用天地图；不能访问公网的内网，不能向天地图发任何请求（旧项目提交 `d768c66` 的总开关）。ADR 0031 用 `VITE_TIANDITU_ENABLED` 表达这个区别，读成 `appConfig.tianditu`（关闭时为 `null`），但没定怎样切换。用户希望从构建、部署命令上区分：一套允许访问公网天地图，一套完全不依赖公网。

已有的条件：

- `VITE_` 变量在构建时被替换成常量（[config/env.md](../config/env.md)），切换就要重新构建。"一次构建、多处部署"的运行时配置，ADR 0008 留到真正需要时再做
- Vite 按模式加载 `.env.[mode]`，并覆盖 `.env` 里的同名变量。`vite build --mode <名称>` 改变的只是模式，仍是生产构建：`import.meta.env.PROD` 为真，开发页面照样被剔除
- 代码里依赖模式的只有 `vite.config.ts` 判断 `mode === 'test'`（测试时不启用生成源文件的插件）

## 候选方案

| 方案 | 做法 | 好处 | 代价 |
|---|---|---|---|
| A. Vite 构建模式 | `apps/web/.env.intranet` 只写内网不同的变量；脚本 `dev:intranet`、`build:intranet` 带 `--mode intranet` | 命令名直接说明是哪一套；配置提交在仓库里，可以复现；以后内网的其他差异写进同一个文件 | 两份构建产物；`import.meta.env.MODE` 多了 `intranet` 这个值 |
| B. 命令行上设变量 | `cross-env VITE_TIANDITU_ENABLED=false vite build` | 不多文件 | Windows 上要多装 `cross-env`；配置散在脚本里，不好找 |
| C. 运行时配置 | 构建一次，部署时由 nginx 提供 `config.json`，启动时先读取 | 运维切换不用重新构建 | `appConfig` 要改成异步初始化，启动多一次请求 |
| D. `.env.local` 覆盖 | 每台机器自己写一个不提交的文件 | 什么都不用加 | 不是命令，没法复现，容易忘 |

## 决定

采用 A，模式名 `intranet`。

### 1. 文件与命令

| 环境 | 环境变量 | 构建 | 开发服务器 |
|---|---|---|---|
| 公网 | `.env` | `pnpm build` | `pnpm --filter @yzt/web dev` |
| 内网 | `.env` 加 `.env.intranet`（后者覆盖前者） | `pnpm build:intranet` | `pnpm --filter @yzt/web dev:intranet` |

- `.env.intranet` 只写内网与公网不同的变量，目前只有 `VITE_TIANDITU_ENABLED=false`，其余继承 `.env`。个人临时覆盖仍用不提交的 `.env.intranet.local`
- 根目录的 `build:intranet` 是 `pnpm -r build:intranet`，与 `build` 一样分发到各包，没有这个脚本的包（如 `packages/icons`）被跳过
- 两份产物输出到同一个 `apps/web/dist/`，部署前按目标环境执行对应的构建。`preview` 预览的是最近一次构建的产物，不另加内网的预览命令

### 2. 实测（2026-10-10）

- 内网构建的产物里，开关被替换成 `false`，公网是 `true`；两份产物都没有开发页面
- 天地图的 key 和瓦片地址模板仍在内网产物里：它们是代码里的字符串，运行时 `appConfig.tianditu` 为 `null`，不会用到。key 本来就是公开的（ADR 0031），不为了去掉它在 `.env.intranet` 里另写空值

### 3. 约定

- 判断是不是生产构建用 `import.meta.env.PROD` / `DEV`，不用 `MODE === 'production'`：内网构建的 `MODE` 是 `intranet`
- 内网与公网的差异都写进 `.env.intranet`，代码只读 `appConfig`，不判断模式名。5B.2 的边界、5B.5 的区划定位沿用 `appConfig.tianditu`，不需要新变量
- CI 只构建公网版：两份产物只差环境变量的值，关闭天地图的分支由 `appConfig` 和底图的单元测试覆盖。内网的差异变多时再考虑在 CI 里加上内网构建

## 后果

- 好处：两套命令一眼可辨，配置在仓库里可以复现；不增加依赖；使用 `appConfig` 的代码不变
- 代价：每个环境各构建一次，切换要重新构建；同一个 `dist/` 会被最近一次构建覆盖，部署时要确认执行的是对应的命令
- 以后需要"一次构建、多处部署"时改为运行时配置，另写 ADR
