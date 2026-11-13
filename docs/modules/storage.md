# shared/storage：偏好的持久化

> 状态：5C.3 完成键值存储、偏好的范围和共用的恢复与写入流程；使用方是底图（`shared/map/basemap`）、边界（`shared/map/boundary`）和资源图层（`features/resource-map`），现状底图页装配。决策见 [ADR 0042](../adr/0042-preference-persistence.md)；开关见 [ADR 0140](../adr/0140-preference-switches.md)。

需要跨刷新、跨次打开保留的偏好（勾选了哪些资源、选了哪种底图等）存在 IndexedDB。拥有者不直接调用 idb-keyval 或 localStorage，而是接收页面提供的偏好范围，用共用的流程恢复和写入；登录会话仍存 localStorage（ADR 0015）。

## 三个部分

| 文件 | 内容 |
|---|---|
| `key-value-store.ts` | 异步的键值接口 `KeyValueStore`（`get`、`set`、`delete`）；内存实现 `createMemoryStore`，给测试用，存取的也是复制品 |
| `idb-store.ts` | IndexedDB 的实现 `createIdbStore(数据库, 仓库)`，用 idb-keyval；整个应用共用的 `preferenceStore`（数据库 `yzt-preferences`、仓库 `preferences`） |
| `preference-scope.ts` | `usePreferenceScope()`：页面 setup 中按当前会话创建偏好的范围，没有登录时为 `null` |
| `use-preference.ts` | `usePreference(scope, options)`：一项偏好的恢复与写入，拥有者创建时调用 |
| `device-store.ts` | 设备级、同步的小存储 `DeviceStore`（`get`、`set`、`remove`、`keys`），见下面"设备级的同步存储"；浏览器的 `deviceStore` |

## 用法

页面装配时创建范围，交给要持久化的拥有者；开发页不传，拥有者就不读不写：

```tsx
const preferences = usePreferenceScope();
const basemap = useBasemap({ preferences });
```

拥有者只给出自己的部分，其余交给共用的流程：

```ts
if (preferences) {
  usePreference(preferences, {
    name: 'boundaries', // 键的后半段
    version: 1, // 存储格式的版本
    schema: storedBoundariesSchema, // 包括自洽的检查
    snapshot: () => state.value, // 当前状态的存储格式（普通数据）
    restore: stored => {
      // 恢复结束时调用一次；null 表示用默认值。按自己的规则合并，不直接使用
      if (stored) {
        state.value = stored;
      }
    }
  });
}
```

## 使用方

| 拥有者 | 名称 | 存什么 | 恢复 |
|---|---|---|---|
| `useBasemap` | `basemap` | 选中的底图、每种底图的透明度（版本 2，ADR 0133） | 读到后替换；选中的底图不可用（换了部署环境）时保留当前的选择 |
| `useBasemap` | `basemap-labels` | 标注是否显示（布尔，版本 1，ADR 0146） | 读到后替换；状态和上一项分开，一项恢复不会让另一项以为用户操作过 |
| `useBoundaries` | `boundaries` | 三个级别是否显示、透明度 | 读到后整体替换 |
| `useResourceLayers` | `resource-layers` | 每个资源的勾选、透明度、年份，面板顺序 | 等目录和存储都就绪，按 ADR 0041 第 3 节合并；顺序不能有重复、和设置一一对应，否则整条作废 |
| `useResourceSymbols` | `resource-symbols` | 每个资源的统一样式、样式方式（和默认方式不同、由调过的内容也推不出时才记）、分类样式各取值，都只记和默认（叠加了发布的默认符号）不同的字段（颜色已规范化），不存临时预览 | 读到后整体替换，空的部分去掉，目录里没有了的资源也保留；有一个字段越界、颜色解析不了，整条作废（ADR 0044、0154） |
| `useResourcePanelLayout` | `resource-panel` | 资源图层面板是否收起、"已选择图层"区的高度比例 | 读到后整体替换 |

## 开关（ADR 0140）

每一项偏好由 `.env` 的总开关 `VITE_PREFERENCES_ENABLED` 和自己的分项开关控制，变量见 [config/env.md](../config/env.md)；`.env` 现在只关着底图。

- **生效值**：`appConfig.preferences` 按名称给出，两个开关都为 `true` 才生效
- **判断的位置**：只在 `usePreference` 按 `name` 判断，拥有者和页面不另外判断，照常把范围传下去
- **关闭时**：调用一次 `restore(null)`，和"没有存过"一样结束恢复（`useResourceLayers` 等它才合并目录，不能直接返回）；不访问存储，不侦听状态，不登记页面事件。旧数据保留，重新打开后恢复的是关闭之前存的值
- **改了要重新构建**：`VITE_` 变量在构建时写进产物

