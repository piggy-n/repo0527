# main 分支的第二次全面审查与整改

- 审查日期：2026-10-26
- 范围：整个 `main`（`5b4feaf`），不限于 `stage-5e` 之后的改动：`apps/web` 的 `src`、`tools`、配置，`packages/*`，以及 README、AGENTS.md 和 docs 中受影响的说明
- 基准：`stage-5e` 之前的代码、[上一次审查](post-5e-code-review.md)（`5b4feaf`）的整改标准和 AGENTS.md
- 结论：**架构、分层和异步语义没有发现问题，差距仍在写法和少量冗余**。发现 1 个用户能看到的显示错误（传输进度带小数）、1 处空值显示和表格不一致、5 处死代码或重复实现，以及上次整改没有覆盖到的几类写法；已全部修复并补测试。生产冒烟里的业务用例仍按上次的待决事项保留原样（第四部分）。本次改动还没有提交

## 一、写法指标

和上次一样，先看能数出来的写法。统计方法：扫描 `apps/web/src`、`apps/web/tools`、`packages` 里的 `.ts`、`.tsx`、`.scss`，跳过注释行；生产冒烟 `tools/smoke` 单独计。格式为"生产代码 / 测试"。

| 写法 | `stage-5e` | 审查前（`5b4feaf`） | 整改后 |
|---|---|---|---|
| 多行开始标签的 `>`、`/>` 没有单独占一行 | 55 / 1 | 71 / 2 | 0 / 0 |
| 省略整数位的小数（`.85`） | 0 / 0 | 75 / 12 | 0 / 0 |
| 非空断言（`value!`） | 0 / 0 | 5 / 35 | 0 / 0 |
| 超过 120 列的代码行（生产代码） | 25 | 40 | 8 |

- 第一行是 [code-style.md](../code-style.md)"标签属性"的规则，`stage-5e` 时已经有 55 处不符合，这次一并改完。其余三类是 `stage-5e` 之后新出现的，集中在驾驶舱（合入时的样式和图表配置）和资源管理的测试
- 剩下 8 行超长都是工具脚本里的模板字符串（`measure-map-load` 的报告和日志、驾驶舱实测的日志）和开发页的一行文案，拆开反而不好读，保留
- 测试里的长行多是中文用例名，不改
- 生产冒烟仍有 46 处非空断言、28 行超长，见第四部分第 1 条

数字之外，读下来的差别：

1. **整改不彻底**：上次只看 `stage-5e..56d3dbb` 的改动，现状底图在 `stage-5e` 之后的界面调整（面板组、底图 Popover、边界设置）和驾驶舱的大部分文件没有逐行过，留下了 `watch` 的两个参数挤在一行、跨行的条件 JSX 不加括号、多层三元、魔数这些写法
2. **死代码**：ADR 0074 改了图例的浏览与编辑后，旧的分组、条目集合和视图类型没有删
3. **同一件事写几遍**：小数位数、整齐步长、MIME 解析、地类图例的筛选和名称、测试里取必需值的辅助函数

## 二、发现的问题与处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| 1 | 中 | 上传、下载、资源导入的进度显示"33.333…%" | `percent` 向下取整，补测试 |
| 2 | 低 | 资源详情的空值显示"—"，和表格全局样式的"-"不一致；属性表的空名称自己渲染占位 | 统一为"-"，空名称交给全局样式，补组件测试 |
| 3 | 死代码 | 图例的 `legendEntrySet`、`LanduseLegendView`，地类的 `STATUS_GROUPS` 等三项 | 删除，只测它们的用例一并删除 |
| 4 | 重复 | 地类图例的筛选和条目名称写了两遍，代码为空时标题多一个前导空格 | 抽出 `landuseLegendItems`、`landuseItemLabel` |
| 5 | 重复 | 驾驶舱的小数位数算法三份、整齐步长两份；地图图例的分档写在组件里 | 合成 `calculations.ts` 的三个函数和 `mapLegendLevels` |
| 6 | 重复 | MIME 解析两处，带多余的 `?.`、`??` | `shared/http/transfer` 的 `baseMimeType` |
| 7 | 过度兜底 | 文件名解析对正则的必有分组判断 `undefined` | 删除 |
| 8 | 冗余 | `DashboardCharts` 声明了没有使用方的 `select` 事件 | 删除 |
| 9 | 一致性 | 目录名称的最大长度 20 在校验和输入框各写一次 | `DIRECTORY_NAME_MAX_LENGTH` |
| 10 | 可读性 | `panelStackLayout` 的 48、12、500、0.4 没有名字，返回值没有类型 | 命名常量，导出 `PanelStackLayout` |
| 11 | 规范 | 第一部分的四类写法及其他压缩写法 | 全部展开 |
| 12 | 重复（测试） | 5 个测试文件各自定义取必需值的函数，另有 1 处漏掉的非空断言 | `shared/testing/required` |
| 13 | 环境 | 新电脑缺 Visual C++ 运行库时 `pnpm lint` 报 `Cannot find native binding` | README 补环境要求和排查 |
| 14 | 文档 | 迁移参考路径改为 `C:\work\zhjsqdxin` | AGENTS.md、migration.md、page-layout.md |

