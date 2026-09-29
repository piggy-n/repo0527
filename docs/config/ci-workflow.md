# CI 工作流说明

对应文件：`.github/workflows/ci.yml`
相关决策：ADR 0005（依赖维护与持续集成）

它是 YAML 文件，文件里保留了简短的注释，这里做完整说明。

## 作用

每次推送到 `main`，或者有 Pull Request 时，GitHub 会在一台干净的 Linux 机器上从零执行：

```
检出代码 → 安装 pnpm → 安装 Node → pnpm install --frozen-lockfile → 类型检查 → lint → 测试 → 构建
```

任何一步失败，这次运行就标红。它回答的问题是："在一台没有任何本地缓存和个人配置的机器上，这份代码还能不能通过所有检查？"

本地通过但 CI 失败，通常说明依赖了没提交的文件、本机特有的环境，或者 lockfile 和 `package.json` 不一致。

## 逐段说明

### 触发条件

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

- 推送到 `main` 时运行：保证主分支始终可用
- 任何 Pull Request 都运行：合并前先检查。以后接入 Renovate 后，它提的依赖升级 PR 也靠这一步把关

### 权限

```yaml
permissions:
  contents: read
```

GitHub 会给每次运行发一个临时令牌（`GITHUB_TOKEN`）。这里把权限降到只能读代码，遵循最小权限原则：万一某个 Action 被攻破，它也拿不到写仓库的权限。

### 并发控制

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

同一分支连续推送时，自动取消旧的运行，只保留最新一次，节省排队时间。

### 运行环境

```yaml
runs-on: ubuntu-latest
```

类型检查、lint、构建的结果和操作系统无关，用 Linux 最快、最常见。开发机是 Windows，CI 是 Linux，正好还能发现路径大小写之类的跨平台问题。

### 检出代码

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    persist-credentials: false
```

`persist-credentials: false` 表示检出后不把令牌留在 `.git/config` 里。后续步骤不需要推送代码，没必要让令牌一直留在磁盘上。

### 安装 pnpm 和 Node

```yaml
- uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0

- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  with:
    node-version-file: package.json
    cache: pnpm
```

- `pnpm/action-setup` 没有写 `version`，自动读取 `package.json` 的 `devEngines.packageManager`
- `actions/setup-node` 从 `package.json` 读取版本，优先使用 `devEngines.runtime`（setup-node 6.3 起支持）
- `cache: pnpm` 按 lockfile 的内容缓存 pnpm 的包存储，lockfile 不变时安装会快很多

pnpm/action-setup 必须排在 setup-node 前面，因为 setup-node 的 pnpm 缓存要调用 `pnpm` 命令。

这样 pnpm 和 Node 的版本都只在 `package.json` 声明一次，本地和 CI 共用同一个来源。

### 检查步骤

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm typecheck
- run: pnpm lint
- run: pnpm test
- run: pnpm build
```

| 步骤 | 作用 |
|---|---|
| `pnpm install --frozen-lockfile` | 严格按 lockfile 安装；lockfile 和 `package.json` 对不上时直接失败，而不是悄悄改写 lockfile。同时会按 `minimumReleaseAge` 校验 lockfile |
| `pnpm typecheck` | 所有包的 `tsc -b` |
| `pnpm lint` | oxlint，包括类型感知规则和依赖方向检查 |
| `pnpm test` | 所有包的 `vitest run`（ADR 0010）。GitHub Actions 会设置 `CI` 环境变量，Vitest 检测到后会拒绝带 `.only` 的测试，避免其他用例被悄悄跳过（已验证） |
| `pnpm build` | 生产构建，确认能打出产物 |

## Actions 为什么用 commit SHA 固定

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

而不是：

```yaml
uses: actions/checkout@v7
```

