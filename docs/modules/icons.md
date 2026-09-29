# 图标（@yzt/icons 与 SvgIcon）

相关决策：ADR 0014
对应目录：`packages/icons/`（通用部分）、`apps/web/src/assets/icons/`（项目的图标文件）、`apps/web/src/shared/icons/`（项目的图标组件与注册表）

## 怎么用

```tsx
import { SvgIcon } from '@/shared/icons/SvgIcon';

<SvgIcon name="toolbar-map" />                          // 大小 1em，颜色跟随父元素的 color
<SvgIcon name="toolbar-map" size={20} />                // 数字按 px；也可以写字符串，如 "2em"
<SvgIcon name="toolbar-move" color="var(--color-danger)" />
<SvgIcon name="bell-solid" rotate={90} />               // 方向类图标可以复用
<SvgIcon name="toolbar-move" title="平移" />             // 有 title 时 role="img"，读屏软件会读出；没有时 aria-hidden
```

- `name` 的类型是全部图标名的联合类型，写错名字时类型检查报错
- 颜色建议通过父元素的 CSS `color` 控制，和文字保持一致；只有单个图标要特殊颜色时才传 `color`，并使用令牌
- 需要遍历全部图标时用 `iconNames`，类型是 `IconName[]`
- Element Plus 组件的图标属性（如 `prefixIcon`）继续使用 `@element-plus/icons-vue`，业务图标用 `SvgIcon`

## 怎么添加图标

1. 把 SVG 放进 `apps/web/src/assets/icons/`，文件名随意（例如设计导出的 `UserAvatar.svg`、`map_layer.svg`）
2. 开发服务器开着时会自动处理；没开时在 `apps/web` 下运行 `pnpm icons`
3. 处理结果：
   - 文件名改为短横线命名：`UserAvatar.svg` → `user-avatar.svg`，组件里写 `name="user-avatar"`
   - 内容被规范化（见下文），原地写回
   - `src/shared/icons/icons.json`（注册表）自动更新
4. 提交图标文件和 `icons.json`

需要保留原有颜色的多色图标（例如标志），文件名以 `-color` 结尾，例如 `brand-logo-color.svg`。

中文文件名无法自动转换，会报错并提示手动改名。

## 规范化做了什么

由 `packages/icons/tools/normalize.ts` 用 SVGO 完成，重复运行结果不变：

| 处理 | 原因 |
|---|---|
| 去掉 `width`、`height`，只保留 `viewBox`（缺少时由 width、height 换算） | 大小由组件的 `size` 或字号控制 |
| 单色图标的所有颜色改为 `currentColor` | 颜色跟随外部的 `color` |
| `-color` 结尾的图标保留原色 | 多色图标 |
| 删除 `<title>`、注释、元数据、编辑器信息 | 无障碍文本由组件的 `title` 提供 |
| 删除 `<script>` 和 `onclick` 等事件属性 | 组件用 `innerHTML` 渲染，必须保证内容安全 |
| `<style>` 中的样式先内联到元素上，再删除 `<style>` | 内联 SVG 中的 `<style>` 会作用于整个页面 |
| 删除 `class`、`data-*` | 样式已内联，不再需要 |
| `id` 加上图标名前缀 | 多个图标内联在同一页面时，渐变、裁剪路径的 id 不能重复 |
| 根元素的 `fill`、`stroke`、`stroke-width` 等记入注册表的 `attrs` | 描边图标依赖根元素上的 `fill="none"`、`stroke`，渲染时要还原 |

例如旧项目的 Toolbar 图标：

```
处理前：<svg ... width="24" height="24" fill="none" stroke="#303133" stroke-width="1.8" ...>
处理后：<svg ... viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ...>
```

## 自动化与检查

| 时机 | 做什么 |
|---|---|
| 开发服务器启动、图标目录有变化 | `iconsPlugin` 自动处理，出错只打印，不影响开发服务器 |
| `pnpm icons` | 手动处理（`yzt-icons` 命令，由 `@yzt/icons` 提供） |
| `pnpm build` | 构建开始时处理一次；有无法处理的文件（如中文名）时构建失败 |
| `pnpm test`（CI 也会运行） | `apps/web/tools/icons/icons.test.ts` 以检查模式运行，有未处理的文件或注册表过期时失败，并提示运行 `pnpm icons` |

测试模式下不启用插件：测试只检查已提交的结果，不在运行测试时改动源文件（与系统名称的轮廓相同）。所有输入都在仓库中，所以 CI 能完整检查。