### 1. 传输进度带小数（中，已复现）

- **位置**：`shared/http/transfer.ts` 的 `progressReporter`
- **原因**：`percent` 是 `event.loaded / total * 100`，没有取整。上传弹窗、下载区和资源导入都直接显示它，传了三分之一时就是"正在上传 33.33333333333333%"。原来的测试只用了能整除的数据（50、100），所以没发现
- **修法**：`Math.min(100, Math.floor(...))`。用向下取整，不用四舍五入：各处按 `percent === 100` 进入"处理中"，四舍五入会在差一点没传完时提前显示 100% 并切换状态
- **测试**：1/3、2/3、2999/3000、3000/3000 得到 `[33, 66, 99, 100]`；第三项专门防止改成四舍五入。改坏验证：去掉 `Math.floor` 后断言失败（收到 `33.33…`）
- 文档：[file-transfer.md](../modules/file-transfer.md) 写明 `percent` 是向下取整的整数

### 2. 资源详情的空值（低）

AGENTS.md 规定表格的空值由全局样式显示 `-`。资源详情的元数据和分类在空值时写"—"（另一个字符），属性表的字段名称为空时渲染一个空的 `span`，单元格不为空，全局样式就不生效。改为：

- 元数据和分类的空值用 `EMPTY_VALUE = '-'`
- 查看时名称为空就不渲染内容，单元格为空，由全局样式显示 `-`；编辑时仍是输入框

新增 `ResourceDetailPanel.test.tsx`，用 MSW 返回 `submit_unit: null` 和一个没有名称的字段，检查"数据来源"显示 `-`、空名称的单元格没有子元素、编辑时输入框为空。改坏验证：把 `EMPTY_VALUE` 改回"—"、空名称改回渲染 `span`，两条断言分别失败。

### 3～5. 死代码和重复（图例、驾驶舱）

- **图例**：`legendEntrySet` 和 `LanduseLegendView` 在 ADR 0074 之后没有使用方；`landuse.ts` 的 `STATUS_GROUPS`、`STATUS_GROUP_OVERRIDES`、`LANDUSE_STATUS_GROUPS` 也是。`LanduseLegend`（浏览）和 `ResourceLegend`（编辑）各写了一遍按关键字筛选地类、拼"代码 名称"的逻辑，代码为空的条目标题多了一个前导空格。改为 `legend.ts` 导出 `landuseLegendItems(keyword)`（按分类名或条目的代码、名称匹配）和 `landuseItemLabel`，两个组件共用
- **驾驶舱**：坐标轴（`axis-scale.ts`）、地图分档（`map-classification.ts`）、图例（`DashboardMap.tsx`）各写了一份"去掉浮点尾差""数小数位数"，前两处还各有一份整齐步长。合成 `calculations.ts` 的 `trimFloat`、`niceStep`、`decimalPlaces`；图例的分档文字移到 `map/config.ts` 的纯函数 `mapLegendLevels`，顺带去掉两处 `displayMax!`
- **安全性**：驾驶舱这批是纯重构。改动前后用同一份临时脚本导出全部纯计算的结果（坐标轴、分档、图例、各种图表配置、详情标签、标签避让、模拟数据、翻卡停靠点）逐项比较，除了颜色字符串里 `.92` 写成 `0.92`，结果完全一致；`mapLegendLevels` 和原组件里的算法逐条一致。新增 `map/config.test.ts` 和 `calculations.test.ts` 的"数值工具"，改坏验证：小数位数忽略科学计数法的指数、图例不反转，各自断言失败

