# 江苏省统一调查监测现状图（repo0527）

使用 Vue 3、TSX、TypeScript 和 Vite 迁移现有业务系统，采用 pnpm workspace 管理应用与内部包。前端应用位于 `apps/web`，迁移进度见 [roadmap](docs/roadmap.md)。

本文面向第一次拉取项目的开发者。除环境安装步骤外，以下命令都在**仓库根目录**执行。

## 1. 准备环境

安装 Git、Node.js，并准备可以访问 npm 包源的网络。业务功能还需要后端网络访问权限和有效登录账号，请向项目维护者取得。

| 工具 | 项目要求 | 版本处理方式 |
|---|---|---|
| Node.js | `24.x`，本地已验证 `24.16.0` | 自行安装或通过版本管理器切换；项目不会自动安装 Node |
| pnpm | 声明 `^12`，当前锁定 `12.14.0` | 支持项目版本管理的 pnpm 会按锁文件选择版本 |
| 项目依赖 | 使用已提交的锁文件 | 在根目录执行 `pnpm install --frozen-lockfile` |
| Microsoft Visual C++ 运行库（仅 Windows） | x64 版 Visual C++ Redistributable 2015-2022 | 从微软官网下载安装；lint 依赖方向检查用到的 `unrs-resolver` 原生模块需要它 |

以上版本核对于 2026-10-22。后续以根目录 [package.json](package.json) 的 `devEngines` 和 [pnpm-lock.yaml](pnpm-lock.yaml) 的 `packageManagerDependencies` 为准。Node 声明的是大版本范围，具体依赖还可能要求较新的小版本；新电脑建议使用已验证的 `24.16.0` 或更新的 24.x。

### Node 版本不同怎么办

先检查当前终端使用的版本：

```shell
node --version
npm --version
```

