# 阶段五之后的代码审查与整改

- 审查日期：2026-10-23
- 范围：`stage-5e..56d3dbb`（54 个提交）：现状底图的界面优化、导航失败恢复与产物检查、公共文件传输、文件管理的上传下载预览、资源管理、城市体检驾驶舱，以及对应的开发样例、工具脚本和文档
- 基准：`stage-5e` 之前的代码（写法、注释、分层）和 AGENTS.md 的规则
- 结论：**功能和测试覆盖是扎实的，差距主要在写法和几处过度防御**。发现 1 个会让界面没有反应的行为问题、5 处设计上的不一致或重复、3 类规范问题，已全部修复；另有 4 件事需要你决定（第四部分）。本次改动还没有提交

## 一、和 stage-5e 的差距在哪里

先用几个能数出来的写法对比（`git grep`，不含 `node_modules`）：

| 写法 | `stage-5e` | 审查前（`56d3dbb`） |
|---|---|---|
| 一行里的多语句函数体、单行 `if` 块（`if (x) { return; }`） | 0 | 163 |
| 单行的 SCSS 规则（`.a { flex: none; }`） | 0 | 84 |
| 省略整数位的小数（`.85`） | 0 | 29 |

集中在资源管理、文件管理的上传下载预览、两个开发样例页和驾驶舱的实测脚本；现状底图这批界面改动和驾驶舱的业务代码基本保持了原来的写法（驾驶舱在合入前已按规范整理过一次）。

数字之外，读下来的差别主要是三点：

1. **压缩**：几条语句、几个属性挤在一行，多行 JSX 不用 `return (`，条件渲染不加括号，长串三元；同样的逻辑要逐字拆开才能看懂
2. **过度防御**：同一个条件在组合式函数、mutation、组件里各查一遍（角色、会话、是否过期），其中"过期"的检查反而造成了问题（第二部分第 1 条）
3. **注释只说"做了什么"**：阶段五的注释说明为什么（"不直接用 keepPreviousData：换分类时会短暂显示上一个分类的文件"），之后的很多注释是压缩过的结论（"晚到结果有会话保护"），读的人仍不知道在防什么

## 二、发现的问题与处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| 1 | 中 | 登录过期后下载、预览、启停、导入没有任何反应；上传收到成功后停在"正在处理" | 已修复 |
| 2 | 低 | 资源详情的 schema 带着旧代码猜的字段 `submitUnit` | 已修复 |
| 3 | 一致性 | 写操作的会话核对有两套写法，重复 6 处 | 抽出 `useSessionGuard` |
| 4 | 一致性 | 文件读取借用查询缓存来接收会话结束的取消 | 删除，和点选一样直接调用接口函数 |
| 5 | 一致性 | 组合式函数里重复判断管理员角色 | 删除 |
| 6 | 重复 | `/dev/file-management` 复制了一套下载区和预览弹窗 | 改为驱动正式组件 |
| 7 | 分层 | 资源管理页面里写着业务对话框 | 移到 feature |
| 8 | 规范 | 压缩写法（第一部分的三类） | 全部展开（生产冒烟的业务用例除外，见第四部分） |
| 9 | 规范 | 写死的颜色、阴影、行高，`--el-*` 当颜色用 | 改用令牌 |
| 10 | 文档 | AGENTS.md 混进了大量具体组件的界面尺寸 | 移到 `docs/design/current-map-reference.md` |

### 1. 登录过期后操作没有反应（中，已复现）

- **位置**：`useFileDownloads`、`useFilePreview`、`useResourceStatus`、`useResourceImport`、`useResourceDetail`、`useDirectoryEditor`、`useFileUpload`
- **原因**：这些组合式函数在发请求前判断 `session.isActive()`，过期就直接 `return`；收到结果后也把"过期"当成"换了会话"，丢弃结果
- **后果**：
  - token 过期后点下载、启停、导入，什么都不发生，也没有提示。按 [auth.md](../modules/auth.md) 的设计，过期应该由 `shared/http` 在发请求前发现，提示"登录状态已过期"并回到登录页，组合式函数的预先判断把这条路堵住了
  - 上传过程中 token 过期：服务端已经接受了这一批，返回成功，但界面不认这个结果，`phase` 一直停在 `processing`，按钮显示"上传中"，直到换会话
  - 下载过程中过期：文件已经收完，却被丢弃，任务列表也被清空
- **修法**：组合式函数只比较"提交时的会话还是不是同一个"（第 3 条），过期交给 `shared/http`。已经发出的请求照常完成，下一个请求触发统一的过期处理
- **测试**：补了"过期后再下载 / 预览时交给 `shared/http` 结束会话，界面随之清空"和"发送期间只是过期，照常报告成功并刷新列表"。改坏验证：把 `isActive()` 预检查加回去，新用例因 `onUnauthorized` 没被调用而断言失败

### 2. 详情 schema 里的猜测字段（低，已核对真实接口）

