# shared/storage：偏好的持久化

> 状态：5C.3 完成键值存储、偏好的范围和共用的恢复与写入流程；使用方是底图（`shared/map/basemap`）、边界（`shared/map/boundary`）和资源图层（`features/resource-map`），现状底图页装配。决策见 [ADR 0042](../adr/0042-preference-persistence.md)。

需要跨刷新、跨次打开保留的偏好（勾选了哪些资源、选了哪种底图等）存在 IndexedDB。拥有者不直接调用 idb-keyval 或 localStorage，而是接收页面提供的偏好范围，用共用的流程恢复和写入；登录会话仍存 localStorage（ADR 0015）。

## 三个部分

| 文件 | 内容 |
|---|---|
| `key-value-store.ts` | 异步的键值接口 `KeyValueStore`（`get`、`set`、`delete`）；内存实现 `createMemoryStore`，给测试用，存取的也是复制品 |
| `idb-store.ts` | IndexedDB 的实现 `createIdbStore(数据库, 仓库)`，用 idb-keyval；整个应用共用的 `preferenceStore`（数据库 `yzt-preferences`、仓库 `preferences`） |
| `preference-scope.ts` | `usePreferenceScope()`：页面 setup 中按当前会话创建偏好的范围，没有登录时为 `null` |
| `use-preference.ts` | `usePreference(scope, options)`：一项偏好的恢复与写入，拥有者创建时调用 |

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
| `useBasemap` | `basemap` | 选中的底图、两种底图的透明度 | 读到后替换；选中的底图不可用（没有配置天地图）时保留当前的选择 |
| `useBoundaries` | `boundaries` | 三个级别是否显示、透明度 | 读到后整体替换 |
| `useResourceLayers` | `resource-layers` | 每个资源的勾选、透明度、年份，面板顺序 | 等目录和存储都就绪，按 ADR 0041 第 3 节合并；顺序不能有重复、和设置一一对应，否则整条作废 |
| `useResourceSymbols` | `resource-symbols` | 每个资源统一符号里和默认不同的字段（颜色已规范化），不存临时预览 | 读到后整体替换，目录里没有了的资源也保留；有一个字段越界、颜色解析不了，整条作废（ADR 0044） |

## 规则

- **键**：`<登录名>/<名称>`，登录名在创建范围时固定并用 `encodeURIComponent` 编码，之后不再读会话
- **范围的生命期**：页面的作用域销毁（路由离开），或会话里的用户不再是创建时的那个（同步侦听：`endSession` 先清空会话、再跳转卸载页面，清空的那一刻就结束）。同一账号重新登录只换了 token，不结束
- **恢复**：创建时开始读取，最多等 `PREFERENCE_READ_TIMEOUT`（1 秒）；没有存过、读取失败、超时、版本或格式不对都恢复为 `null`，超时之后才到的结果丢弃；恢复只调用一次 `restore`。恢复之前状态已经变了（用户先操作了），放弃恢复，并把当前状态写入
- **格式**：存成 `{ version, value }`，读出时用 `z.object({ version: z.literal(version), value: schema })` 校验
- **写入**：恢复之后才侦听状态，变化后防抖 `PREFERENCE_WRITE_DEBOUNCE`（300 ms）写入最后一次；恢复本身引起的变化不写回。生命期结束、作用域销毁时立即写入还没写的那一次（落到原用户的键），之后不再写入，还没到的读取结果不再应用
- **刷新、关闭**：不走 Vue 的卸载流程，在 `visibilitychange`（变为 `hidden`）和 `pagehide` 时尽力提交；IndexedDB 的写入是异步的，浏览器退出前不保证完成，最后一次修改可能丢失（ADR 0042 接受这一点）
- **失败**：读写失败、`restore` 抛错都交给范围的 `onError`（默认打印到控制台），不弹提示，页面照常可用

## idb-keyval 的用法注意

- `createStore` 第一次读写时才调用 `indexedDB.open`，所以导入模块不会碰 IndexedDB（node 环境里的测试也能导入）
- 打开数据库时不指定版本，只在第一次建库时建对象仓库：一个数据库只放一个仓库，别的数据另开数据库
- `indexedDB.open` 在某些环境里会同步抛错，实现用 `async` 包了一层，让它以失败的 Promise 结束

## 测试

| 文件 | 内容 | 环境 |
|---|---|---|
| `key-value-store.test.ts` | 内存实现存取复制品、没有的键、删除 | Node |
| `preference-scope.test.ts` | 没有登录时为 null；键的编码；退出时立即结束、同一账号重新登录不结束、换了账号结束；作用域销毁时结束 | jsdom |
| `use-preference.test.ts` | 恢复：合法的值、没有存过、版本或格式不对、读取失败、超时与晚到的结果、恢复前已操作；写入：只在恢复之后、防抖、恢复引起的变化不写回、写入失败、生命期结束与作用域销毁时立即写入、之后不再写入、晚到的读取不应用、页面隐藏与 `pagehide`、范围已结束时不读不写（假定时器） | jsdom |
| `idb-store.browser.test.ts` | 真实的 IndexedDB：读写删、复制品、跨实例保留、数据库之间隔离、不能克隆的值以失败结束 | Chromium 无界面版 |

- 改坏 20 处（共用流程 16 处、范围 4 处），19 处由断言发现。"结束时不停止侦听"起初没被发现：侦听的回调里还有一道"已结束就不写"的检查，两者重复；去掉回调里的检查、只靠停止侦听后由断言发现
