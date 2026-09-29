# workspace 内部包的配置约定

对应目录：`packages/*`（目前只有 `packages/icons`）
相关决策：ADR 0004（模块边界）、ADR 0014（第一个内部包）

## 什么是内部包

内部包（internal package）是只在本仓库内使用、不发布到 npm 的 workspace 包。它不单独构建，`package.json` 的 `exports` 直接指向 TS 源码，由使用方（`apps/web` 的 Vite）编译：

```
apps/web  ──依赖 "@yzt/icons": "workspace:*"──▶  node_modules/@yzt/icons（符号链接）──▶ packages/icons
                                                 exports "." → ./src/index.ts
```

## 目录结构

```
packages/icons/
├─ package.json
├─ tsconfig.json          只写 references
├─ tsconfig.lib.json      检查 src/：浏览器环境（DOM、Vue TSX）
├─ tsconfig.node.json     检查 tools/、vitest.config.ts：Node 环境
├─ vitest.config.ts       包自己的测试配置
└─ src/
   ├─ index.ts            唯一入口
   ├─ css-modules.d.ts    CSS Modules 的类型（不加载 vite/client）
   └─ ...
```

## package.json

```json
{
  "name": "@yzt/icons",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -b", "test": "vitest run", "test:watch": "vitest" },
  "peerDependencies": { "vue": "^3.5.43" },
  "devDependencies": { "vue": "...", "vitest": "...", "...": "..." }
}
```

| 字段 | 说明 |
|---|---|
| `name` | `@yzt/<名字>`，和 `apps/web/src/libs` 的命名一致，将来从 libs 搬过来不用改导入 |
| `exports` 的 `./tools` | 可选的第二个入口，放 Node 端代码（例如 `@yzt/icons/tools` 的规范化工具与 Vite 插件），和浏览器入口分开，保证 SVGO 这类依赖不会进入浏览器产物 |
| `bin` | 可选的命令行，指向 `.ts` 文件，由 Node 直接运行（类型剥离）；使用方安装后在 `node_modules/.bin` 中出现，例如 `yzt-icons` |
| `private: true` | 防止被误发布 |
| `exports` | 只暴露入口。深层导入（如 `@yzt/icons/src/xxx`）在解析时就会失败 |
| 没有 `build` 脚本 | 内部包不构建；根目录的 `pnpm -r build` 会跳过它 |
| `typecheck`、`test` | 被根目录的 `pnpm -r typecheck`、`pnpm -r test` 覆盖，CI 不用改 |
| `peerDependencies` 的 `vue` | 由使用方提供同一份 Vue；包里使用两份 Vue 会导致响应式和组件实例互不相通 |
| `devDependencies` 的 `vue` | 供包自己的测试使用 |

使用方在自己的 `package.json` 中写 `"@yzt/icons": "workspace:*"`（`pnpm --filter @yzt/web add "@yzt/icons@workspace:*"`），pnpm 会建立符号链接。

## tsconfig

两份配置按运行环境拆分，和 `apps/web` 相同（见 [tsconfig.md](tsconfig.md)）。与应用不同的地方：

- `tsconfig.lib.json` 的 `types` 是空数组，不加载 `vite/client`：包里读取 `import.meta.env` 会报错（包不能依赖应用的环境，ADR 0004）。CSS Modules 的类型由 `src/css-modules.d.ts` 声明
- 不配置 `paths`：包内部只用相对路径

## 应用侧的解析

`apps/web/tsconfig.app.json` 的 `paths` 把 `@yzt/*` 映射到应用内的 `./src/libs/*/index.ts`。导入 `@yzt/icons` 时，映射找不到文件，TS 回退到 `node_modules` 解析，找到 workspace 包（已用 `--traceResolution` 验证）。所以同一个名字空间 `@yzt/*` 下，应用内 libs 和 workspace 包可以共存；但不能在两处出现同名模块。

## lint

- `boundaries/elements` 中有 `package` 元素（`packages/*`）
- 应用只能通过 `@yzt/*` 引用包（策略 6）
- 包只能依赖外部模块和包内部的相对路径（`packages` override）

详见 [oxlintrc.md](oxlintrc.md)。

## 踩过的坑

**给已安装的包新增 `bin` 后，命令不会出现。** lockfile 没有变化时，`pnpm install` 直接跳过链接。处理办法：

- 推荐：在使用方删掉再加回这个依赖，`pnpm --filter @yzt/web remove @yzt/icons`，然后 `pnpm --filter @yzt/web add "@yzt/icons@workspace:*"`
- 或者 `pnpm install --force`，但**必须先停掉所有开发服务器、测试等正在运行的 Node 进程**。阶段二实测：开发服务器运行时，sass 的 `dart.exe` 占用着文件，强制重装中途失败，把 sass-embedded 平台包里的二进制文件删掉了，之后所有 SCSS 编译都会失败（报 `sass --embedded is unavailable in pure JS mode`）。停掉进程后再执行一次 `pnpm install --force` 可以恢复

全新 clone 后的首次安装会正常链接（已在干净目录中验证）。

## 新建一个内部包的检查清单

1. 建目录和 `package.json`（参考上文），用 `pnpm --filter <包名> add` 安装依赖；有 Vue 组件时把 `vue` 设为 peer 依赖
2. 复制 `tsconfig.json`、`tsconfig.lib.json`、`tsconfig.node.json`、`vitest.config.ts`，按需调整 `include`
3. `.oxlintrc.json` 的 `import/resolver` 的 `project` 数组已用 `packages/*/tsconfig.lib.json` 通配，通常不用改
4. 在使用方添加 `workspace:*` 依赖
5. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，确认新包被覆盖
6. 在 `docs/modules/` 写模块说明，并在 AGENTS.md 的目录结构中登记