`v7` 这样的 tag 是可以被移动的：仓库所有者（或盗用了账号的攻击者）可以把 `v7` 改指向另一个 commit。2025 年就发生过广泛使用的 Action 的 tag 被改指向恶意代码的事件，所有写 tag 的项目都受到影响。commit SHA 由内容计算得出，无法被篡改。

后面的 `# v7.0.1` 注释给人看，也给工具看。阶段一实测，pnpm 12 能识别这种写法：

- `pnpm deps:check`（带 `--include-github-actions`）会把它列入可升级检查
- `pnpm update --include-github-actions` 升级时会写入新的 SHA 和版本注释，遇到 `@v4` 这种 tag 写法还会自动改写成 SHA

所以固定 SHA 几乎没有额外的维护成本。

## 考虑过的替代方案

| 方案 | 没采用的原因 |
|---|---|
| `pnpm/setup@v3`，一步装好 pnpm 和 Node，还校验 pnpm 二进制的签名 | pnpm 官方的继任 Action，但 v3.0.0 当时才发布 9 天，按 ADR 0005 "不追 x.0.0" 暂不采用，以后可以替换 |
| 在 workflow 里写死 `node-version: 24` | 版本会有两个来源，升级时容易漏改 |
| 多系统、多 Node 版本的矩阵 | 这是应用不是库，只需要保证在一个确定的环境下可用 |
| 使用 action-setup 自带的 `cache` | 和 setup-node 的 `cache: pnpm` 效果类似，选了更常见的写法 |

## 还没做的事

- 在 GitHub 仓库设置中开启 Dependabot 安全告警（手动操作，只开告警，不开版本更新）
- 以后改用 Pull Request 流程时，可以给 `main` 设置分支保护，要求 CI 通过才能合并

## 迁移到其他平台或停用 CI

### 为什么迁移成本低

真正做检查的只有"检查步骤"一节里的 5 条命令，它们都定义在 `package.json` 中，本地可以原样复现。和 GitHub 绑定的只是外层：怎么装 Node 和 pnpm、怎么缓存、什么时候触发。仓库里和 GitHub 相关的地方只有：

| 位置 | 内容 |
|---|---|
| `.github/workflows/ci.yml` | 唯一真正依赖平台的文件 |
| 根 `package.json` 的 `deps:check`、`deps:update:within-range`、`deps:update:allow-major` | `--include-github-actions` 参数，顺带检查 Actions 的版本 |
| AGENTS.md、ADR 0005、本文、`commands.md` | 文字描述，以及"Actions 用 SHA 固定"的约定 |
| GitHub 仓库设置 | Dependabot 安全告警 |

保持迁移成本低的前提是继续遵守本文末尾的检查清单：新增检查步骤时，先在 `package.json` 里加脚本，CI 只负责调用。

### 停用 CI

1. 删除 `.github/workflows/ci.yml`，或者在 GitHub 仓库设置中禁用 Actions
2. 去掉三个 `deps:*` 脚本中的 `--include-github-actions`
3. 写一份新的 ADR 说明理由（取代 ADR 0005 中关于 CI 的部分），同步 AGENTS.md、本文和 `commands.md`

停用后的代价：质量检查只能靠提交前手动运行那 5 条命令；也失去了"干净环境"这道保障，"依赖了没提交的文件""改了 `package.json` 没提交 lockfile"这类问题在本地发现不了。

### 迁移到其他平台

步骤：

1. 按下面的对照表编写新平台的流水线文件，删除 `.github/workflows/`
2. 去掉三个 `deps:*` 脚本中的 `--include-github-actions`；Docker 镜像等的更新检查改由新平台或 Renovate 负责
3. 确认新平台会设置 `CI` 环境变量；如果不会，在流水线里显式设置 `CI=true`，保证 Vitest 仍然拒绝 `.only`
4. 如果改用内网的 npm 源，按下文"内网 npm 源"一节实测冷却期
5. 为安全告警找替代，例如在流水线中加 `pnpm audit`，或者使用平台自带的依赖扫描
6. 写新的 ADR（取代 ADR 0005 中关于 CI 平台的部分），同步 AGENTS.md、本文和 `commands.md`
7. 推一个分支验证每一步；再故意留一个 `it.only` 或类型错误，确认流水线会失败

