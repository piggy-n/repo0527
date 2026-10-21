# 公共文件传输

状态：2026-10-21 公共基础已实现并完成本地验证；独立提交 `d8cdf8ece9fb1db97a7ab3517a1b7b48bfe6e045`。文件管理上传、下载与预览均已确认原型并接入公共层，业务验证及待办见 [文件管理](file-management.md)。

本轮由文件管理会话负责 `shared/http` 的传输扩展、`shared/file-transfer` 及其测试和本文。资源管理只消费公共接口，业务接口、Excel 校验与刷新由资源管理维护。公共基础首个提交不包含业务 UI、预览依赖、公共主题或锁文件变更；提交号另记迁移记录，由用户协调合入 main。

依据：[HTTP](http.md)、[ADR 0011](../adr/0011-http-client-axios-zod-msw.md)、[ADR 0017](../adr/0017-server-state-with-tanstack-query.md)、[ADR 0039](../adr/0039-async-supersede-rules.md)。旧项目核对记录见 [迁移进度](../migration.md)。

## 三个使用场景

| 场景 | 实际调用与字段 | 公共部分 | 业务拥有者 |
|---|---|---|---|
| 文件上传 | `POST /file/upload`；一个 FormData 重复追加 `files`，共用 `year`、`categoryId`、`tag`，非空时追加 `remark` | FormData、整批字节进度、鉴权、超时、错误 | 文件分类、元数据校验、防重复、上传结果 schema、列表失效 |
| 文件下载与预览取流 | `GET /file/download?objectKey=…`；实际不调用已声明的 `/file/preview` | 二进制响应、进度、文件名、MIME、取消、失败响应识别、浏览器保存 | objectKey、预览白名单、预览交互与生命周期 |
| 资源管理 Excel 导入 | `POST /resource-management/layer/create-attribute-by-excel`；单个 `file`，可选 `year`，没有 layerId 字段；选择器接受 `.xlsx,.xls` | 复用 FormData 上传与进度 | Excel 类型校验、返回 schema、导入成功后刷新属性表 |

`http.post` 沿用原来的 FormData body 与 zod 返回校验，新增公共进度接口。`http.getBlob` 提供独立的二进制解析路径，两者共用同一个 Axios 实例、请求配置、鉴权、超时及错误通知，不另建客户端。

## 公共接口

### 1. 保留 JSON 接口，增加传输进度

```ts
/** 已传输的字节；总量未知时不显示百分比 */
interface TransferProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

// 在既有 RequestOptions 上增加 onUploadProgress
http.post(url, formData, {
  schema: resultSchema,
  onUploadProgress: progress => updateProgress(progress),
  silent: true
});
```

- 保留现有 zod 推导、`query`、`signal`、`timeout`、`silent`、`envelope` 行为，不向 feature 暴露 Axios 配置或事件类型
- 使用现有 Axios 实例和 app 注入的鉴权回调；浏览器生成 multipart boundary，不手工设置 FormData 的 Content-Type
- 不自动把对象转换成 FormData，避免单文件 `file`、多文件 `files` 和数组字段名被隐式改写
- `percent` 为 0～100；无法计算时为 null，只显示已传输字节与进行中状态

