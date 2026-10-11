# 0040. 真实浏览器测试：Vitest 浏览器模式

- 状态：已接受
- 日期：2026-10-11
- 补充 ADR 0010（测试使用 Vitest 与 jsdom）

## 背景

单元测试跑在 jsdom 和 Node 里，MapLibre 用实现 `MapLike` 的假地图代替。这覆盖了适配器自己的逻辑，但有一类行为只有真实的引擎才知道：

- MapLibre 对样式的校验：哪些错误只发 `error` 不抛错、整份样式校验失败时还会不会有 `style.load`（ADR 0026 的依据，至今只在开发页手动验证过）
- 增量命令在真实地图上是否生效，`setStyle(…, { diff: false })` 的整体重建是否按预期触发事件
- 拾取、投影的精度，画布尺寸变化后的 `resize`
- jsdom 没有布局，`getBoundingClientRect` 都是 0（5B 的定位可视区域只能在浏览器里验证）

5B 之后的复盘认为测试的重点应从数量转向时序和真实浏览器（2026-10-10 讨论，选定 Vitest 浏览器模式）。阶段七的 Playwright 端到端测试（登录到地图页的完整流程）不变。

实测（2026-10-11，Playwright 1.64.0 自带的 Chromium 156 无界面版）：

- 无界面版默认就用 SwiftShader 软件渲染 WebGL2，本机有显卡、不加任何参数也是如此；加 `--use-angle=swiftshader`、`--disable-gpu` 结果相同
- maplibre-gl 6.12 在其中正常工作：GeoJSON 面加载后 171 ms 进入 `idle`，`queryRenderedFeatures` 能查到要素，读回的像素是填充色
- 以上只在 Windows 上测过，Linux 的 CI 要另外验证；Chromium 也不保证 WebGL 总能创建（软件渲染的说明见 Chromium 的 `docs/gpu/swiftshader.md`）

## 候选方案

| 问题 | 候选 | 选择 |
|---|---|---|
| 用什么跑 | Vitest 浏览器模式；Playwright Test 直接写页面测试；jsdom 加 WebGL 模拟 | Vitest 浏览器模式：同一套 Vitest、同样的 `describe` / `expect`，能直接 import 被测模块；Playwright Test 适合完整的页面流程，留给阶段七；WebGL 模拟测不到真实引擎 |
| 浏览器驱动 | Playwright；WebdriverIO；Vitest 默认的 preview | Playwright：无界面运行，CI 可用；preview 不能无界面 |
| 浏览器 | 只用 Chromium；Chromium、Firefox、WebKit | 只用 Chromium：目标用户用 Chromium 内核的浏览器，测的是引擎行为而不是浏览器兼容性 |
| 渲染 | 本机显卡；软件渲染 | 软件渲染（SwiftShader），并显式传 `--use-angle=swiftshader`：减少本机和 CI 之间渲染后端的差异。不能保证完全一致，CI 上要能看出 WebGL2 有没有创建成功 |
| 和现有测试的关系 | 同一个项目里按文件切换环境；`test.projects` 分成两个项目 | 两个项目：`unit`（现有的 jsdom、Node 测试）和 `browser`（文件名 `*.browser.test.{ts,tsx}`），配置互不影响，可以单独运行 |
| CI 里浏览器怎么来 | 每次安装；缓存浏览器目录 | 每次安装只装无界面版（`--only-shell`）：Playwright 不建议缓存浏览器，系统依赖也缓存不了 |
| 性能基准 | 放进浏览器测试；只在开发页上用真实数据测 | 只在开发页测：CI 访问不到内网的后端和真实瓦片，合成数据的耗时说明不了问题 |

## 决定

