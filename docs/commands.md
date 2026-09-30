# 常用命令说明

所有命令都在**仓库根目录**执行。每条命令按四部分说明：作用、什么时候用、执行了什么、注意事项。

脚本定义在根目录和 `apps/web` 的 `package.json` 里，字段说明见 [config/package-json.md](config/package-json.md)。

## 速查表

| 场景 | 命令 |
|---|---|
| 刚 clone / 切分支 / 拉代码后 | `pnpm install` |
| 本地开发 | `pnpm --filter @yzt/web dev` |
| 提交前（和 CI 相同） | `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm build` |
| 自动修复 lint 问题 | `pnpm lint:fix` |
| 写代码时持续运行测试 | `pnpm --filter @yzt/web test:watch` |
| 预览构建产物 | `pnpm --filter @yzt/web preview` |
| 每月检查依赖 | `pnpm deps:check` |
| 范围内升级 | `pnpm deps:update:within-range` |
| 大版本升级 | `pnpm deps:update:allow-major` |
| 升级 pnpm 自身 | `pnpm pnpm:update:project:latest` |

---

## 一、安装依赖

### `pnpm install`

**作用**：按 `package.json` 和 `pnpm-lock.yaml` 安装整个 workspace 的依赖。

**什么时候用**：

- 刚 clone 仓库
- 拉取代码或切换分支后，别人改过依赖
- 手动修改过 `package.json`

**执行了什么**：

1. 检查 pnpm 和 Node 的版本是否满足 `devEngines`；pnpm 不满足会自动下载，Node 不满足直接报错
2. 按 `minimumReleaseAge` 校验 lockfile 里每个包的发布时间（日志里的 "Verifying lockfile against supply-chain policies"）
3. 解析依赖；`package.json` 有变化时更新 lockfile
4. 从全局存储把包链接到各个包的 `node_modules`
5. 按 `allowBuilds` 决定是否执行依赖的安装脚本

**注意事项**：

