# 0075. 公共文件传输与文件管理预览

- 状态：已接受
- 日期：2026-10-21

## 背景

阶段六补齐文件管理上传、下载及预览，同时供资源管理 Excel 导入复用传输基础。旧项目实际以 `/file/download` 取流，DOCX 用弹窗，PDF、图片、TXT 另开标签页。用户已验收统一预览弹窗和独立下载进度原型，并允许引入 docx-preview。

## 候选方案

1. 复用现有 axios + zod HTTP，增加必要的 FormData 进度、二进制响应与文件保存；业务自行组合
2. 另建上传客户端或全能上传框架：重复鉴权、错误处理和配置，当前三个场景不需要
3. DOCX 改由后端转 PDF：需新增转换服务；仅提供下载则缺少旧项目已有能力

## 决定

1. 公共基础放 `shared/http` 与 `shared/file-transfer`，继续使用同一个 Axios 实例。文件名、MIME 后备值、失败体识别、进度、取消及浏览器保存由公共层处理；分类、接口、查询 key、业务状态及预览留在 file-management。资源管理只消费 shared
2. 文件下载和预览均调用 `GET /file/download?objectKey=…`。经 Vue Query 发起独立的手动只读查询，每次使用独立 key，不重试、不排队等待联网，结束立即移除二进制缓存。预览拥有者只暂存正在阅读的内容，不建立跨操作 Blob 缓存
3. 下载按文件 ID 防重复、各自取消；预览用 LatestController 后发覆盖先发。关闭预览不取消独立下载。路由离开、会话变更、卸载时停止只读传输；每个异步边界后检查有效性。上传仍是不可按前端取消来撤销的服务端写操作
4. 统一预览外壳支持 DOCX、PDF、TXT 和 PNG、JPG / JPEG、GIF、WebP、BMP 图片。2026-10-21 用户澄清只移除图片缩放旁的「适合宽度」按钮，保留预览入口与加减缩放；此前整项移除图片预览属于理解偏差，已纠正。PDF 使用浏览器阅读器，TXT 使用纯文本显示，不扩展其他 Office 类型
5. 精确安装 `docx-preview@0.4.1`（Apache-2.0，依赖 JSZip），仅打开 DOCX 时动态导入。使用公开的 renderAsync API，不依赖内部解析模型。DOCX 转为 HTML，排版和字体不承诺与 Word 一致
6. DOCX 在不允许脚本的 iframe 内显示，以 CSP 限制外部资源；关闭 HTML 片段渲染，链接仅显示文字，嵌入资源使用 data URL。每轮先在独立容器渲染，完成且信号仍有效才提交。库内部解析不能真正中断，取消表示停止使用结果
7. PDF / 图片的 object URL 在关闭、替换、显示失败和卸载时释放；下载 URL 继续按公共保存函数的短时保留规则管理。下载完成只表示交给浏览器保存，不表示磁盘写入完成

## 后果

DOCX 解析依赖和锁文件由本文件管理分支维护，公共基础提交不包含该依赖。真实后端暂不可达，使用自建文件与固定接口验证，不能据此确认后端权限、上传部分成功、真实响应头或所有业务文档排版。PDF 内部解码失败由浏览器阅读器处理，外层 iframe 的 load 事件不能证明 PDF 内容有效。详细结果与待办持续更新在 [文件管理](../modules/file-management.md) 和 [公共文件传输](../modules/file-transfer.md)。

参考：[docx-preview 官方说明](https://github.com/VolodymyrBaydalka/docxjs)、[ADR 0011](0011-http-client-axios-zod-msw.md)、[ADR 0017](0017-server-state-with-tanstack-query.md)、[ADR 0039](0039-async-supersede-rules.md)。