各平台的差异对照：

| 事项 | GitHub Actions（现状） | GitLab CI | Gitee |
|---|---|---|---|
| 流水线文件 | `.github/workflows/ci.yml` | `.gitlab-ci.yml` | 自带的 Gitee Go 语法不同；也常配 Jenkins 或自建 runner |
| Node 版本 | `setup-node` 读取 `devEngines.runtime` | 写在镜像名里（如 `node:24`），要和 `devEngines.runtime` 手动保持一致 | 同左，取决于所用的构建环境 |
| pnpm 版本 | `pnpm/action-setup` 读取 `devEngines.packageManager` | 先装任意 pnpm，`onFail: download` 会自动切换到声明的版本 | 同左 |
| 防篡改 | Actions 用 commit SHA 固定 | 用 digest 固定镜像（`node:24@sha256:...`） | 同左 |
| 缓存 | `setup-node` 的 `cache: pnpm` | `cache` 按 `pnpm-lock.yaml` 缓存 pnpm 存储目录 | 取决于平台 |
| 取消旧的运行 | `concurrency` | `interruptible: true`，并在项目设置中开启自动取消冗余流水线 | 取决于平台 |
| `CI` 环境变量 | 自动设置 | 自动设置 | 未验证，不确定时显式设置 |

### GitLab CI 参考写法（未验证）

以下写法只是按 GitLab 的文档整理，**没有在真实的 GitLab 上运行过**，迁移时要逐项验证：

```yaml
# 行为对应 .github/workflows/ci.yml：推送到默认分支、合并请求时运行
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

ci:
  # Node 大版本要和 package.json 的 devEngines.runtime 一致；需要防篡改时追加 @sha256:<digest>
  image: node:24
  interruptible: true
  cache:
    key:
      files:
        - pnpm-lock.yaml
    paths:
      - .pnpm-store
  before_script:
    # 装任意 12.x 的 pnpm 即可，devEngines.packageManager 的 onFail: download 会切换到声明的版本
    - npm install -g pnpm@12
  script:
    # pnpm 存储放在项目目录内，才能被上面的 cache 缓存
    - pnpm install --frozen-lockfile --store-dir .pnpm-store
    - pnpm typecheck
    - pnpm lint
    - pnpm test
    - pnpm build
```

和 GitHub 版相比少了两项：GitLab 的作业令牌权限在项目设置中管理，没有 `permissions` 字段；检出代码由 GitLab 自动完成，没有单独的检出步骤。

### 内网 npm 源

迁移到内网的 GitLab 或 Gitee 时，CI 可能访问不了 npm 官方源，需要改用 npmmirror 或公司内部的源（在仓库根目录加 `.npmrc` 的 `registry` 配置）：

- lockfile 不受影响：它只记录校验和，不记录下载地址，阶段一已验证本机用 npmmirror、CI 用官方源可以共用一份 lockfile
- **冷却期需要实测**：`minimumReleaseAge` 依赖源提供每个版本的发布时间。公司内部的源（Nexus、Verdaccio 等）不一定提供，可能导致冷却期检查报错或失效。换源后先在流水线里跑一次 `pnpm install --frozen-lockfile`，确认输出中仍有 `Lockfile passes supply-chain policies`

另外，以后计划接入的 Renovate 支持 GitLab；是否支持 Gitee 没有确认，迁移前需要查证。

## 修改时的检查清单

- 新增或升级 Action：用 SHA 固定并写版本注释
- 新增检查步骤：同时在根 `package.json` 加对应脚本，保证本地能用同一条命令复现
- 改完先在本地按顺序跑一遍这些命令；工作流文件本身的语法错误只有推送后才会暴露