Axios 已提供 FormData、进度回调与浏览器 Blob 响应能力，公共基础无需新增依赖，见 [请求配置](https://axios-http.com/docs/req_config)与 [FormData 文档](https://axios-http.com/docs/multipart)。

### 2. 增加二进制入口，文件整理与保存分离

```ts
/** HTTP 层返回文件内容和必要的响应元数据 */
interface BinaryResponse {
  blob: Blob;
  contentType: string | null;
  contentDisposition: string | null;
}

/** 文件整理后交给预览或浏览器保存 */
interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

// shared/http：沿用同一请求、取消、超时和错误通道
http.getBlob(url, { query, signal, timeout, silent, onDownloadProgress });

// shared/file-transfer：内部调用 http.getBlob，整理文件名与必要的 MIME
fetchFile(url, { query, fallbackName, fallbackType, signal, onDownloadProgress });

// shared/file-transfer：只负责将已有内容交给浏览器保存
saveFile(file);
```

`getBlob` 返回 `Promise<BinaryResponse>`；`fetchFile` 返回 `Promise<DownloadedFile>`，同时透传 `timeout`、`silent`；`saveFile` 不发请求、不弹提示。公共基础第一版只提供这三个场景需要的 GET 文件流，未来遇到 POST 导出再扩展。

文件管理业务接口 `fetchFileContent` 的调用方式：

```ts
// features/file-management/api.ts
return fetchFile('/file/download', {
  query: { objectKey: file.objectKey },
  fallbackName: file.name,
  fallbackType: filePreviewType(file.type)?.mime,
  signal,
  onDownloadProgress,
  silent: true
});
```

资源管理调用示意（写在其自己的 feature）：

```ts
const body = new FormData();
body.append('file', file);
if (year) {
  body.append('year', year);
}
return http.post('/resource-management/layer/create-attribute-by-excel', body, {
  schema: importResultSchema,
  onUploadProgress
});
```

上述结果 schema 由各 feature 按真实响应确定，不能根据旧代码的宽松兜底猜测。2026-10-21 用户说明后端不可达，明确允许文件管理上传暂时只判断 code，未知 data 主动丢弃，不解释成功数量或部分失败；该例外不改变资源管理的契约。公共测试使用本地固定契约，不冒充真实接口验证。

### 3. 文件与错误规则

- 文件名优先解析 Content-Disposition 的 `filename*`，其次 `filename`，再用业务提供的后备名称；保留中文，移除路径和控制字符，处理无效编码；列表 name 已含扩展名，不重复追加
- 先判断失败响应，再补 MIME；仅在类型缺失或为 `application/octet-stream` 时使用业务提供的已知 MIME，不覆盖明确的服务端类型
- HTTP 错误中的 Blob、HTTP 200 中的 JSON 失败信封都进入现有 ApiError；401 仍携带发出时的凭据上下文，`silent` 不吞鉴权失败，取消不弹全局错误
- 错误体最多解码 64 KiB；HTTP 错误超过此大小时退回状态码提示。JSON、HTML、缺失类型、octet-stream 和 TXT 会检查小型信封；明确的二进制类型直接保留字节
- 失败信封及成功信封都不是文件；JSON/HTML 只有声明 attachment 才按真实附件接受，普通 TXT 可直接接受。未声明附件的 JSON/HTML 或 HTML 页面开头按 `invalid-response` 处理。真实响应头及失败体仍待接口实测；这不是任意内容的文件格式鉴定器
- 文件名清理同时处理路径、控制字符和 Windows 设备名；不负责按业务改名或补扩展名
- object URL 归创建者管理：`saveFile` 触发后移除链接，保留 URL 60 秒再释放，触发失败则立即释放。预览须在关闭、替换和卸载时释放自己的 URL；请求完成和触发下载均不等于用户已经保存到磁盘

## 状态与取消语义

- 上传和 Excel 导入是服务端写操作：立即防重复，不用 LatestController，不因组件卸载自动取消，不自动重试
- HTTP 公共层接受 AbortSignal，但中止传输不承诺撤销已发生的服务端写入；若业务提供主动中止，结果提示应说明需刷新核对，不能宣称“已撤销上传”
- 上传发送到 100% 后仍可能等待服务端处理。显示“文件已发送，正在处理”，只在成功响应通过 schema 后标记成功；不迁移旧页面按计时器增长到 90% 的模拟进度
- 文件下载按文件 ID 防重复并各自记录状态；预览切换是可替换操作，使用 LatestController。每个 await 后确认信号、目标与会话仍有效
- 页面销毁或会话切换后不更新旧界面、不触发旧成功提示；写操作完成后的缓存失效必须限定发起会话，不能污染新会话
- 分类、标签、年份、列表回第一页与缓存失效属于 file-management；公共层不持有 Vue Query key 或业务状态

## 第一轮交互原型计划

本节保留起始计划；用户已接受统一容器与 docx-preview 依赖，正式功能已接入。访问方式、实际验证与待验收项统一维护在 [文件管理模块](file-management.md)，不以计划代替验收结果。

先参考真实文件列表、`/dev/theme` 的 QueryForm、标题、面板和表格，以及 `/dev/map-ui` 复用真实组件和固定数据的方式。优先做隔离的真实组件预览，复用 Element 的对话框、选择器、上传选择区和进度条；如增加 `/dev/file-management`，遵守开发路由命名及生产隔离检查。

原型只使用固定数据和可控模拟结果，不提交业务文件。优先完成“上传文档”弹窗：

1. 沿用现有按钮位置和列表布局；弹窗用当前主题与 MxSection，包含基本信息、文件选择两块
2. 分类默认当前叶子、可以改选其他叶子；年份默认今年且禁止未来年份；业务标签必填、备注可选。2026-10-21 用户确认：上传弹窗不展示“上传人”，也不发送该字段；列表的 createdName 列照旧
3. 多选与拖入、待上传列表、移除、长文件名、空选择校验；旧项目未设置上传类型、数量或大小上限，本轮不凭空新增业务限制
4. 一次上传共用元数据，只展示整批传输进度；提供“发送中 / 等待服务端 / 成功 / 失败”模拟入口。进行中禁用重复提交和元数据修改，确认关闭、Esc、路由离开时的行为
5. 接着提供行内“查看 / 下载 / 删除”、下载进度与取消，以及预览的加载、失败和关闭；不支持预览的类型只显示下载入口

预览范围沿用旧页面：DOCX、PDF、PNG、JPG、JPEG、GIF、WebP、BMP、TXT。旧页面 DOCX 在对话框渲染，其他支持格式在新标签页打开。原型先展示这一差异，明确下载等待、打开失败与资源释放；是否统一预览容器由用户验收决定。

DOCX 是唯一需要另议的新依赖：旧项目使用 `docx-preview`，当前新项目没有。优先评估同库的懒加载渲染，替代方案为后端转换 PDF（需新增后端能力）或仅下载（不能补齐现有预览）。该库将 DOCX 渲染为 HTML，有排版能力限制，不作为 Office 全格式预览器，见 [官方说明](https://github.com/VolodymyrBaydalka/docxjs)。版本、依赖和具体渲染方案确认后才修改 package.json 与锁文件；公共基础不等待它。

原型验证计划：1600 × 900、1440 × 900、1200 × 800、1199 × 800、760 × 800、390 × 844、1440 × 600；检查筛选换行、表格内部滚动、分页、弹窗底栏、长名称和键盘焦点。真实浏览器检查通过后才交用户验收，再实施业务连接。

## 验证与交付

公共基础的单元测试使用 MSW 覆盖 JSON 回归、成功文件流、文件名、MIME、失败信封、401、超时与取消。实际 multipart 字段及非文本二进制字节完整性在 Chromium 验证：MSW/jsdom 的 File 与原生 FormData 混用会丢失文件名和内容，模拟 XHR Blob 也会将非 UTF-8 字节转为替换字符，不能用这个模拟结果冒充原生传输证据。

浏览器测试入口为 `apps/web/tools/file-transfer/`，只访问本地固定接口，不访问后端。Playwright 启停本 worktree 的 4186 端口服务，不复用占用该端口的服务，另有 180 秒退出上限。`src/shared/file-transfer/browser-fixture.ts` 仅由这组测试动态加载，生产入口不导入。

```sh
pnpm --filter @yzt/web test:unit src/shared/http src/shared/file-transfer src/features/file-management src/pages/file-management src/app/http.test.ts
pnpm --filter @yzt/web exec playwright test --config tools/file-transfer/playwright.config.ts
pnpm typecheck
pnpm lint
pnpm build
```

2026-10-21 验证：119 项单元/回归测试、4 项真实浏览器测试通过；类型检查、lint 和构建通过。浏览器用例覆盖多文件和 Excel 单文件的字段及内容、鉴权、真实发送进度、中文名称、非文本字节保存、未知总量取消、URL 延迟释放。反向测试分别改坏 filename* 优先级、未知总量百分比、带附件头的成功信封判定，均得到预期的断言失败；恢复后重新通过。构建仍有既存的 crypto 浏览器外置和大块提示。

业务连接：保持分类、筛选、缓存、分页和删除；补上传防重复与成功后刷新、读取取消、预览快速切换、关闭后晚到结果、会话变化、失败重试。验证正常、加载、失败、空列表、长名称、窄屏、矮屏和弹窗交互。

检查命令沿用相关 unit/browser 测试、`pnpm lint`、`pnpm typecheck`、`pnpm build`；涉及开发路由或生产入口时补内网构建与独立产物检查。使用本 worktree 的短时服务，结束或超时自动清理，不复用主目录服务作为分支证据。

未验证：真实上传的成功/部分失败结构、下载响应头、后台权限及服务端取消后的结果；真实业务连接与 UI 验收另行记录。公共层测试通过不代表迁移完成。