新增一项偏好的步骤：在 `.env` 加变量，在 `shared/config/import-meta-env.ts` 声明类型，在 `app-config.ts` 的 `preferenceSwitches` 登记（名称的类型 `PreferenceName` 由它推导，没登记的名称通不过类型检查），在 `vite.config.ts` 的 `test.env` 固定，更新上面的使用方和 `env.md`。

## 发布的默认符号（ADR 0154）

有人在自己的浏览器里把图例样式调好了，要作为所有人的默认样式时，按下面三步做。别人存下的覆盖不受影响：偏好的版本和 `storedSymbolsSchema` 都不变，覆盖照样读出，叠加在新的默认上。

1. **导出**：请调好样式的人用部署的页面（同一个网站，IndexedDB 按网站隔开）登录，打开开发者工具的控制台，把 `apps/yzt/src/features/resource-map/symbol-defaults/export-snippet.js` 的全部内容粘贴进去回车（Chrome 第一次粘贴前要先输入 `allow pasting`）。控制台显示导出了哪些账号，浏览器下载 `resource-symbols-<日期>.json`。片段只读：只开只读事务；库不存在时不打开，打开时触发建库就中止，不会留下空库
2. **导入**：把文件放进 `local/symbol-defaults/`（含登录名，不提交），在仓库根目录运行 `pnpm --filter yzt symbols:import local/symbol-defaults/<文件>`，看差异；有几个账号时加 `--login <登录名>`，只要部分资源时加 `--only code1,code2`；确认后加 `--write` 写入 `apps/yzt/src/features/resource-map/resource-symbol-defaults.json`
3. **提交**：看 `git diff`，按级别 1 检查后提交，重新构建发布

注意：

- 导入的结果 = 仓库里现在的发布默认叠加这个人的覆盖，就是他在页面上看到的样子。前提是他用的部署和仓库里的默认文件一致；不一致时（比如部署落后）结果是两者的混合，先确认部署的版本
- 只有统一样式的资源不在登记表里，离线确认不了还在不在目录里，工具会列出来，对照页面上的图层核对；取值不在规则里的、没登记分类的资源带了取值或样式方式的，工具跳过并说明
- 发布后，用户没改过的字段、没选过的样式方式跟着新的默认变；"恢复默认"恢复到新的默认；"已自定义"和"全部恢复默认"只看用户自己的覆盖。调好样式的人自己的覆盖还留着，和新默认相同的字段不影响显示，想清掉可以点"全部恢复默认"
- 片段是唯一绕过 `shared/storage` 读偏好的代码：它在应用之外运行。数据库名、仓库名（`idb-store.ts` 的 `PREFERENCE_DATABASE`、`PREFERENCE_OBJECT_STORE`）和键的写法改了，要同步改片段，浏览器测试会核对

## 规则

- **键**：`<登录名>/<名称>`，登录名在创建范围时固定并用 `encodeURIComponent` 编码，之后不再读会话
- **范围的生命期**：页面的作用域销毁（路由离开），或会话里的用户不再是创建时的那个（同步侦听：`endSession` 先清空会话、再跳转卸载页面，清空的那一刻就结束）。同一账号重新登录只换了 token，不结束
- **恢复**：创建时开始读取，最多等 `PREFERENCE_READ_TIMEOUT`（1 秒）；没有存过、读取失败、超时、版本或格式不对都恢复为 `null`，超时之后才到的结果丢弃；恢复只调用一次 `restore`。恢复之前状态已经变了（用户先操作了），放弃恢复，并把当前状态写入
- **格式**：存成 `{ version, value }`，读出时用 `z.object({ version: z.literal(version), value: schema })` 校验
- **写入**：恢复之后才侦听状态，变化后防抖 `PREFERENCE_WRITE_DEBOUNCE`（300 ms）写入最后一次；恢复本身引起的变化不写回。生命期结束、作用域销毁时立即写入还没写的那一次（落到原用户的键），之后不再写入，还没到的读取结果不再应用
- **刷新、关闭**：不走 Vue 的卸载流程，在 `visibilitychange`（变为 `hidden`）和 `pagehide` 时尽力提交；IndexedDB 的写入是异步的，浏览器退出前不保证完成，最后一次修改可能丢失（ADR 0042 接受这一点）
- **失败**：读写失败、`restore` 抛错都交给范围的 `onError`（默认打印到控制台），不弹提示，页面照常可用

## 设备级的同步存储（ADR 0155 第 4 节）

三维的崩溃标记和这台设备的降档记录不是偏好：不分用户，不走 `VITE_PREFERENCE_*` 的开关，也不经偏好的范围。它们要同步写：标签页被杀之前，异步的 IndexedDB 可能还没写完，`pagehide` 里也不能等。所以用 `device-store.ts`，页面和拥有者不直接调用 localStorage。

