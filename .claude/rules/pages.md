---
paths:
  - "apps/yzt/src/app/**"
  - "apps/yzt/src/pages/**"
  - "apps/yzt/src/shared/router/**"
  - "apps/yzt/src/shared/auth/**"
  - "apps/yzt/src/shared/perf/**"
  - "apps/yzt/src/features/auth/**"
---

# 路由、页面与会话

## 路由与导航

- Vue Router 5，手写路由表，history 模式，不启用文件路由（ADR 0007）
- 路由表在 `app/router/routes.ts`；路由名常量在 `shared/router/route-names.ts`，跳转写 `{ name: RouteName.xxx }`，不写路径字符串；页面级参数用路由的 `props` 传入，不放在 `meta` 里
- 程序式跳转用 `shared/router/navigate`，返回 true 后才执行成功提示等后续动作；导航异常由 app 统一提示与恢复，调用方不重复提示（ADR 0064）
- 页面权限写在路由 meta 上：不登录也能访问的页面加 `public: true`，限定角色写 `roles`；不另外维护路径清单。`routes.test.ts` 列出了全部公开页面和限定角色的页面，修改时同步更新（ADR 0015）
- 顶部导航配置在 `app/layout/menus.ts`，导航项的权限从路由 meta 读取，不在菜单里另写角色；新增业务页时先加路由再加导航项
- `pages/dev/<名称>/`：开发页面（主题预览 `/dev/theme`、地图开发页 `/dev/map`、资源图层实测 `/dev/resources`、三维的交互原型 `/dev/map-3d`、导航网格实测与步行地图预览 `/dev/nav-grid`），和业务页面分开放。组件名 `Dev<名称>Page`，路由名 `dev<名称>`（值为 `dev-<名称>`），路径 `/dev/<名称>`；只注册在 `app/router/routes.ts` 的 `devRoutes` 里，生产构建不包含；业务代码不导入开发页面。`routes.test.ts` 检查路径与路由名是否对应

## 页面缓存与加载

- 切走时要保留状态的页面在路由 meta 写 `keepAlive: true`，由 `AppLayout` 里常驻的 `KeepAlive` 缓存，布局卸载（回到登录页）时清空；环境变量 `VITE_PAGE_STATE_RESET=true` 时不缓存、每次进入都是初始状态（`.env` 提交的是 true，ADR 0114、0138），它只管页面缓存，不影响偏好（ADR 0140）；`routes.test.ts` 列出缓存的页面（ADR 0063）。被缓存的页面里量尺寸用 `shared/composables` 的 `useShownElementSize`，不直接用 `useElementSize`（停用期间量到 0，恢复的第一帧会按 0 排版）；停用时要结束的临时交互用 `usePageActive`。画布型页面的根元素用 `height: 100%`：内容区不是弹性容器，`flex: 1` 不生效，浮层全是绝对定位时整页高度为 0（见 `docs/design/page-layout.md`）
- 加载耗时用 `shared/perf` 的 `LoadTrace` 标记（User Timing，留在产物里、不上报），登录到地图的步骤清单和实测脚本的 `STEPS` 由测试保证一致；改加载方式（预加载、拆分块、换框架）前后用 `measure:map-load` 实测，几种做法用 `--builds` 交替比较，模拟第一次访问用新的浏览器上下文、不禁用缓存（ADR 0061，见 `docs/modules/perf.md`）

## 会话

- 登录密码用 sm-crypto-v2 做 SM2 加密，公钥放在 `.env`；token 过期判断用 jwt-decode；会话存 localStorage（ADR 0015）
- 登录会话只通过 `shared/auth` 的 `useSessionStore` 读写，不直接读写 localStorage 中的 token
- 结束会话（退出、过期、其他标签页退出）统一调用 `app/session-end.ts` 的 `endSession()`（同时清空查询缓存），不要只调用 `session.clear()`；跳转和提示由调用方负责，见 `docs/modules/auth.md`
