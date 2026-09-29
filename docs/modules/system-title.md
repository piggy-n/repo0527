# 系统名称（SystemTitle）

相关决策：ADR 0012
对应文件：`apps/web/src/shared/system-title/`、`apps/web/tools/system-title/`

系统名称用优设标题黑显示，但不加载这款字体，而是把文字预先生成 SVG 轮廓。系统名称是固定文字，这样不用分发字体文件，也不用为 12 个字下载 1.4 MB。

## 怎么用

```tsx
import { SystemTitle } from '@/shared/system-title/SystemTitle';

<h1 class={styles.title}>
  <SystemTitle />
</h1>
```

```scss
.title {
  // SVG 高度为 1em，和同字号的文字一样大
  font-size: var(--font-size-title);
  // 轮廓用 currentColor 填充
  color: var(--color-primary);
}
```

- 大小由父元素的 `font-size` 控制，颜色由 `color` 控制，和普通文字一样
- SVG 带有 `role="img"` 和 `aria-label`，读屏软件会读出系统名称

## 怎么修改系统名称

1. 确认本机有 `local-assets/fonts/YouSheBiaoTiHei-2.ttf`（见 [design/fonts.md](../design/fonts.md)）
2. 修改 `apps/web/.env` 中的 `VITE_APP_TITLE`
3. 如果开发服务器开着：它会因为 `.env` 变化自动重启，插件随即重新生成轮廓，页面自动更新，终端会打印"已按……重新生成标题轮廓"
4. 如果没开开发服务器：在 `apps/web` 下运行 `pnpm title:generate`，或者直接 `pnpm build`（构建开始时也会检查）
5. 提交 `.env` 和 `src/shared/system-title/system-title-outline.json`

`VITE_APP_TITLE` 同时用于 `index.html` 的标题、页面标题后缀和这里的轮廓，只在 `.env` 中定义一次。不要在 `.env.development` 等按模式区分的文件里另写一个不同的值，否则开发时和构建时会生成不同的轮廓。

## 工作原理

```
.env 的 VITE_APP_TITLE ─────┐
                           ├─ syncTitleOutline()：文字与已生成的不同才生成
优设标题黑（local-assets）──┘          ↓ opentype.js 解析字体，把文字转成路径
                  src/shared/system-title/system-title-outline.json（提交）
                  { text, font, viewBox, path }
                                      ↓
                  SystemTitle：<svg viewBox><path d fill="currentColor"/></svg>
```

| 文件 | 作用 |
|---|---|
| `tools/system-title/outline.ts` | 核心：用 opentype.js 把文字转成 `viewBox` 和 `path` |
| `tools/system-title/sync.ts` | 比较文字，需要时生成并写入 JSON；缺少字体时不报错 |
| `tools/system-title/vite-plugin.ts` | 开发服务器启动和构建开始时调用 `sync`；测试模式下不启用 |
| `tools/system-title/cli.ts` | `pnpm title:generate` 的入口 |
| `tools/system-title/paths.ts` | 字体与输出文件的位置，插件和命令行共用 |
| `tools/system-title/opentype.d.ts` | opentype.js 2.0 没有自带类型，只声明用到的部分 |
| `src/shared/system-title/SystemTitle.test.tsx` | 检查轮廓文字与 `VITE_APP_TITLE` 一致 |

### 尺寸为什么和文字一致

生成时以字体单位作为坐标（`unitsPerEm` 为 1000），基线放在 `y = sTypoAscender`，所以 viewBox 纵向从 0 到 `sTypoAscender - sTypoDescender`，正好是字体的 em 框（850 + 150 = 1000）。SVG 设置 `height: 1em` 后，它和同字号的文字一样大。横向取"步进宽度"和"字形实际范围"的并集，避免倾斜的笔画被裁掉。

### 为什么测试模式下不启用插件

测试应该检查已提交的结果，而不是在运行测试时改动源文件。CI 中没有字体文件，本来也无法生成；如果有人改了 `VITE_APP_TITLE` 却没提交新的轮廓，`SystemTitle.test.tsx` 会失败，并提示运行 `pnpm title:generate`。

### 为什么直接导入 `opentype.js/dist/opentype.mjs`

opentype.js 的 `package.json` 没有 `exports`，只有 `main`（UMD）和 `module`（ESM）。Node 运行时按 `main` 加载 UMD，只能拿到默认导出；oxlint 按打包工具的规则取 `module`，只认具名导出。两边解析到的不是同一个文件，所以直接导入 ESM 文件，让运行时、类型和 lint 指向同一份代码。

### 工具脚本用 TypeScript 直接运行

`tools/` 下的文件由 Node 24 直接运行（类型剥离，不编译），所以：

- 相对导入要写 `.ts` 扩展名，`tsconfig.node.json` 开启了 `allowImportingTsExtensions`
- 只能用可剥离的语法（不能用 `enum`、`namespace` 等），`tsconfig.node.json` 开启了 `erasableSyntaxOnly`，写了会报错（已验证）
- 类型检查由 `tsconfig.node.json` 覆盖，`pnpm typecheck` 会检查

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 测试报"标题轮廓已过期" | 改了 `VITE_APP_TITLE` 但没有重新生成。放好字体后运行 `pnpm title:generate` 并提交 JSON |
| 开发服务器打印"找不到字体……沿用已提交的轮廓" | 本机没有 `local-assets/fonts/YouSheBiaoTiHei-2.ttf` |
| 新名称里某个字显示为空白 | 优设标题黑只收录 GB2312 范围的 6763 个汉字，生僻字没有字形 |
| 标题太大或太小 | 调整父元素的 `font-size`，不要直接给 SVG 设置宽高 |