1. 引入 `@vitest/browser-playwright` 和 `playwright`：前者与 `vitest` 保持同一版本（它对 `vitest` 的依赖是精确版本），后者按自己的版本独立管理（对它的依赖是 `*`）；浏览器只装 Chromium 的无界面版
2. `vite.config.ts` 的 `test.projects` 分成两个项目：
   - `unit`：现有的配置不变，`include` 排除 `*.browser.test.*`
   - `browser`：`include` 只有 `src/**/*.browser.test.{ts,tsx}`；`browser.enabled: true`（默认是 `false`，不写的话这些用例仍在 Node / jsdom 里跑）；`browser.provider` 为 `playwright({ launchOptions: { args: ['--use-angle=swiftshader'] } })`，`headless: true`，`instances` 只有 `chromium`，视口固定
   - `browser` 项目的 `setupFiles` 调用 app 的 `setupMapRuntime()`：Worker 地址和 MapLibre 的 CSS 与生产用同一份装配
3. `pnpm test` 同时运行两个项目；另加只跑其中一个的脚本（具体命令实现时定，写进 commands.md）。第一次运行浏览器测试前要安装浏览器，命令写进 commands.md
4. CI 在 `pnpm test` 之前安装 Chromium 无界面版及其系统依赖（`playwright install --with-deps --only-shell chromium`）。浏览器项目里有一个专门的用例检查 WebGL2 能否创建，失败时给出诊断（渲染器、浏览器版本），不让后面的地图用例以难懂的方式失败
5. 什么测试写成浏览器测试：只写依赖真实引擎或真实布局的行为（MapLibre 的校验、增量更新与整体重建、拾取与投影、尺寸）。能用假对象测的仍然写在 `unit` 里，浏览器测试保持少而快
6. 浏览器测试的约定：
   - 只用本地数据（内联的 GeoJSON、本地样式），不请求后端、天地图等外部服务
   - 区分"视图就绪"和"渲染完成"：`whenReady()` 只表示这一轮整体加载完成，不保证增量提交的数据已经由 Worker 处理、画到画布上。验证画面时等对应的渲染条件（如 `idle` 之后能查到目标要素）再断言目标内容；验证失败路径时等 `failure` 出现
   - 不用固定时长：要等的事件在触发操作之前登记监听；可能一直挂起的等待和一个超时赛跑，失败落在断言上，结束后清理监听和定时器
   - 统一的创建与清理：每个用例创建自己的容器（尺寸写死）、会话和视图，结束时释放视图、会话并移除容器。同一个测试文件里的用例共用一个浏览器页面，释放地图不会移除外层的容器
   - maplibre-gl 只在 `libs/map-core/maplibre/` 里导入（lint 的限制不变）；其他层的浏览器测试通过 map-vue 的画布创建真实地图，不直接用 maplibre-gl
7. 第一批用例：
   - 环境：WebGL2 能创建，并给出渲染器信息
   - `MapLibreView`：首次加载与相机写回、增量提交后画出要素、被拒绝的命令触发整体重建、整份样式校验失败进入 `failed(style)` 后自动恢复、拾取与投影、画布尺寸变化发出 `resize`
   - map-vue：在真实布局里登记悬浮元素，不传 `padding` 的定位自动避开它（jsdom 没有布局，5A.3 起只在开发页手动验证过）

## 后果

- 好处：ADR 0026 关于 MapLibre 校验行为的假设有了自动化的验证，升级 maplibre-gl 时能发现行为变化
- 好处：以后的地图能力（资源图层、高亮、区划裁剪）可以在真实引擎上验证图层是否画出来、过滤是否生效，不再只靠开发页手动看
- 代价：多两个开发依赖；本机第一次要下载浏览器（无界面版解压后约 280 MB，Windows 上实测）；CI 每次多花安装浏览器的时间
- 代价：软件渲染比显卡慢，浏览器测试要少而精；渲染结果只用于判断"画没画出来"，不做像素级的截图比对
- 风险：Linux 上的软件渲染要等第一次 CI 运行才能确认；Chromium 以后的版本可能改变 SwiftShader 的默认行为，届时由环境用例先失败并给出诊断
- 不做：截图比对、跨浏览器测试、性能基准（性能在开发页上用真实数据测，见 5C.1b）