如果已有其他项目需要不同的 Node 版本，使用自己环境中的版本管理器切换到 24.x；首次安装也可以从 [Node.js 官网](https://nodejs.org/) 取得对应版本。切换或安装后重新打开终端，再检查版本。项目的 `devEngines.runtime.onFail` 是 `error`，不满足要求时会报错。

### 没有 pnpm，或已有版本较旧怎么办

在项目目录外运行以下安装命令：

```shell
npx get-pnpm 12.14.0
```

这是 pnpm 官方安装器，支持指定版本；安装说明见 [pnpm 文档](https://pnpm.io/installation/) 和 [get-pnpm](https://www.npmjs.com/package/get-pnpm)。安装会配置本机 pnpm 命令，完成后按提示重新打开终端：

```shell
pnpm --version
```

本项目通过 `devEngines.packageManager` 和锁文件管理 pnpm 版本，`onFail: download` 允许下载并使用项目要求的版本。很旧的 pnpm 不一定识别这一配置，首次接入直接安装上述版本更明确。进入项目后再执行 `pnpm --version`，确认实际使用的版本。

如果 Windows 安装后仍调用旧版本，可用 `where.exe pnpm` 检查 PATH 中是否有多个入口，确认终端及 IDE 使用的是预期安装。不要通过修改项目版本声明来迁就本机旧环境，也不要执行项目的 pnpm 升级脚本来完成首次安装。

### Windows 上 lint 报 Cannot find native binding

`pnpm lint` 在 `boundaries(dependencies)` 规则上报 `Resolve error: Cannot find native binding`，而 `node_modules` 里已经有 `@unrs/resolver-binding-win32-x64-msvc`，多半是本机缺少 Visual C++ 运行库（`C:\Windows\System32` 下没有 `vcruntime140.dll`）。安装上表的运行库后重新打开终端即可，不需要重新安装依赖，也不要删除锁文件。

## 2. 拉取代码并安装依赖

```shell
git clone https://github.com/piggy-n/repo0527.git
cd repo0527
pnpm install --frozen-lockfile
```

安装会覆盖整个 workspace，不需要进入各子目录分别安装。`--frozen-lockfile` 按已提交的版本安装，锁文件与依赖声明不一致时直接失败，不会重写锁文件。

- 使用 pnpm 安装项目依赖，不混用 `npm install` 或 Yarn
- 不复制其他电脑的 `node_modules`，尤其不要跨操作系统复制
- 拉取更新或切换分支后，重新执行 `pnpm install --frozen-lockfile`
- 若报告锁文件不一致，先确认分支、pnpm 版本及本地改动；不要删除锁文件重新生成，交由维护者确认

安装脚本策略、依赖发布冷却期及常见报错见 [常用命令](docs/commands.md) 和 [workspace 配置](docs/config/pnpm-workspace.md)。

## 3. 配置后端与地图服务

仓库已提交 `apps/web/.env`，默认使用以下后端：

```dotenv
PROXY_TARGET=http://192.168.1.180:18010
```

如果新电脑能访问该服务器，可以直接沿用；连接内网可能需要所在局域网或团队提供的 VPN。前端启动成功不代表后端可用，登录、资源管理、文件管理等业务仍需要真实接口和账号。本仓库不包含可由启动命令自动启动的业务后端。

需要连接其他后端时，用编辑器新建 UTF-8 文件 `apps/web/.env.local`，只填写需要覆盖的变量。例如，将下方地址替换为实际服务器地址：

```dotenv
PROXY_TARGET=http://backend.example.com:18010
```

`.env.local` 已被 Git 忽略，个人配置不提交。无需为了本机配置修改已提交的 `.env`。

- `VITE_API_BASE_URL` 保持 `/backend`，浏览器请求由 Vite 转发到 `PROXY_TARGET`
- AI 对话的后端是另一个服务：`/ai-backend` 转发到 `AI_PROXY_TARGET`（默认是旧项目的本机开发地址 `http://localhost:8090`），尚未联调，见 [docs/modules/ai-chat.md](docs/modules/ai-chat.md)
- 若另一套后端的 SM2 登录公钥不同，在 `.env.local` 中一并覆盖 `VITE_LOGIN_PUBLIC_KEY`，值由后端维护者提供
- 天地图开启时，需要有效的浏览器端 key，并确认使用地址符合该 key 的配置；需要自己的 key 时覆盖 `VITE_TIANDITU_KEY`
- `VITE_` 开头的配置会进入前端产物，不填写账号密码、私钥或服务端密钥

不使用天地图时，可直接使用下一节的 `dev:intranet`。它只关闭天地图公网请求，不提供离线业务数据，也不取消对业务后端的依赖。完全离线安装依赖另需包源或缓存支持，不属于该模式的作用。

环境文件优先级、字段校验及生产配置见 [环境变量说明](docs/config/env.md)。

## 4. 准备字体

字体目录 `apps/web/public/fonts/` 不纳入 Git。需要复现已验收的页面外观时，向维护者取得团队使用的原始字体及对应许可证，或按 [字体说明](docs/design/fonts.md) 中的来源取得，并保持文件名不变。

| 文件 | 用途 | 是否影响首次启动 |
|---|---|---|
| `AlibabaPuHuiTi-3-55-Regular.woff2` | 全局正文，400 字重 | 缺失时回退到系统字体 |
| `AlibabaPuHuiTi-3-75-SemiBold.woff2` | 全局标题等，600 字重 | 缺失时回退到系统字体 |
| `SourceHanSerifCN-Heavy.otf` | 驾驶舱局部标题，使用记录中的完整字库 | 缺失时页面及 PNG 导出使用后备字体 |
| `YouSheBiaoTiHei-2.ttf` | 重新生成系统名称的 SVG 轮廓 | 正常启动不需要；修改系统名称时需要 |

这些文件都放在 `apps/web/public/fonts/` 下，思源宋体的 SIL OFL 1.1 许可证同目录保存。不要将字体强制加入 Git，也不要自行裁剪或转换团队采用的字体文件。

缺少字体不阻止默认配置下的启动和构建，但字体请求可能出现 404，页面外观与文字尺寸会有差异；系统名称沿用已提交的 SVG 轮廓。做 UI 验收前应补齐对应字体。授权、具体来源和缺失表现见 [字体说明](docs/design/fonts.md)。

## 5. 启动开发页面

正常开发：

```shell
pnpm --filter @yzt/web dev
```

不请求天地图的内网模式：

```shell
pnpm --filter @yzt/web dev:intranet
```

选择其中一个命令运行，打开终端显示的地址，通常为 `http://localhost:5173`。默认端口被占用时以终端实际输出为准；显式配置 `PORT` 时采用固定端口，被占用会报错。结束开发时按 `Ctrl+C` 停止自己启动的服务。

根目录没有 `dev` 脚本，需要通过 `--filter @yzt/web` 指定应用。IDE 的运行配置也应使用相同的 Node、pnpm 和工作目录。

开发环境提供 `/dev/theme` 和 `/dev/map-ui` 作为设计规范与已验收组件参考；它们不包含在生产构建中，不能替代业务页面的接口与地图验证。

## 6. 首次验证与常用命令

先验证类型、规范和构建：

```shell
pnpm typecheck
pnpm lint
pnpm build
```

需要运行测试时，首次安装对应的测试浏览器，升级 Playwright 后也应重新安装：

```shell
pnpm --filter @yzt/web test:browser:install
pnpm test
```

Linux 环境还需要浏览器系统依赖，可以使用与 CI 相同的安装命令；安装系统依赖可能需要管理员权限：

```shell
pnpm --filter @yzt/web exec playwright install --with-deps --only-shell chromium
```

| 场景 | 命令 |
|---|---|
| 内网构建 | `pnpm build:intranet` |
| 预览最近一次构建产物 | `pnpm --filter @yzt/web preview` |
| 只跑单元测试 | `pnpm --filter @yzt/web test:unit` |
| 只跑浏览器测试 | `pnpm --filter @yzt/web test:browser` |
| 生产冒烟 | 先 `pnpm build:intranet`，再 `pnpm --filter @yzt/web test:smoke` |

构建产物位于 `apps/web/dist/`。`preview` 用于本地检查，正式部署的路由回退和接口代理按 [部署说明](docs/deployment.md) 配置。测试及生产冒烟使用本地固定数据，不等于已经验证新电脑到真实后端的网络和账号权限。

## 继续开发前阅读

- [AGENTS.md](AGENTS.md)：项目开发约定、依赖方向和协作方式
- [代码风格](docs/code-style.md)：编码、注释、格式与换行要求
- [UI 工作流程](docs/design/ui-workflow.md)：交互设计稿、真实页面检查与验收
- [常用命令](docs/commands.md)：脚本用途、执行时机和排错
- [文档索引](docs/README.md)：架构决策、模块说明、设计规范与迁移记录