- 报 `ERR_PNPM_IGNORED_BUILDS`：有新依赖带安装脚本，要在 `pnpm-workspace.yaml` 的 `allowBuilds` 里做选择，见 [config/pnpm-workspace.md](config/pnpm-workspace.md)
- 报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`：某个版本发布不满 3 天。等几天，或者在紧急情况下用 `minimumReleaseAgeExclude` 临时豁免
- 报 "This project requires Node.js ^24"：本机 Node 版本不对，切换到 24.x
- 本机的全局配置用的是 npmmirror 镜像，CI 用 npm 官方源。lockfile 只记录校验和、不记录下载地址，所以两边可以共用

### `pnpm install --frozen-lockfile`

**作用**：严格按 lockfile 安装，不允许修改 lockfile。

**什么时候用**：CI 里使用；本地想确认"lockfile 和 `package.json` 是否一致"时也可以用。

**执行了什么**：和 `pnpm install` 相同，但 lockfile 需要更新时直接失败。

**注意事项**：CI 失败在这一步，通常是改了 `package.json` 却没提交更新后的 `pnpm-lock.yaml`。

### `pnpm add`

**作用**：添加新依赖。

**什么时候用**：需要引入新库时。先确认现有依赖里没有同类库（AGENTS.md）。

**常见写法**：

```bash
pnpm --filter @yzt/web add lodash-es
```

给应用添加运行时依赖。

```bash
pnpm --filter @yzt/web add -D some-tool
```

给应用添加开发依赖。

```bash
pnpm add -Dw some-lint-tool
```

给根目录添加整个仓库共用的工具，`-w` 表示 workspace 根。

```bash
pnpm add -Dw -E some-tool
```

精确锁定版本，用于不遵守语义化版本的包。

**注意事项**：

- 不指定版本时，pnpm 会选择满足冷却期的最新版本，所以可能比 npm 上的 latest 旧一点，这是预期行为
- 指定了一个发布不满 3 天的版本会直接失败
- 大版本升级要单独提交，并在提交说明里写明迁移内容（ADR 0005）

---

## 二、开发与预览

### `pnpm --filter @yzt/web dev`

**作用**：启动 Vite 开发服务器，修改代码后浏览器自动更新（HMR）。

**什么时候用**：日常开发。

**执行了什么**：在 `apps/web` 里运行 `vite`。Vite 按需编译浏览器请求的模块：TSX 交给 `@vitejs/plugin-vue-jsx`（Babel），`*.module.scss` 交给 sass-embedded，`@/` 别名按 tsconfig 的 `paths` 解析。

**注意事项**：

- **开发服务器不做类型检查**。Vite 只把 TS 转成 JS，类型错误不会阻止页面运行。类型问题要看编辑器提示，或者运行 `pnpm typecheck`
- 默认端口是 5173，被占用时 Vite 会自动换下一个端口，以终端输出的地址为准
- `--filter @yzt/web` 指定在哪个包里运行；也可以 `cd apps/web` 后执行 `pnpm dev`

### `pnpm --filter @yzt/web preview`

**作用**：在本地启动一个静态服务器，预览 `pnpm build` 的产物。

**什么时候用**：想确认构建产物能正常运行，例如检查资源路径、懒加载的模块。

**执行了什么**：用 `vite preview` 托管 `apps/web/dist`。

**注意事项**：必须先运行 `pnpm build`；它只用于本地检查，不能当生产服务器。

### `pnpm --filter @yzt/web title:generate`

**作用**：重新生成系统名称（取自 `.env` 的 `VITE_APP_TITLE`）和登录页 `WELCOME!` 的 SVG 轮廓。

**什么时候用**：修改了系统名称或 `tools/system-title/paths.ts` 中的文字清单，而开发服务器没有开着时。开着的话，开发服务器会因为 `.env` 或配置文件变化自动重启并重新生成，不需要手动运行。

**执行了什么**：Node 直接运行 `tools/system-title/cli.ts`，读取 `public/fonts/YouSheBiaoTiHei-2.ttf`，对清单中的每段文字，文字或字间距变了才写入 `src/shared/system-title/` 下对应的 JSON。

**注意事项**：需要本机有优设标题黑字体文件（不入库），缺少时退出码为 1；生成后记得提交 JSON。详见 [modules/system-title.md](modules/system-title.md)。

### `pnpm --filter @yzt/web icons`

**作用**：规范化 `src/assets/icons/` 中的全部 SVG（改名、去固定颜色等），并更新注册表 `src/shared/icons/icons.json`。

**什么时候用**：放入新图标而开发服务器没有开着时；开着的话会自动处理。

**执行了什么**：运行 `@yzt/icons` 提供的 `yzt-icons src/assets/icons src/shared/icons/icons.json`。加 `--check` 只检查不改动，有待处理的内容时退出码为 1。

**注意事项**：中文文件名会报错，需要手动改名；处理后提交图标文件和 `icons.json`。详见 [modules/icons.md](modules/icons.md)。

---

## 三、质量检查

提交前按顺序运行下面三条命令，和 CI 的检查完全一致：

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm build
```

### `pnpm typecheck`

**作用**：检查所有包的 TypeScript 类型。

**什么时候用**：提交前；改了类型、接口、tsconfig 之后。

**执行了什么**：根目录的 `pnpm -r typecheck` 在每个包里执行 `typecheck` 脚本。目前只有 `apps/web`，执行的是 `tsc -b`：

1. 读取 `tsconfig.json` 的 `references`
2. 依次全量检查 `tsconfig.app.json`（`src/`）和 `tsconfig.node.json`（`vite.config.ts`）
3. 有错误时退出码非 0

**注意事项**：

- 只检查，不输出任何文件（`noEmit`）
- 每次都是全量检查，目前约 1 秒。增量检查因 TS 7.0.2 的问题已关闭（ADR 0009）
- 这里的 `tsc` 是 TS 7（Go 原生实现），速度很快；不要改用 vue-tsc（ADR 0003）

