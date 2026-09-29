# pnpm-workspace.yaml 配置说明

对应文件：根目录 `pnpm-workspace.yaml`
相关决策：ADR 0004（拆包预留）、ADR 0005（依赖维护）

它不是 JSON 文件，但和 `package.json` 一样是工程的核心配置，所以一并说明。YAML 本身支持注释，文件里保留了简短的注释。

## 这个文件管什么

1. 声明 workspace 包含哪些目录
2. pnpm 的项目级设置。pnpm 较新的版本把项目设置集中到这个文件，`.npmrc` 主要用于 registry 地址和认证

当前内容：

```yaml
packages:
  - "apps/*"
  - "packages/*"

minimumReleaseAge: 4320

allowBuilds:
  "@parcel/watcher": false
  "unrs-resolver": false
  "msw": false
```

## packages

`apps/*` 下的每个目录（目前只有 `apps/web`）都是一个 workspace 包。`packages/*` 放可复用的 `@yzt/*` 包，第一个是阶段二的 `packages/icons`（ADR 0014），配置约定见 [internal-packages.md](internal-packages.md)。

workspace 带来的能力：

- 一次 `pnpm install` 安装所有包的依赖，共用一份 `pnpm-lock.yaml`
- `pnpm -r <脚本>` 在所有包里执行，`pnpm --filter <包名> <脚本>` 在指定包里执行
- 包之间可以用 `workspace:*` 互相引用，不用发布到 npm

pnpm 的 `node_modules` 是严格的：每个包只能访问自己声明过的依赖，不会出现"没声明却能 import"的幽灵依赖。npm 和 yarn classic 把所有依赖平铺到根目录，没声明的包往往也能被 import 到。

## minimumReleaseAge

```yaml
minimumReleaseAge: 4320
```

单位是分钟，4320 就是 3 天：新版本发布满 3 天后，pnpm 才允许安装它。

### 为什么需要冷却期

近几年多次出现维护者账号被盗、发布带恶意代码的新版本的事件。这类版本通常在几小时到几天内被发现并下架。设置冷却期后，刚发布的版本不会立刻进入项目，等于让社区先替我们"试毒"。

### 为什么是 3 天

- npm 允许发布者在 72 小时内撤回（unpublish）版本，3 天正好覆盖这个窗口
- 阶段一实测，当前 lockfile 在 3 天下能通过；设成 7 天时有 50 个条目不达标（vite 8.3.1、oxlint-tsgolint 等），要先降级
- pnpm 12 的默认值是 1 天（1440）

### 显式配置带来的行为变化

没有显式配置时，找不到满足冷却期的版本，pnpm 会退回去用新版本，安装照样成功。显式配置后，`minimumReleaseAgeStrict` 默认变为 `true`，找不到就直接失败。所以"写出来"本身就把它从建议变成了硬性门槛。

冷却期同样作用于 `pnpm install --frozen-lockfile` 时的 lockfile 校验，安装日志里的 "Verifying lockfile against supply-chain policies" 就是这一步。

### 紧急情况

需要立刻安装某个安全补丁时，临时豁免这一个版本：

```yaml
minimumReleaseAgeExclude:
  - some-package@1.2.3
```

冷却期过后删掉这条豁免（AGENTS.md）。

## allowBuilds

pnpm 从 10 开始默认**不执行**依赖包的安装脚本（`preinstall`、`install`、`postinstall`）。安装脚本能在你的机器上执行任意代码，是供应链攻击最常见的入口之一。

当前使用的 pnpm 12 更进一步：遇到没有做过选择的安装脚本，`pnpm install` 会报 `ERR_PNPM_IGNORED_BUILDS`，并在本文件里写入占位项，要求明确选择 `true`（执行）或 `false`（不执行）。

| 包 | 设置 | 由谁引入 | 为什么不执行 |
|---|---|---|---|
| `@parcel/watcher` | `false` | sass-embedded → sass | 已有各平台的预编译包（例如 `@parcel/watcher-win32-x64`），安装脚本只在缺少预编译包时才从源码构建 |
| `unrs-resolver` | `false` | eslint-import-resolver-typescript | 已有各平台的预编译包（例如 `@unrs/resolver-binding-win32-x64-msvc`），安装脚本只在缺少时补装 |
| `msw` | `false` | 直接依赖（测试用） | `postinstall` 只在项目 `package.json` 配置了 `msw.workerDirectory` 时，把浏览器端的 Service Worker 脚本复制过去；项目只在测试中用 `msw/node`，用不到这个脚本 |

判断一个包要不要放行：

1. 查看它 `package.json` 里的安装脚本做什么
2. 确认是否已有对应平台的预编译包（通常是 `optionalDependencies` 里带平台名的包）
3. 能不执行就不执行；确实需要执行（例如必须现场编译原生模块）才设为 `true`，并在注释里写明原因

也可以用 `pnpm approve-builds` 交互式选择，但直接编辑本文件更便于写明原因和代码评审。

## 没有配置、可以了解的选项

| 选项 | 作用 | 现状 |
|---|---|---|
| `trustPolicy: no-downgrade` | 某个包的可信等级（例如是否带发布来源证明）比以前的版本低时拒绝安装 | 没开，可作为以后加强供应链安全的选项 |
| `blockExoticSubdeps` | 禁止间接依赖来自 git 仓库或任意 URL | 默认已开启 |
| `catalog` | 在一处定义依赖版本，各包用 `catalog:` 引用 | 没用。目前只有 `typescript` 在两个包里重复声明，以后包多了可以考虑 |

## 修改时的检查清单

- 改了 `minimumReleaseAge`：运行 `pnpm install --frozen-lockfile`，确认现有 lockfile 仍然通过校验
- 新增 `allowBuilds` 项：写明由哪个依赖引入、为什么这样选
- 新增 `packages` 目录：确认 `pnpm -r typecheck`、`pnpm -r build` 能覆盖新包