- 键带存储自己的前缀 `yzt.device.`，和会话（`yzt.session`）等别的数据分开；`keys(prefix)` 列出某个前缀的键，不带这个前缀
- 值存成 JSON，读出时按调用方给的 zod schema 校验；JSON 坏了、格式不对时当作没有，顺手删掉
- 浏览器禁用存储、空间满时读写都安静地失败，读出时是没有：这台设备记不住，按没记过处理
- 使用方：`shared/map/scene-tier`（[config/scene-tier.md](../config/scene-tier.md)"崩溃标记"）

## idb-keyval 的用法注意

- `createStore` 第一次读写时才调用 `indexedDB.open`，所以导入模块不会碰 IndexedDB（node 环境里的测试也能导入）
- 打开数据库时不指定版本，只在第一次建库时建对象仓库：一个数据库只放一个仓库，别的数据另开数据库
- `indexedDB.open` 在某些环境里会同步抛错，实现用 `async` 包了一层，让它以失败的 Promise 结束

## 测试

| 文件 | 内容 | 环境 |
|---|---|---|
| `key-value-store.test.ts` | 内存实现存取复制品、没有的键、删除 | Node |
| `preference-scope.test.ts` | 没有登录时为 null；键的编码；退出时立即结束、同一账号重新登录不结束、换了账号结束；作用域销毁时结束 | jsdom |
| `use-preference.test.ts` | 恢复：合法的值、没有存过、版本或格式不对、读取失败、超时与晚到的结果、恢复前已操作；写入：只在恢复之后、防抖、恢复引起的变化不写回、写入失败、生命期结束与作用域销毁时立即写入、之后不再写入、晚到的读取不应用、页面隐藏与 `pagehide`、范围已结束时不读不写；开关：逐项验证分项开关和总开关，关闭时恢复为 `null`、对存储没有任何访问、旧数据保留，其他几项不受影响，重新打开后恢复旧数据，`restore` 抛错交给 `onError`（假定时器） | jsdom |
| `idb-store.browser.test.ts` | 真实的 IndexedDB：读写删、复制品、跨实例保留、数据库之间隔离、不能克隆的值以失败结束 | Chromium 无界面版 |
| `features/resource-map/symbol-defaults.test.ts` | 发布的默认符号换成测试自己的一份：没调过的用户看到它；以前存下的覆盖照样读出、叠加在上面、读出后不写回；改动和新的默认比较，恢复默认回到它；默认方式是统一样式时选的分类样式记下、保存后再打开还在，预览、取值的改动和恢复不丢掉它 | jsdom |
| `features/resource-map/symbol-defaults/export-snippet.browser.test.ts` | 真实的 IndexedDB 上运行片段原文：读的库、仓库、键和应用一致；导出所有账号的符号、不带别的偏好；只开只读事务；库不存在时不打开不新建，列出的库不准时中止建库；没有符号时不下载 | Chromium 无界面版 |
| `features/resource-map/symbol-defaults/import.test.ts` | 导入：输入不对时的说明、选账号、叠加和差异、样式方式、跳过的部分、`--only`、固定格式和再导入没有变化；仓库里的文件通过校验、取值在规则里、是固定格式 | Node |

- 发布的默认符号改坏 21 处（叠加 3 处、样式方式的推导和整理 7 处、片段 4 处、导入 7 处），都由断言发现。两处起初没被发现："不先确认库存在"，中止建库同样不会留下空库，两道保护重复，改成断言"不调用 `open`"后发现；"写出时不按 code 排序"，用例里合并的顺序碰巧已经排好，改成先有发布默认的资源排在后面后发现
- 其他测试里发布的默认符号一律换成空的（`src/test-setup.ts`），按代码算出的默认符号断言：这份数据随时会换，不该让无关的测试跟着改

- 改坏 20 处（共用流程 16 处、范围 4 处），19 处由断言发现。"结束时不停止侦听"起初没被发现：侦听的回调里还有一道"已结束就不写"的检查，两者重复；去掉回调里的检查、只靠停止侦听后由断言发现
- 开关改坏 12 处（入口 6 处、合并与校验 5 处、页面改回按重置决定 1 处），都能发现。其中"开关关闭时不结束恢复"由 `CurrentMapPage.test.tsx` 的资源列表用例发现：拥有者等 `restore` 才合并目录
- 生产冒烟（`application.spec.ts`）在产物上用真实的 IndexedDB 验证标注的偏好（和底图偏好无关，写入后重新进入时恢复）和底图偏好：登录前写入一条记录，关闭时不恢复、换了也不写、记录原样保留，打开时恢复、换了写入；只验证这次构建的取值