### `pnpm lint`

**作用**：检查代码质量、类型相关的问题和依赖方向。

**什么时候用**：提交前；新增文件或调整目录结构之后。

**执行了什么**：在根目录运行 `oxlint`：

1. 读取 `.oxlintrc.json`，按 `.gitignore` 跳过 `node_modules`、`dist` 等；只检查 JS / TS 类文件，Markdown 等不在范围内
2. Rust 实现的规则直接在 oxlint 里运行
3. 类型感知规则交给 `oxlint-tsgolint`，它读取 tsconfig 做类型分析
4. `eslint-plugin-boundaries` 通过 `jsPlugins` 在 Node 里运行，检查依赖方向

目前全仓库约 1 秒。

**注意事项**：

- 有违规时退出码非 0，所有规则都是 `error`
- 确实要在代码里关闭某条规则时，必须写原因：`// oxlint-disable-next-line <规则> -- 原因`；不再需要的关闭注释本身也会报错
- lint 不管格式，格式由 WebStorm 负责
- 规则说明见 [config/oxlintrc.md](config/oxlintrc.md)

### `pnpm lint:fix`

**作用**：自动修复可以安全修复的 lint 问题。

**什么时候用**：lint 报了很多可自动修复的问题时，例如 `prefer-const`、重复导入。

**执行了什么**：`oxlint --fix`，只应用标记为"安全"的修复。可能改变程序行为的建议（`--fix-suggestions`）和危险修复（`--fix-dangerously`）不会执行。

**注意事项**：修复后看一下 diff 再提交；依赖方向、`any` 这类问题需要手动改。

### `pnpm test`

**作用**：运行所有包的测试一次。

**什么时候用**：提交前；改了有测试覆盖的代码之后。

**执行了什么**：根目录的 `pnpm -r test` 在 `apps/web` 里执行 `vitest run`：

1. 读取 `vite.config.ts`（与开发、构建共用插件、别名和 `.env`，模式为 `test`）
2. 运行 `src/**/*.test.{ts,tsx}`，DOM 环境是 jsdom
3. 有失败时退出码非 0

**注意事项**：

- 测试文件和源文件放在一起，显式从 `vitest` 导入 `describe`、`it`、`expect`（不开 `globals`）
- 只跑某个目录或文件：`pnpm --filter @yzt/web test -- src/app/router`
- 本地 `it.only` 会让其他用例被跳过，lint 会报错；CI 中 Vitest 会直接拒绝运行
- Vitest 只转译不做类型检查，测试文件的类型由 `pnpm typecheck` 检查

### `pnpm --filter @yzt/web test:watch`

**作用**：监听文件变化，自动重跑受影响的测试。

**什么时候用**：写代码、写测试时开着。按 `q` 退出，按 `h` 查看快捷键。

### `pnpm build`

**作用**：生产构建。

**什么时候用**：提交前确认能构建成功；需要部署产物时。

**执行了什么**：根目录的 `pnpm -r build` 在 `apps/web` 里执行 `vite build`：Rolldown 打包、压缩，输出到 `apps/web/dist`。文件名带内容哈希，CSS Modules 的类名也会哈希化。

**注意事项**：

- **构建不做类型检查**，类型错误的代码也能构建成功，所以 `pnpm typecheck` 要单独跑
- `dist/` 已被 `.gitignore` 忽略

---

## 四、依赖维护

维护规则见 ADR 0005 和 AGENTS.md。当前的节奏是每月手动检查一次，以后接入 Renovate 后改为自动处理。

### `pnpm deps:check`

**作用**：列出所有可升级的依赖和 GitHub Actions。

**什么时候用**：每月一次；收到安全告警时。

**执行了什么**：`pnpm outdated -r --include-github-actions`，对比 workspace 所有包的依赖，以及 `.github/workflows` 里的 Actions。

**注意事项**：