`resourceDetailSchema` 同时声明了 `submit_unit` 和 `submitUnit`，界面上写 `data.submit_unit || data.submitUnit`。2026-10-22 对两个资源只读请求 `/resource-management/layer/struct`，返回里只有 `submit_unit`；`submitUnit` 是旧页面 `LayerDetailPanel.vue` 读的字段，旧页面的"数据来源"其实一直是空的。按 AGENTS.md"不照搬旧代码为假设情况写的兜底"，删掉 `submitUnit`。同一次请求确认了 `datasets`、`datasetName` 确实存在。

### 3. 两套会话核对（一致性）

AGENTS.md 要求服务端写操作在 `mutationFn` 发请求前、响应后核对会话。文件管理比较会话对象（`session.session`），资源管理比较 token，6 个 mutation 和 8 个组合式函数各写一遍样板。新增 `shared/auth/session-guard.ts`：

```ts
const sessionGuard = useSessionGuard();
const token = sessionGuard.capture();        // 提交时
sessionGuard.assertCurrent(token);           // mutationFn 发请求前，会话已变时以 canceled 结束
sessionGuard.isCurrent(token);               // 响应后
```

比较 token：和阶段三 `useFileRemoval` 一致，退出、换账号、其他标签页重新登录都会换掉它。几条旧测试用"同一个 token 换了用户"模拟换会话，这在真实环境里不会出现，改成换一个 token。

### 4. 借用查询缓存做取消登记（一致性）

`useFileContentRequest` 为每次下载、预览在查询缓存里登记一个随机 key 的一次性查询（`gcTime: 0`，结束后删除），目的是让 `endSession()` 清空缓存时顺带取消。但两个组合式函数本来就侦听会话变化并中止读取，这层登记是重复的；为了生成 key 还踩过普通 HTTP 内网没有 `crypto.randomUUID` 的坑。改为和现状底图的点选（`queryFeaturesAt`）一样，组合式函数直接调用接口函数，取消由各自的 `AbortController` / `LatestController` 负责。

### 5. 重复的角色判断（一致性）

资源管理的组合式函数在打开弹窗、开始编辑、保存、启停、导入前都判断 `role === admin`。页面已由路由 meta 限定为管理员；其他标签页换了账号时整页重新加载（`app/session-sync.ts`），页面挂载期间角色不会变。删掉这些判断，对应的测试用例一并删除。

### 6. 开发样例复制了正式组件（重复）

`/dev/file-management` 的 `TransferPreview.tsx`（217 行）和 `transfer-preview.module.scss`（195 行）是下载区和预览弹窗的第二份实现，阶段名（`cancelled`）、文案和样式已经和正式组件不同步；验收记录里也出现过样例用旧的图片白名单的问题。模块文档本来写的是"原型复用正式组件，仅模拟请求结果"。

改为和 `/dev/map-ui` 一样：样例页直接使用正式的 `FileUploadDialog`、`FileDownloadPanel`、`FilePreviewDialog`，只把请求换成演示模型（接口和 `useFileDownloads`、`useFilePreview` 相同，用类型标注保证）；预览用 `features/file-management/fixtures/` 里的自建文件，DOCX 由 docx-preview 真实渲染。浏览器里实测了六种下载状态、DOCX / PDF / 图片 / TXT 预览、缩放和关闭。

### 7. 页面里的业务对话框（分层）

"放弃未保存的修改"的 `ElDialog` 写在 `ResourceManagementPage` 里。按"pages 只负责组合 features"，移到 `features/resource-management/components/DiscardChangesDialog.tsx`，样式随之移到 feature。

### 8. 压缩写法（规范）

按第一部分的三类全部展开，并顺带：多行 JSX 改为 `return (`；大的渲染函数拆成 `renderXxx()`（`ResourceDetailPanel`、`ResourceDirectoryPanel`、`FilePreviewDialog`、`FileUploadDialog`、`FileDownloadPanel`）；长串三元改成提前返回或查表；非空断言改成显式判断；驾驶舱入场时间线里的 `timeline!`、`shell.value!` 改为局部变量。驾驶舱的两个实测脚本（`tools/measure-city-dashboard/`，最长一行 221 字符）按 `measure-map-load` 的写法拆成函数，行为不变。

这一条写进了 [code-style.md](../code-style.md) 的"语句与块"，AGENTS.md 的"格式"留一句指向它。

### 9. 写死的值（规范）

- DOCX 阅读区注入 iframe 的样式写死了 `#19376e14`（就是 `--shadow-sm`）、`#f4f6fa`、`#30343b` 和 16px：iframe 不继承页面的 CSS 变量，改为写入时从页面读出 `--color-bg-page`、`--color-text-primary`、`--shadow-sm`、`--space-lg` 声明到 iframe 的根上；外层宽度按实际计算出的内边距算，不再写死 32
- `--el-color-danger`、`--el-color-success` 当颜色用（文件传输、资源详情）：改为 `--color-danger`、`--color-success`，取值相同
- 现状底图 6 个样式文件的 `line-height: 18px`：改为 `--line-height-compact`，取值相同
- 上传弹窗另写了一份字节格式化：改用 `formatFileBytes`

