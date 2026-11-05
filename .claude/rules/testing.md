---
paths:
  - "**/*.test.{ts,tsx}"
  - "apps/web/tools/smoke/**"
  - "apps/web/src/test-setup.ts"
  - "apps/web/src/shared/testing/**"
---

# 测试

- 测试用 Vitest 5 + jsdom + `@vue/test-utils`，配置写在 `vite.config.ts` 的 `test` 字段（ADR 0010）；依赖真实引擎或布局的测试用 Vitest 浏览器模式（Playwright 驱动的 Chromium 无界面版，ADR 0040）
- 测试文件和源文件放在一起，命名 `*.test.ts` / `*.test.tsx`；显式从 `vitest` 导入 `describe`、`it`、`expect`，不开 `globals`
- 生产产物冒烟在 `tools/smoke/*.spec.ts`，用已有的 `playwright/test` 独立运行；先做内网构建，只用本地固定接口，不访问后端或天地图，不导入应用源码（ADR 0065）
- 浏览器测试命名 `*.browser.test.{ts,tsx}`（ADR 0040）：只写依赖真实引擎或真实布局的行为，能用假对象测的仍写普通测试；只用本地数据，不请求后端和天地图；`whenReady()` 只表示整体加载完成，验证画面要等渲染条件（如 `idle` 之后查到目标要素）；要等的事件在触发操作前登记，可能挂起的等待和超时赛跑，结束后清理监听和定时器；只持续几秒的过渡状态不轮询（慢的机器上会错过），在写进 DOM 的同一轮微任务里接住（写法见 `DashboardEntrance.browser.test.tsx` 的 `whenEntered`）；每个用例自己创建容器、会话和视图，结束时释放并移除容器（同一文件的用例共用一个页面）
- 不用 DOM 的测试文件（纯逻辑、libs 的会话与 Worker 通信层、`tools/` 脚本）第一行写 `// @vitest-environment node`：默认的 jsdom 每个文件要多花约 1 秒创建（见 `docs/config/vite-config.md` 的"测试耗时"）
- 工具函数、鉴权、HTTP 错误处理这类纯逻辑要写测试；页面和组件测试关键交互
- pages、features 的测试用 `createMemoryHistory()` 建只含所需路由的最小路由，不导入 `app` 的路由表（测试文件同样受依赖方向约束）；`app` 自己的测试可以用真实路由表，例如检查导航与路由权限是否一致
- 模拟环境变量用 `vi.stubEnv`，用例结束后会自动撤销（`unstubEnvs`）；部署时决定的开关，用例不依赖 `.env` 的取值：单元测试自己固定（模块加载时就读取的，放进 `vi.hoisted`；很多用例依赖默认行为的，固定在 `vite.config.ts` 的 `test.env`），生产冒烟用 `loadEnv` 读构建用的取值，验证对应的行为
- 模拟接口用 MSW 的 `setupServer()`，并设置 `onUnhandledRequest: 'error'`；不用 `vi.mock('axios')`；依赖第三方类的代码（如 MapLibre 适配器）依赖自己定义的窄接口，测试注入实现它的假对象，并用 `expectTypeOf` 检查真实的类满足它，不用 `vi.mock` 整个库
- 修 bug 和关键逻辑的测试写完后，故意改坏被测代码，确认测试会失败，并确认失败原因是断言而不是代码报错或超时（可能一直挂起的等待要和必然更晚结束的等待赛跑：只经过微任务的用 `setTimeout(0)`，经过消息往返的按轮数推进事件循环，不用固定时长，见 `docs/modules/utils.md` 的测试）；修 bug 时先写能复现问题的测试
- `vite.config.ts` 的 `test.server.deps.inline: ['element-plus']` 不能删：不加的话 Element 表单的校验在测试中永远通过（见 `docs/config/vite-config.md`）
- 不提交 `.only`：lint 的 `vitest/no-focused-tests` 会报错，CI 中 Vitest 也会拒绝运行
- `mount` 挂载的组件在每个用例结束后由 `src/test-setup.ts` 自动卸载（`enableAutoUnmount`），不用逐个 `unmount()`；Element 放在 `body` 下的弹出层不归组件管，挂到 `body` 的测试仍要在 `afterEach` 里清空它
