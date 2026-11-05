---
paths:
  - "apps/web/src/features/*/store.ts"
  - "apps/web/src/shared/auth/session-store.ts"
  - "apps/web/src/shared/storage/**"
---

# 状态与偏好

## Pinia

- Pinia 4，只用 setup store：`defineStore('id', () => { ...; return { ... } })`；全部 state 都要 return，否则 devtools 和插件看不到；需要重置时自己写 `reset`
- 命名 `useXxxStore`；业务域的 store 放在 `features/<域>/store.ts`，跨域共用的放在 `shared/`
- 只放跨组件共享的客户端状态；组件内部状态留在组件里，接口数据不放进 store
- 解构 state 和 getter 用 `storeToRefs`，action 可以直接解构
- store 不做路由跳转和 UI 提示（不用 `useRouter`、`ElMessage`），由调用方处理
- 每个 store 文件末尾加 HMR：`if (import.meta.hot) { import.meta.hot.accept(acceptHMRUpdate(useXxxStore, import.meta.hot)); }`；不加的话，修改 store 后页面会继续使用旧的 store 实例
- `app/main.ts` 中 pinia 要先于 router 安装

## 偏好

- 偏好（资源图层、底图、边界的选择等）用 IndexedDB 持久化，经 `shared/storage` 的键值接口读写，实现用 idb-keyval；会话仍存 localStorage（ADR 0042）
- 需要持久化的状态由拥有者接收页面提供的偏好范围（`shared/storage`），用共用的流程恢复和写入，不直接调用 idb-keyval 或 localStorage；存下的值读出时用 zod 校验（包括自洽），按拥有者的规则合并，不直接使用（ADR 0042）
- 每项偏好由 `.env` 的总开关 `VITE_PREFERENCES_ENABLED` 和自己的分项开关 `VITE_PREFERENCE_*` 控制，都为 true 才生效（`.env` 现在只关着底图）；只在 `usePreference` 按 `name` 判断，拥有者和页面不另外判断。关闭时不读不写，用 `restore(null)` 按"没有存过"结束恢复，旧数据保留。新增偏好要先在 `app-config.ts` 的 `preferenceSwitches` 登记开关，否则 `name` 通不过类型检查，步骤见 `docs/modules/storage.md`（ADR 0140）