### 6、7. MIME 解析与文件名

`shared/http/client.ts` 判断二进制响应、`shared/file-transfer` 下载后补类型，各写了一遍 `split(';')[0]?.trim().toLowerCase()`。`split` 的第一项总是存在，`?.` 和外面的 `??` 都多余。抽成 `baseMimeType`，补测试（参数、空白、大小写、空字符串）。

`file-name.ts` 里对 `/(filename\*?)=(...)/` 的两个必有分组判断 `undefined`，对 `/^utf-8'[^']*'(.*)$/` 的结果判断 `match?.[1] !== undefined`：匹配成功时这些分组一定有值，改为只判断有没有匹配。

### 11. 写法

- 第一部分的四类：多行开始标签的 `>` 另起一行（73 处）；小数补整数位（87 处）；非空断言改成显式判断（生产代码 5 处、测试 35 处）；超长的代码行按"换行原则"拆开
- `watch(() => x, value => {...})` 两个参数挤在一行的，一旦换行就每个参数独占一行（6 处）
- 跨行的条件 JSX 加括号（`MapPanelGroup`）；多层三元改成具名的小函数或提前返回（`ResourceLegend` 的 `renderBody`、驾驶舱的 `axisValues`、`focusStyle`、`renderDetail` 等）
- 测试里 `mount(defineComponent({ setup() {...} }), options)` 压在一起的 7 处改成 `mount(defineComponent(() => ...), options)` 并按参数换行；挤在一行的测试数据对象展开
- `CurrentMapPage` 的导入顺序；`useLayerOpacityPopup` 的监听目标改成 `open ? window : null`；`style-model.ts` 类末尾多余的空行
- 中文注释句末的句号：这次扫描以为有 21 处，核对后都是注释中间的句子分隔，不是结尾，`stage-5e` 时也是这样，没有改

### 12. 测试里取必需值

测试依赖的元素、作用域里的返回值可能为空时，原来写 `value!`，失败时报的是"Cannot read properties of undefined"，看不出缺的是什么。上次整改后有 5 个测试文件各自定义了同样的 `required`，这次又发现 1 处漏掉的非空断言。收到 `shared/testing/required.ts`（和 `shared/auth/testing.ts` 一样只供测试使用）：

```ts
import { required } from '@/shared/testing/required';

const button = required(status.element.parentElement?.querySelector('button'), '操作按钮');
required(tree.value[0].children?.[1], '水资源目录').name = '水资源新名';
```

只用一次、写成 `if (!owner) { throw new Error('详情的拥有者没有创建'); }` 更清楚时也可以直接写。AGENTS.md 的"不用非空断言"指向这里。

## 三、检查过、没有发现问题的部分

- **libs**：map-core 的会话、样式模型、工具模型、相机操作，map-vue 的衔接，utils 的 Worker 通信层和 `LatestController`，ui 的布局组件：分层、释放（`DisposableStack`）、取消语义与 ADR 一致；只有一处空行
- **shared**：鉴权与会话核对（`useSessionGuard`）、HTTP 错误分类、存储的恢复与校验、导航失败恢复、`useDelayedFlag`、`useSortableList`、`useShownElementSize`：逻辑正确，边界（并发、卸载、晚到结果）都有测试
- **现状底图**：点选、框选、区划裁剪、图层与年份、符号编辑、面板组与面板栈：拥有者模式保持一致，异步按 ADR 0039 分类；只改写法
- **文件管理、资源管理**：上次整改后的会话核对、确认框、行内操作状态、分页修正都符合 AGENTS.md；只改了第 2、9 条和测试写法
- **驾驶舱**：Three.js 资源释放、WebGL 降级、入场编排、图片导出的卸载取消都正确；只做第 5、8 条和写法
- **安全**：没有 `v-html`，也没有用 `innerHTML` 一类写入 HTML；DOCX 预览渲染在 `sandbox="allow-same-origin"` 的 iframe 里（不能执行脚本）；下载文件名只取路径的最后一段，去掉控制字符和 Windows 不允许的字符；token 只经 `useSessionStore` 读写；`VITE_` 变量里没有密钥，内网构建的产物检查确认不含天地图 key