### 同时开着多个开发服务器

每个开发服务器都会监听图标目录。阶段二实测：同时开着两个时，一个先把文件改了名，另一个再改名就会遇到"文件不存在"；最初这个异常让开发服务器直接退出。现在的处理：

- `syncIcons` 处理某个文件时发现它已经不存在（ENOENT），直接跳过：改名后的文件会触发下一次同步
- 插件在监听回调中捕获所有异常，只打印，不向外抛出
- 连续触发的事件合并成一次处理（100 毫秒防抖，`lodash-es` 的 `debounce`）

这个场景的回归测试见 `packages/icons/tools/sync-race.test.ts`：它通过 `syncIcons` 的 `fileSystem` 参数把改名替换成"文件已不存在"。这里没有用 `vi.mock('node:fs')`：实测它只替换了测试文件自己导入的 `fs`，被测模块仍然使用真实的 `fs`。

## 包的结构

```
packages/icons/
├─ src/                          浏览器端，入口 @yzt/icons
│  ├─ index.ts
│  ├─ create-icon-component.tsx  图标组件工厂
│  └─ icon.module.css            基础样式（1em、inline-block、基线对齐）
└─ tools/                        Node 端，入口 @yzt/icons/tools，不会进入浏览器产物
   ├─ index.ts
   ├─ naming.ts                  文件名 → 短横线命名
   ├─ normalize.ts               SVGO 规范化
   ├─ sync.ts                    处理整个目录、生成注册表、检查模式
   ├─ vite-plugin.ts             自动处理
   └─ cli.ts                     yzt-icons 命令
```

应用侧：

| 文件 | 作用 |
|---|---|
| `apps/web/src/assets/icons/*.svg` | 规范化后的图标文件 |
| `apps/web/src/shared/icons/icons.json` | 生成的注册表：`{ 名字: { viewBox, attrs?, body } }` |
| `apps/web/src/shared/icons/SvgIcon.ts` | `createIconComponent(icons)` 得到的项目图标组件、`IconName`、`iconNames` |
| `apps/web/tools/icons/paths.ts` | 图标目录与注册表的位置，插件和检查测试共用 |
| `apps/web/tools/icons/icons.test.ts` | CI 中的检查 |

## 设计理由

- **工厂函数**：图标数据通过参数传入，包不依赖任何具体图标，可以在其他项目复用；同时 `name` 的类型来自注册表的键
- **函数签名写法定义组件**：`defineComponent((props: IconProps<Name>) => ..., { props: [...] })`，props 的类型由参数决定，适合泛型组件，避免了 `PropType` 在泛型下的类型断言
- **内联 `<svg>` 而不是雪碧图**：不需要把所有图标注入页面 DOM，也不依赖已不维护的 `vite-plugin-svg-icons`。所有注册的图标都会打进包里（6 个样例的注册表约 4.7 KB，gzip 后约 1.6 KB），几十个图标可以接受
- **注册表是生成的 JSON**：TS 能从 JSON 推断出每个键，所以不需要生成 TS 代码，也避开了生成代码的格式和 lint 问题
- **两个入口**：`@yzt/icons` 只含浏览器代码；SVGO 等 Node 代码在 `@yzt/icons/tools`，已验证生产产物中不含 SVGO

## 样例图标

当前目录中的图标是用来跑通流程的样例：`auth-lock`、`auth-user`、`bell-solid` 来自 fzjc 项目，`toolbar-map`、`toolbar-move` 来自旧项目的 Toolbar，`sample-pin-color` 是自制的多色样例。正式的图标到位后，按需替换或删除（删除后运行 `pnpm icons` 更新注册表）。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 测试报"图标尚未处理" | 放了新图标但没有处理，或注册表过期。运行 `pnpm icons` 后提交 |
| 构建失败，提示文件名无法转换 | 文件名含中文或特殊字符，手动改成英文 |
| 图标显示为纯色块 | 本该保留原色的多色图标没有加 `-color` 后缀，颜色被改成了 `currentColor` |
| 描边图标变成了实心 | 原文件的描边属性写在子元素上且依赖根元素的 `fill="none"`，检查注册表里的 `attrs` |
| 新加的 `bin` 命令不存在 | 在已安装的依赖上新增 `bin` 后，`pnpm install` 不会重新链接，见 `docs/config/internal-packages.md` |
