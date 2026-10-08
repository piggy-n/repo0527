# 迁移进度

旧仓库：`C:\WebProject\yzt`，以 `master-demo` 分支为准。

开始迁移一个模块时，在下表记下旧仓库 `master-demo` 当时的 commit 作为基线。之后查看旧仓库的新改动：

```bash
cd C:\WebProject\yzt
git diff <基线>..master-demo -- <旧路径>
```

旧仓库的工作目录可能停在其他分支上，所以比较对象写 `master-demo`，不写 `HEAD`。

| 模块 | 基线 | 旧路径 | 新位置 | 状态 |
|---|---|---|---|---|
| 登录与鉴权 | `836f03b` | `src/views/login/`、`src/services/auth/auth-service.js`、`src/stores/user.js`、`src/utils/func-crypto.js`（`encryptPassword`）、`src/api/sys/sys-uaa-auth-api.js`、`src/router/index.js`（路由守卫）、`src/libs/http-service.js`（token 请求头与 401） | `shared/auth`、`features/auth`、`pages/login`、`app/router`、`app/http.ts` | 已完成登录、会话、路由权限、退出（阶段二）；AI 后端登录待迁移 AI 对话时处理 |
| 文件管理 | `836f03b` | `src/views/resource-center/file-management.vue`、`src/views/resource-center/components/` 下的 `FileManagement*.vue`、`DeleteFileManagementDialog.vue`、`UploadFileManagementDialog.vue`、`DocxPreviewDialog.vue`；`src/mock/file-management-data.js`（分类树与业务类型标签，是写死的业务配置，不是 mockjs）；`src/api/resource/resource-api.js` 中的 `/file/*` | `features/file-management`、`pages/file-management`、`shared/query-form`、`shared/table` | 列表已完成（阶段三 3.3）：分类树、筛选、表格、分页、删除；"上传文档"按钮只占了位置；上传、下载、预览在阶段六 |
| 布局（顶部导航、用户菜单） | `836f03b` | `src/layout/components/TheHeader.vue`、`src/services/resource-application/roleService.js`（`getHeaderMenus`、`getRoleLabel`） | `app/layout` | 已完成导航与退出登录（阶段二 2.10）；修改密码、修改头像、消息铃铛待迁移对应功能时处理 |

## 文件管理：接口实测（2026-10-08）

用浏览器中已登录的会话直接请求后端，按实测结果写 zod schema 和联动规则（`features/file-management/api.ts`、`composables/useFileList.ts`），不照搬旧代码的兜底判断。

**`GET /file/page`**（参数 `categoryId`、`pageNo`、`pageSize`，可选 `name`、`year`、`tag`）

- 外壳 `{ code: 200, msg, success, data }`；`data` 是 Spring Data 的分页结构：`content`、`pageNo`、`pageSize`、`totalElements`、`totalPages`，另有 `hasNextPage` 等用不到的字段
- 记录的 13 个字段每条都有：只有 `remark` 会是 `null`，`bucket` 总是 `null`；`type` 是小写扩展名，与 `name` 的后缀一致（旧代码兼容的 MIME 写法没有出现）；`year` 是字符串，`size` 是字节数，`createdTime` 是 `YYYY-MM-DD HH:mm:ss`
- `name` 模糊匹配，后端不去掉首尾空格（`' 政区 '` 查不到）；空字符串的条件等同于不筛选
- 页码越界（大于 `totalPages`）时返回最后一页的数据，但 `pageNo` 原样返回；`pageNo=0` 按第 1 页处理
- 缺少 `categoryId`：HTTP 400，`{ code: 400, msg: '请求参数缺失:categoryId' }`
- 不校验 token：token 无效或不带 token 都返回数据（已告知，属于后端问题，见 [modules/auth.md](modules/auth.md) 的"会话结束的统一处理"）

**`GET /file/delete?id=`**

- 成功：`{ code: 200, data: null, msg: '删除成功', success: true }`
- 文件不存在：HTTP 200，`{ code: 40000, data: null, msg: '文件不存在', success: false }`，由 `shared/http` 作为业务错误抛出并提示

当时全部 15 个分类共 5 条数据，都在"自然资源调查类"下；样本少，所以 schema 按字段语义声明（例如 `remark` 可为 `null`），没有为样本里没出现的情况加兜底。

## 文件管理：与旧页面的差异

按 3.3 验收时的反馈和新架构的规则，与旧页面有意不同的地方：

| 方面 | 旧页面 | 新页面 |
|---|---|---|
| 筛选栏 | `<label>` 包住控件，标签长短不一，控件宽度不一 | `QueryForm`：控件等宽；放得下一行时紧凑排列，换行时标签统一宽度并两端对齐；修复了点标签清除图标时下拉框展开的问题 |
| 条件没变时点"查询" | 每次都请求 | 同样每次都请求（Vue Query 的查询键不变时不会自动请求，所以主动 `refetch`） |
| 加载状态 | 每次请求都显示遮罩 | 首次加载显示骨架屏，翻页、换条件时在旧数据上显示遮罩，切回看过的分类直接显示缓存（见 [modules/table.md](modules/table.md)） |
| 空值 | 留空 | 显示 `-`（全局表格样式） |
| 左侧目录 | 固定在左侧 | 窄屏（< 1200）收成左侧窄条，点开抽屉 |
| 树 | 所有节点同一字重 | 分组加粗，子级有层级引导线 |
| 页码越界 | 后端返回最后一页的数据，页码不变 | 改到最后一页（例如删掉最后一页的最后一条） |
| 登录过期 | 发请求前检查 | 同样检查（`/file/page` 不校验 token），并由会话结束的统一处理清空缓存 |
