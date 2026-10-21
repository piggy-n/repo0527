import type { FileRecord } from './api';

/** 传输只需要文件身份和取流参数，不复制整行业务数据 */
export type FileTransferTarget = Pick<FileRecord, 'id' | 'name' | 'type' | 'objectKey'>;
export type FilePreviewKind = 'docx' | 'pdf' | 'text';

// 仅预览已确认的文档格式；图片和其他格式保留下载，不扩展可执行文档类型
const types: Readonly<Record<string, { kind: FilePreviewKind; mime: string }>> = {
  docx: { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  txt: { kind: 'text', mime: 'text/plain' }
};

/** 只接收接口约定的扩展名；未知格式仍允许下载 */
export function filePreviewType(type: string) {
  const extension = type.toLowerCase();
  return Object.hasOwn(types, extension) ? types[extension] : undefined;
}

/** 字节进度的简短显示，不推断缺失的总量 */
export function formatFileBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}