## 四、需要你决定的事项

1. **生产冒烟里的业务用例**（上次的第 1 条，仍未决定）：资源管理、文件管理、驾驶舱的用例还是压缩写法，有 46 处非空断言。按上次的约定，决定前不整理；这次只改了 `application.spec.ts`（ADR 0065 范围内）的一处
2. **驾驶舱的单数字号**：样式里有 17、15、11px 四处，ECharts 的数值标签和二维降级地图的标签是 15 号。规范要求双数，但改了会让已经验收的大屏视觉变化
3. **TXT 预览的行距和两处阴影**（上次的第 2、3 条，仍未决定）：`line-height: 1.9` 没有对应令牌；资源面板的拖动手柄、位置信息卡片写死了阴影
4. **用 lint 禁止非空断言**：现在生产代码和单元测试都是 0，可以打开 oxlint 的 `typescript/no-non-null-assertion` 防止回退；生产冒烟的 46 处要先按第 1 条处理，或者暂时只对 `src` 生效
5. **提交方式**：建议按模块分几个提交：公共层（http、file-transfer、testing、panel-group）、现状底图与图例、资源管理、文件管理、驾驶舱、开发页与工具、文档

以下保持不改：`MxTitle` 和 `base.scss` 里不带单位的 `line-height: 1.5`（`stage-5e` 之前就有，跟随字号的行距）；工具脚本里的长模板字符串。

## 五、验证

| 检查 | 结果 |
|---|---|
| `pnpm typecheck`、`pnpm lint` | 通过 |
| `pnpm test` | 通过：Web 202 个文件、1858 个用例（含真实 Chromium 的浏览器测试），图标包 35 个用例。审查前为 200 个文件、1851 个用例；新增资源详情面板、驾驶舱地图配置两个测试文件和进度、MIME、地类图例、数值工具的用例，删掉只测死代码的用例 |
| `pnpm build`、`pnpm build:intranet` | 通过，产物检查通过；仍只有原有的大分块提示 |
| `pnpm --filter @yzt/web test:smoke` | 25 项通过。第一次全量运行时驾驶舱的两项下载超时：当时机器同时在做另一份构建和依赖安装，入场动画超过 15 秒，标题栏在入场结束前是 `inert`，点击落到了地图上。单独重跑、8 倍 CPU 降速复现都能正常下载，`5b4feaf` 的写法相同；最后一次在机器空闲时全量运行全部通过。3D.1 验证时（2026-10-26）又出现，机器空闲时也会：点击后按钮已经进入导出中，15 秒内没有下载。`5b4feaf` 的产物同样复现（只跑 application 和驾驶舱两个文件，2 次里 1 次），不是负载或本次改动引起的；单独测导出只要 0.1～0.2 秒，原因待查 |
| 改坏验证 | 进度取整、`baseMimeType` 小写、地类按分类名匹配、`landuseItemLabel`、小数位数的指数、`mapLegendLevels` 的顺序、资源详情的 `-` 和空单元格：改坏后都是断言失败，恢复后通过 |
| 视觉回归 | `5b4feaf` 和整改后各做一次内网构建，各起一个临时预览，用同样的本地固定接口和字体截图逐像素比较：现状底图、驾驶舱、文件管理三个页面，1920 × 1080、1366 × 768、390 × 844 三个尺寸。第一轮驾驶舱有差异（卡片扫光动画和首屏字体时机），重复一轮后只有 1 个像素、色差 1，其余全部为 0。预览结束后已关闭 |

没有验证的：资源详情的 `-` 和进度百分比不在视觉回归的截图里，由组件测试覆盖；真实后端的写操作仍按各模块文档的待办联调。