- **有可升级项时退出码是 1**，这是 `pnpm outdated` 的正常行为，不代表出错
- `@types/node` 会一直显示可以升到 26，但它要跟随 Node 24，不要升
- 列表里只是"可以升"，要不要升按 ADR 0005 的规则判断

### `pnpm deps:update:within-range`

**作用**：在 `package.json` 声明的范围内升级依赖，同时升级 Actions。

**什么时候用**：`deps:check` 之后，处理小版本和补丁。

**执行了什么**：`pnpm -r update --include-github-actions`。`^1.2.3` 这类依赖升到范围内的最新版本，并更新 lockfile；精确锁定的包不变；Actions 升到同一大版本内的最新版，并写成 SHA 加版本注释。

**注意事项**：升级后跑一遍 `pnpm typecheck`、`pnpm lint`、`pnpm build`，通过后单独提交。

### `pnpm deps:update:allow-major`

**作用**：交互式选择要升级大版本的依赖和 Actions。

**什么时候用**：读完目标版本的 Breaking Changes 和迁移指南，决定升级之后。

**执行了什么**：`pnpm update -r -i --latest --include-github-actions`。`--latest` 忽略现有范围、直接取最新版；`-i` 列出可升级项让你勾选。

**注意事项**：

- 需要在可交互的终端里运行
- 原有写法会被保留：精确锁定的 `6.0.0` 升级后仍是精确的 `7.0.0`，`^2.0.0` 会变成 `^3.x.x`（阶段一已验证）
- 一次只勾选一个包，升级后单独提交，提交说明写明迁移内容
- 不追 x.0.0，等出过几个补丁版本再升

### `pnpm pnpm:update:project:latest`

**作用**：把项目使用的 pnpm 升级到最新版。

**什么时候用**：pnpm 发布新版本、需要升级时。

**执行了什么**：

1. `pnpm self-update`：升级 pnpm，并把 `devEngines.packageManager.version` 改成具体的版本号
2. `pnpm install --lockfile-only`：更新 lockfile 里锁定的 pnpm 版本（`packageManagerDependencies`）
3. `node scripts/pnpm-major.mjs`：把版本号改回 `^<大版本>` 的范围写法
4. 再次 `pnpm install --lockfile-only`：让 lockfile 和改回后的范围一致

**注意事项**：如果升到了新的大版本，范围会变成新的大版本（例如 `^13`），要按大版本升级的规则评估，并确认 CI 的 `pnpm/action-setup` 支持它。

---

## 五、排查问题

下面这些命令平时用不到，遇到"为什么会这样"时很有帮助，也适合用来学习工具的工作方式。

| 命令 | 用途 |
|---|---|
| `pnpm --filter @yzt/web exec tsc -b --verbose` | 看 `tsc -b` 为什么判定某个项目需要重查或可以跳过 |
| `pnpm --filter @yzt/web exec tsc -p tsconfig.app.json --listFilesOnly` | 列出这份 tsconfig 实际包含的所有文件，包括依赖的 `.d.ts` |
| `pnpm exec oxlint --print-config` | 打印合并后的 lint 配置，确认规则是否生效 |
| `pnpm exec oxlint --debug=files` | 列出 lint 会检查哪些文件 |
| `ESLINT_PLUGIN_BOUNDARIES_DEBUG=1 pnpm lint` | 打印 boundaries 对每条依赖的判断依据（PowerShell 里先执行 `$env:ESLINT_PLUGIN_BOUNDARIES_DEBUG=1`） |
| `pnpm why <包名>` | 查看某个依赖是被谁引入的 |
| `pnpm peers check` | 检查 peer 依赖是否满足 |

`pnpm install --force` 会重新链接全部依赖。执行前必须停掉开发服务器、测试等所有正在运行的 Node 进程：它们占用的文件（例如 sass 的 `dart.exe`）会让重装中途失败，并留下缺少文件的依赖（见 [config/internal-packages.md](config/internal-packages.md) 的"踩过的坑"）。