以上取值都不变，界面没有变化。

### 10. AGENTS.md 混进界面细节（文档）

AGENTS.md 约定"必须遵守的规则写在本文件里，保持简短"。阶段五之后加入的 9 条现状底图界面细节（字号、像素间距、延时毫秒数等）和一条浅灰标题栏的尺寸说明，原样移到 [current-map-reference.md](../design/current-map-reference.md)"已确认的界面细节"和已有的 [page-layout.md](../design/page-layout.md)"浅灰底面板标题栏"，AGENTS.md 各留一句指向它们。写操作的会话核对规则改为引用 `useSessionGuard`。

## 三、检查过、没有发现问题的部分

- **公共文件传输**：二进制响应的判断规则（只对 JSON、HTML 和没有明确类型的响应读开头 64 KB 找错误信封）、文件名的 `filename*` 解析与清理、object URL 的释放时机都合理；只去掉了 `request()` 里两处重复的中止判断，进度回调的异常改为就地捕获，不再借用错误报告器
- **导航失败恢复**：旧导航晚到的错误不覆盖新导航，重试重新经过守卫；`navigate()` 的返回值约定被各处正确使用
- **现状底图的界面优化**：拥有者模式保持（状态在组合式函数、排法在纯函数 `panelStackLayout`），Tooltip 参数集中在 `shared/map/tooltip.ts`；只改了一处一行函数体
- **驾驶舱**：Three.js 场景的资源释放（`DisposableStack` 登记监听，几何和材质逐个 `dispose`，WebGL 上下文主动丢失）、`LatestController` 作废重试、入场等待在卸载时结束都正确；只做了写法整理
- **资源管理的分页**：`useResourceList` 比文件管理多出的两件事（目录会被改名删除、后端修正越界页码后用 `rememberPage` 登记）是真实接口决定的，逻辑保留，补了说明

## 四、需要你决定的事项

1. **生产冒烟里的业务用例**：ADR 0065 决定 `tools/smoke` 只做"最小流程"（登录、地图、切页、分块失败），"其他业务端到端测试仍留到阶段七"。之后加入了资源管理（774 行）、文件管理（155 行）、驾驶舱（119 行）的完整业务流程，没有新的 ADR。它们有价值，但改变了决定，也让 CI 变长。两个选择：写一份新 ADR 认可"业务页面的产物级验收放在 `tools/smoke`"并约定范围；或者把它们移到阶段七的端到端测试。决定之前这几份用例没有整理写法
2. **TXT 预览的行距**：`1.9` 是验收时确认的效果，规范的行高令牌里没有对应值。补一个阅读用的行高令牌，或改用 `--line-height-base`（22px，会比现在紧）
3. **两处阶段五写死的阴影**（不在本次范围，顺带发现）：`ResourceLayerPanel.module.scss` 的拖动手柄、`LocationOverlay.module.scss` 的位置信息卡片，各需要一个新的阴影令牌
4. **提交方式**：本次改动还在工作区，建议按模块分几个提交（公共层、文件管理、资源管理、驾驶舱与工具、开发样例、文档）

## 五、验证

| 检查 | 结果 |
|---|---|
| `pnpm typecheck`、`pnpm lint` | 通过 |
| `pnpm test` | 通过：Web 200 个文件、1851 个用例（含真实 Chromium 的浏览器测试），图标包 35 个用例。审查前为 1779 + 69 + 35；删掉的是只测已删除代码或旧语义的用例（随机查询身份、查询缓存取消、重复的角色与过期判断、复制的下载区），新增会话核对、过期处理、样例演示模型的用例 |
| `pnpm build`、`pnpm build:intranet` | 通过，产物检查通过；仍只有原有的 `crypto` 外置和大分块提示 |
| `pnpm --filter @yzt/web test:smoke` | 25 项通过（内网产物 + 本地固定接口，覆盖文件管理、资源管理、驾驶舱的正式页面） |
| 改坏验证 | 把 `isActive()` 预检查加回下载，新的过期用例因 `onUnauthorized` 没被调用而断言失败；恢复后通过 |
| 浏览器实查 | 复用用户已启动的 5174 开发服务：`/dev/file-management` 的六种下载状态、DOCX / PDF / 图片 / TXT 预览（DOCX 真实渲染、iframe 里的令牌和 16px 内边距）、缩放和关闭；`/dev/theme` 浅灰标题弹窗的计算样式（标题底色、48 × 48 关闭按钮、内边距）与展开前一致；`/dev/map-ui` 无控制台错误 |

没有验证的：正式的文件管理、资源管理页面没有在浏览器里手工操作（本机浏览器没有登录会话，没有用真实账号登录），由生产冒烟的本地固定接口覆盖；真实后端的写操作仍按各模块文档的待办联调。浏览器面板当时处于隐藏状态，截图没有渲染出来，样式以计算值核对。
