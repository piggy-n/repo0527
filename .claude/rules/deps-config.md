---
paths:
  - "**/package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - ".github/**"
  - ".oxlintrc.json"
  - "apps/yzt/.env*"
  - "apps/yzt/vite.config.ts"
  - "apps/yzt/tsconfig*.json"
  - "packages/*/tsconfig*.json"
  - "packages/*/vitest.config.ts"
  - "tsconfig.package*.json"
  - "vitest.shared.ts"
  - "apps/yzt/src/shared/config/**"
---

# 依赖、配置与 CI

## 依赖维护（ADR 0005）

- 一般依赖用 `^`；不遵守语义化版本的包精确锁定：TypeScript、oxlint（`jsPlugins` 处于 alpha 阶段）、oxlint-tsgolint（内置 TS）
- 0.x 版本的包，小版本升级按大版本对待
- 新版本发布满 3 天（`minimumReleaseAge: 4320`）才能安装，防止装到刚发布的恶意版本；紧急安全补丁用 `minimumReleaseAgeExclude` 临时豁免该版本，冷却期过后删除豁免
- Node 与 pnpm 的版本在根 `package.json` 的 `devEngines` 中声明，CI 从这里读取；`@types/node` 跟随 Node 的大版本，不随 latest 升级
- workflow 中的 Actions 用 commit SHA 固定并注释版本号，随 `pnpm deps:check` 一起检查更新
- 小版本和补丁：CI 通过后合并
- 大版本：先读 Breaking Changes 和迁移指南再决定；等出过几个补丁版本再升；一次只升一个包，单独提交，并在提交说明里写明迁移内容
- 每月手动检查一次（`pnpm deps:check`），接入 Renovate 后改为每周自动处理；安全告警随时处理
- 两个及以上的包用到的依赖在 `pnpm-workspace.yaml` 的 `catalog` 写版本，包里写 `catalog:`（ADR 0143）；只有一个包用到的写在那个包里
- `pnpm-lock.yaml` 必须提交
- 依赖的安装脚本默认不执行，是否放行在 `pnpm-workspace.yaml` 的 `allowBuilds` 中逐个决定

## 配置与环境变量

- 路径别名只在 tsconfig 的 `paths` 中配置，Vite 通过 `resolve.tsconfigPaths` 读取，不另配 `resolve.alias`
- 自定义环境变量只在 `shared/config/app-config.ts` 中读取和校验，其他代码使用 `appConfig`；Vite 内置的 `DEV`、`PROD`、`MODE`、`BASE_URL` 可以直接读取。新增变量要在 `shared/config/import-meta-env.ts` 中声明类型
- `VITE_` 开头的变量会写进构建产物，不能放密钥；只给 `vite.config.ts` 用的变量不加 `VITE_` 前缀
- 新增开关先按 `docs/config/overview.md` 的"新增一个开关时放哪"选类别，并在总览登记；所有部署都一样的产品开关只放 `shared/config/<主题>-options.ts`，只写类型和常量、不导入别的模块（Node 直接运行的工具也会读），不进 `.env`，也不散放在页面、feature 或包里
- 内网与公网的差异只写在 `.env.intranet`（`pnpm build:intranet`、`dev:intranet`），代码只读 `appConfig`，不判断模式名；区分生产与开发用 `PROD` / `DEV`，不用 `MODE`（ADR 0032）
- tsconfig 不开启 `incremental`：TS 7.0.2 的增量检查在 `declare global` 文件变化后会给出过期结果（ADR 0009）

## CI

- CI 用 GitHub Actions：冻结安装 → 类型检查 → lint → 安装浏览器 → 测试 → 公网、内网构建 → 生产产物冒烟（ADR 0005、0040、0065）；构建自动清理设计稿副本和 3DT 模型数据并检查开发页、入口静态依赖和天地图 key，见 docs/config/vite-config.md
