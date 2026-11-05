# 0140. 偏好的开关：一个总开关加每项一个分项开关

- 状态：已接受
- 日期：2026-11-04
- 修改：ADR 0114 中"`pageStateReset` 为 `true` 时底图的拥有者不接偏好"的做法，ADR 0138 后果中"底图的选择不读不写偏好"的原因；补充 ADR 0042

## 背景

迁移基本完成，用户 2026-11-04 提出 IndexedDB 里的偏好要能由 `.env` 控制。现状：

- 只有一个库 `yzt-preferences`，5 项偏好（`basemap`、`boundaries`、`resource-layers`、`resource-symbols`、`resource-panel`）都走 `shared/storage/use-preference.ts` 这一个入口，都由现状底图页接入
- 底图偏好和离开页面后重置绑在一起：`CurrentMapPage` 里写 `appConfig.pageStateReset ? null : preferences`（ADR 0114）。一个开关管了页面缓存和底图偏好两件事，不能单独调整

读代码时发现，拥有者不全是"读不到就用默认值"：`useResourceLayers` 要等 `restore` 回调把 `restored` 设为 true 才合并目录（ADR 0042 第 5 节）。如果开关关闭时入口直接返回，资源列表会一直是空的。

## 候选方案

| 问题 | 候选 | 选择与理由 |
|---|---|---|
| 开关的粒度 | 只有总开关；总开关加每项一个分项开关；按页面 | 总开关加分项开关：排查时可以整体关掉，也可以只关一项；偏好都在一个页面，按页面分没有意义 |
| 判断放在哪里 | 每个拥有者自己判断；页面传 `null`；唯一入口按 `name` 判断 | 入口：拥有者不改，新增偏好也不会漏判断 |
| 关闭时的表现 | 直接返回；按"没有存过"结束恢复；同时删除旧数据 | 按"没有存过"：调用一次 `restore(null)`，不等待、不侦听。不删除旧数据：重新打开后还能恢复，开关只决定读不读写不写 |
| `name` 的类型 | `string`，没登记的默认打开；另写一份联合类型；从开关表推导 | 从开关表推导（`keyof typeof appConfig.preferences`）：清单只有一份，没登记开关的名称通不过类型检查 |
| 底图偏好和离开页面后重置 | 继续绑定；拆开 | 拆开：`VITE_PAGE_STATE_RESET` 只管页面缓存，底图偏好由 `VITE_PREFERENCE_BASEMAP` 决定 |
| 总开关关闭时校验分项开关吗 | 短路，不校验；照样校验 | 照样校验：拼错的值不等到打开总开关时才报错 |
| 内网 | `.env.intranet` 单独写；继承 | 继承：用户没有提出要区分 |

## 决定

- `apps/web/.env` 新增 6 个变量，每个都只接受 `true`、`false`：

| 变量 | 值 | 对应的偏好 |
|---|---|---|
| `VITE_PREFERENCES_ENABLED` | `true` | 总开关 |
| `VITE_PREFERENCE_BASEMAP` | `false` | `basemap` |
| `VITE_PREFERENCE_BOUNDARIES` | `true` | `boundaries` |
| `VITE_PREFERENCE_RESOURCE_LAYERS` | `true` | `resource-layers` |
| `VITE_PREFERENCE_RESOURCE_SYMBOLS` | `true` | `resource-symbols` |
| `VITE_PREFERENCE_RESOURCE_PANEL` | `true` | `resource-panel` |

- `appConfig.preferences` 按名称给出每一项的生效值（总开关和分项开关都为 `true` 才生效），其他代码只读它；`PreferenceName` 是它的键
- `usePreference` 在作用域、范围已结束的判断之后看开关：关闭时调用一次 `restore(null)`（抛错同样交给 `onError`），然后返回，不碰存储、不侦听状态、不登记页面事件
- 拥有者不改，也不另外判断开关；`CurrentMapPage` 把范围直接交给 `useBasemap`
- `vite.config.ts` 的 `test.env` 把这些开关都固定成 `true`，用例不依赖 `.env` 的取值；测试开关的用例用 `vi.stubEnv` 覆盖后重新导入。生产冒烟用 `loadEnv` 读构建用的取值，验证这次构建对应的行为

## 后果

- 线上行为不变：`.env` 写 `VITE_PREFERENCE_BASEMAP=false`，现状底图每次进入都是默认底图，其余偏好照常恢复；刷新页面也一样
- 把 `VITE_PAGE_STATE_RESET` 设成 `false` 的构建有变化：以前底图偏好跟着打开，现在还要设 `VITE_PREFERENCE_BASEMAP=true`
- 开关是构建时写进产物的，改了要重新构建
- 关闭期间的修改不保存；重新打开后恢复的是关闭之前存的值
- 新增偏好时要同时加变量、声明类型、登记到 `preferenceSwitches`、固定到 `test.env`，比以前多几步；漏登记时类型检查报错，漏写变量时启动就报错
- 测试：`app-config.test.ts` 覆盖生效值的合并和校验；`use-preference.test.ts` 逐项覆盖分项开关和总开关，关闭时走遍会读写的时机，确认对存储没有任何访问；`CurrentMapPage.test.tsx` 覆盖底图、总开关、资源图层（目录照常合并）和离开页面后重置互不影响；`application.spec.ts` 在生产构建上用真实的 IndexedDB 验证底图偏好
